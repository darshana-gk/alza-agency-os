-- PROPOSED / REVIEW BEFORE APPLY — ALZA Flow billing V2 columns
-- Additive only. Does not drop legacy Stripe/Razorpay columns or Essential/Professional rows.
-- Support assignment RPCs live in 20260827120000_support_assignment_rpcs.sql (separate).
-- DO NOT apply until reviewed.

-- ---------------------------------------------------------------------------
-- billing_subscriptions additive columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS product_key text,
  ADD COLUMN IF NOT EXISTS user_band_key text,
  ADD COLUMN IF NOT EXISTS billing_interval text,
  ADD COLUMN IF NOT EXISTS included_users integer;

DO $$
BEGIN
  -- Widen plan_key check to allow new Flow SKUs + legacy essential/professional.
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_subscriptions_plan_key_check'
  ) THEN
    ALTER TABLE public.billing_subscriptions DROP CONSTRAINT billing_subscriptions_plan_key_check;
  END IF;

  ALTER TABLE public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_plan_key_check
    CHECK (
      plan_key IS NULL
      OR plan_key IN (
        'essential',
        'professional',
        'flow_1_3_monthly',
        'flow_1_3_annual',
        'flow_4_10_monthly',
        'flow_4_10_annual',
        'flow_11_25_monthly',
        'flow_11_25_annual',
        'flow_26_50_monthly',
        'flow_26_50_annual',
        'flow_51_100_monthly',
        'flow_51_100_annual'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_subscriptions_billing_interval_check'
  ) THEN
    ALTER TABLE public.billing_subscriptions
      ADD CONSTRAINT billing_subscriptions_billing_interval_check
      CHECK (billing_interval IS NULL OR billing_interval IN ('monthly', 'annual'));
  END IF;
END $$;

COMMENT ON COLUMN public.billing_subscriptions.product_key IS
  'alza_flow | alza_flow_pay (display). Checkout only creates alza_flow today.';
COMMENT ON COLUMN public.billing_subscriptions.user_band_key IS
  'users_1_3 | users_4_10 | users_11_25 | users_26_50 | users_51_100 | users_100_plus';
COMMENT ON COLUMN public.billing_subscriptions.billing_interval IS
  'monthly | annual';
COMMENT ON COLUMN public.billing_subscriptions.included_users IS
  'Soft seat ceiling for the subscribed band when known.';
