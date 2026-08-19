-- Migrate SaaS billing from Stripe field names to Razorpay equivalents (additive).
-- Keeps legacy Stripe columns for history; app reads Razorpay columns going forward.
-- Does not drop applied migrations or billing tables.

-- ---------------------------------------------------------------------------
-- 1) Razorpay columns on billing_subscriptions
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_customer_id text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id text,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text,
  ADD COLUMN IF NOT EXISTS plan_key text,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS charge_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_subscriptions_plan_key_check'
  ) THEN
    ALTER TABLE public.billing_subscriptions
      ADD CONSTRAINT billing_subscriptions_plan_key_check
      CHECK (plan_key IS NULL OR plan_key IN ('essential', 'professional'));
  END IF;
END $$;

-- Expand status CHECK for Razorpay lifecycle (+ keep prior Stripe-compatible values).
ALTER TABLE public.billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_status_check;

ALTER TABLE public.billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_status_check
  CHECK (
    status IN (
      -- Razorpay subscription states
      'created',
      'authenticated',
      'active',
      'pending',
      'halted',
      'cancelled',
      'completed',
      'paused',
      -- Legacy / normalized values retained for compatibility
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_razorpay_customer_uidx
  ON public.billing_subscriptions (razorpay_customer_id)
  WHERE razorpay_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_razorpay_subscription_uidx
  ON public.billing_subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.billing_subscriptions.razorpay_customer_id IS
  'Razorpay customer id when created/linked for the workspace.';
COMMENT ON COLUMN public.billing_subscriptions.razorpay_subscription_id IS
  'Authoritative Razorpay subscription id mirrored from API/webhooks.';
COMMENT ON COLUMN public.billing_subscriptions.razorpay_plan_id IS
  'Razorpay plan id (server-mapped from essential/professional).';
COMMENT ON COLUMN public.billing_subscriptions.plan_key IS
  'Internal plan key: essential | professional.';

-- ---------------------------------------------------------------------------
-- 2) Webhook events: support Razorpay event ids (already unique on stripe_event_id column name)
-- Rename column conceptually via comment; keep column name to avoid breaking unique constraint.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.billing_webhook_events.stripe_event_id IS
  'Provider webhook event id (Razorpay x-razorpay-event-id or legacy Stripe event id).';
COMMENT ON TABLE public.billing_webhook_events IS
  'Billing webhook idempotency log for Razorpay (and any legacy Stripe events).';
