-- PROPOSED / REVIEW BEFORE APPLY — ALZA Flow billing V2 + support assignment
-- Additive only. Does not drop legacy Stripe/Razorpay columns or Essential/Professional rows.
-- DO NOT apply until reviewed.

-- ---------------------------------------------------------------------------
-- 1) billing_subscriptions additive columns
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
        'flow_26_50_annual'
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

-- ---------------------------------------------------------------------------
-- 2) Support assignment RPC (ALZA support only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_assign_conversation(
  p_conversation_id uuid,
  p_assignee_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assignee_ok boolean;
BEGIN
  IF NOT public.is_alza_support() THEN
    RAISE EXCEPTION 'only ALZA support can assign conversations';
  END IF;

  IF p_assignee_user_id IS NULL THEN
    RAISE EXCEPTION 'assignee required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_assignee_user_id
      AND u.archived_at IS NULL
      AND lower(coalesce(u.status, '')) = 'active'
      AND (
        lower(coalesce(u.role, '')) = 'alza_support'
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = u.id AND lower(ur.role) = 'alza_support'
        )
      )
  ) INTO assignee_ok;

  IF NOT assignee_ok THEN
    RAISE EXCEPTION 'assignee must be an active ALZA support user';
  END IF;

  UPDATE public.support_conversations
  SET
    assigned_to_user_id = p_assignee_user_id,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_unassign_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_alza_support() THEN
    RAISE EXCEPTION 'only ALZA support can unassign conversations';
  END IF;

  UPDATE public.support_conversations
  SET
    assigned_to_user_id = NULL,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.support_assign_conversation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_unassign_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_assign_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_unassign_conversation(uuid) TO authenticated;
