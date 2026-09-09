-- Narrow commercial workspace-access read for the signed-in agency member.
-- Does not change billing_subscriptions RLS. Does not expose billing or payment details.
-- Caller cannot supply an agency id. Membership comes from auth.uid().

CREATE OR REPLACE FUNCTION public.get_my_workspace_subscription_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid;
  v_agency uuid;
  v_status text;
  v_period_end timestamptz;
  v_end_date date;
  v_today date;
  v_reason text;
  v_state text;
BEGIN
  v_user := public.current_app_user_id();
  v_agency := public.current_user_agency_profile_id();

  IF v_user IS NULL OR v_agency IS NULL THEN
    RAISE EXCEPTION 'Agency membership is required';
  END IF;

  SELECT bs.status, bs.current_period_end
  INTO v_status, v_period_end
  FROM public.billing_subscriptions bs
  WHERE bs.agency_profile_id = v_agency
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'access_state', 'restricted',
      'reason', 'none',
      'period_end_date', NULL
    );
  END IF;

  v_status := lower(btrim(COALESCE(v_status, '')));
  v_end_date := CASE
    WHEN v_period_end IS NULL THEN NULL
    ELSE (v_period_end AT TIME ZONE 'UTC')::date
  END;
  v_today := (timezone('utc', now()))::date;

  IF v_status = '' THEN
    v_state := 'restricted';
    v_reason := 'none';
  ELSIF v_status IN ('cancelled', 'canceled', 'completed') THEN
    v_state := 'restricted';
    v_reason := 'cancelled';
  ELSIF v_status = 'past_due' THEN
    v_state := 'restricted';
    v_reason := 'past_due';
  ELSIF v_status <> 'active' THEN
    v_state := 'restricted';
    v_reason := CASE
      WHEN v_status IN (
        'created', 'authenticated', 'pending', 'paused', 'halted',
        'trialing', 'unpaid', 'incomplete', 'incomplete_expired'
      ) THEN 'pending'
      ELSE 'other'
    END;
  ELSIF v_end_date IS NOT NULL AND v_end_date < v_today THEN
    v_state := 'restricted';
    v_reason := 'expired';
  ELSE
    v_state := 'active';
    v_reason := 'none';
  END IF;

  RETURN jsonb_build_object(
    'access_state', v_state,
    'reason', v_reason,
    'period_end_date', v_end_date
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_workspace_subscription_access() IS
  'Authenticated caller only. Returns commercial workspace access for the caller agency. No billing or payment fields.';

REVOKE ALL ON FUNCTION public.get_my_workspace_subscription_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_workspace_subscription_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_subscription_access() TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260909160000', 'workspace_subscription_access')
ON CONFLICT (version) DO NOTHING;
