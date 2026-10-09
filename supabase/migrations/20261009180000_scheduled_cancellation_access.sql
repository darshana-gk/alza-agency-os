-- A scheduled cancellation keeps workspace access through the Razorpay paid-through date.
-- A missing paid-through date does not grant open-ended access.

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
  v_cancel_at_period_end boolean;
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

  SELECT bs.status, bs.current_period_end, bs.cancel_at_period_end
  INTO v_status, v_period_end, v_cancel_at_period_end
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
  v_cancel_at_period_end := COALESCE(v_cancel_at_period_end, false);
  v_end_date := CASE
    WHEN v_period_end IS NULL THEN NULL
    ELSE (v_period_end AT TIME ZONE 'UTC')::date
  END;
  v_today := (timezone('utc', now()))::date;

  IF v_cancel_at_period_end AND v_end_date IS NOT NULL AND v_end_date >= v_today THEN
    v_state := 'active';
    v_reason := 'none';
  ELSIF v_cancel_at_period_end AND v_end_date IS NULL THEN
    v_state := 'restricted';
    v_reason := 'unavailable';
  ELSIF v_status = '' THEN
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
