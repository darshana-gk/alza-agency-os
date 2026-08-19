-- ALZA Flow V1 — Stripe subscription/billing foundation (additive)
-- One billing_subscriptions row per singleton agency_profile.
-- Authoritative writes: Stripe webhook / Edge Functions (service role).
-- Authenticated users: Owner/Admin SELECT only. No client writes of status.

-- ---------------------------------------------------------------------------
-- 1) billing_subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_profile_id uuid NOT NULL
    REFERENCES public.agency_profile (id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  status text NOT NULL DEFAULT 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_agency_unique UNIQUE (agency_profile_id),
  CONSTRAINT billing_subscriptions_status_check CHECK (
    status IN (
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    )
  )
);

COMMENT ON TABLE public.billing_subscriptions IS
  'SaaS Stripe subscription mirror for the singleton agency workspace. Not insurance Financials.';

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_stripe_customer_uidx
  ON public.billing_subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_stripe_subscription_uidx
  ON public.billing_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx
  ON public.billing_subscriptions (status);

ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_subscriptions_select_admin ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_select_admin
  ON public.billing_subscriptions
  FOR SELECT
  TO authenticated
  USING (public.is_admin_directory_role());

-- No INSERT/UPDATE/DELETE policies for authenticated — service role bypasses RLS.

-- Seed a blank row for the singleton agency if missing (status incomplete; no Stripe IDs yet).
INSERT INTO public.billing_subscriptions (agency_profile_id, status)
SELECT ap.id, 'incomplete'
FROM public.agency_profile ap
WHERE NOT EXISTS (
  SELECT 1 FROM public.billing_subscriptions bs WHERE bs.agency_profile_id = ap.id
)
LIMIT 1;

-- ---------------------------------------------------------------------------
-- 2) Webhook event idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  CONSTRAINT billing_webhook_events_stripe_event_unique UNIQUE (stripe_event_id)
);

COMMENT ON TABLE public.billing_webhook_events IS
  'Stripe webhook idempotency log. Insert-before-process; duplicate event IDs are ignored.';

CREATE INDEX IF NOT EXISTS billing_webhook_events_type_idx
  ON public.billing_webhook_events (event_type);

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated — service role only.
