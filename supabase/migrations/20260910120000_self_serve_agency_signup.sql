-- ALZA Flow V1 — Phase 1 self-serve agency signup (additive)
-- Creates ONE agency + Owner for a brand-new Auth user.
-- Does NOT replace provision_alza_customer or invite-alza-user.
-- service_role / postgres only. Never callable by anon/authenticated.
-- Does NOT set billing status active. Optional purchase intent → incomplete billing row.

CREATE OR REPLACE FUNCTION public.self_serve_create_agency_owner(
  p_auth_user_id uuid,
  p_full_name text,
  p_agency_name text,
  p_email text,
  p_product_key text DEFAULT NULL,
  p_user_band_key text DEFAULT NULL,
  p_billing_interval text DEFAULT NULL,
  p_plan_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency uuid;
  v_user uuid;
  v_name text;
  v_email text;
  v_full_name text;
  v_product text;
  v_band text;
  v_interval text;
  v_plan text;
  v_sku_band text;
  v_sku_interval text;
  v_billing_id uuid;
  v_name_exists boolean;
  v_included int;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'self_serve_create_agency_owner is restricted to the trusted backend';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Auth user is required';
  END IF;

  v_full_name := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  v_name := NULLIF(btrim(COALESCE(p_agency_name, '')), '');
  v_email := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');

  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Agency name is required';
  END IF;
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  -- Serialize duplicate signup races on the same email.
  PERFORM pg_advisory_xact_lock(hashtext('alza_self_serve_signup:' || v_email));

  v_product := NULLIF(lower(btrim(COALESCE(p_product_key, ''))), '');
  v_band := NULLIF(lower(btrim(COALESCE(p_user_band_key, ''))), '');
  v_interval := NULLIF(lower(btrim(COALESCE(p_billing_interval, ''))), '');
  v_plan := NULLIF(lower(btrim(COALESCE(p_plan_key, ''))), '');

  -- Optional plan_key → product/band/interval (Flow checkout SKUs only).
  IF v_plan IS NOT NULL THEN
    IF v_plan ~ '^flow_(1_3|4_10|11_25|26_50)_(monthly|annual)$' THEN
      v_product := COALESCE(v_product, 'alza_flow');
      v_sku_band := (regexp_match(v_plan, '^flow_(1_3|4_10|11_25|26_50)_(monthly|annual)$'))[1];
      v_sku_interval := (regexp_match(v_plan, '^flow_(1_3|4_10|11_25|26_50)_(monthly|annual)$'))[2];
      v_band := COALESCE(
        v_band,
        CASE v_sku_band
          WHEN '1_3' THEN 'users_1_3'
          WHEN '4_10' THEN 'users_4_10'
          WHEN '11_25' THEN 'users_11_25'
          WHEN '26_50' THEN 'users_26_50'
          ELSE NULL
        END
      );
      v_interval := COALESCE(v_interval, v_sku_interval);
    ELSE
      RAISE EXCEPTION 'Invalid plan_key for self-serve signup';
    END IF;
  END IF;

  IF v_product IS NOT NULL AND v_product NOT IN ('alza_flow', 'alza_flow_pay') THEN
    RAISE EXCEPTION 'Invalid product_key';
  END IF;
  IF v_band IS NOT NULL AND v_band NOT IN (
    'users_1_3', 'users_4_10', 'users_11_25', 'users_26_50', 'users_51_100', 'users_100_plus'
  ) THEN
    RAISE EXCEPTION 'Invalid user_band_key';
  END IF;
  IF v_interval IS NOT NULL AND v_interval NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Invalid billing_interval';
  END IF;

  -- Self-serve checkout intent may only pin sellable Flow bands. Contact-only bands
  -- may be stored as intent without a synthetic plan_key.
  IF v_product = 'alza_flow'
     AND v_band IN ('users_1_3', 'users_4_10', 'users_11_25', 'users_26_50')
     AND v_interval IN ('monthly', 'annual')
     AND v_plan IS NULL THEN
    v_plan := 'flow_' || replace(v_band, 'users_', '') || '_' || v_interval;
  END IF;

  -- Never invent checkout SKUs for Contact ALZA / Flow Pay.
  IF v_product = 'alza_flow_pay' OR v_band IN ('users_51_100', 'users_100_plus') THEN
    v_plan := NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = p_auth_user_id
  ) THEN
    RAISE EXCEPTION 'Auth user is already linked to an ALZA Flow user';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'Email already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agency_profile ap
    WHERE lower(btrim(COALESCE(ap.email, ''))) = v_email
  ) THEN
    RAISE EXCEPTION 'Agency email already exists';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agency_profile ap
    WHERE lower(btrim(ap.agency_name)) = lower(v_name)
  ) INTO v_name_exists;

  INSERT INTO public.agency_profile (
    agency_name,
    email,
    singleton_key
  ) VALUES (
    v_name,
    v_email,
    false
  )
  RETURNING id INTO v_agency;

  -- Password was set at signup — mark invite accepted (not pending invite).
  INSERT INTO public.users (
    full_name,
    email,
    role,
    status,
    auth_user_id,
    invited_at,
    invite_status,
    agency_profile_id,
    archived_at
  ) VALUES (
    v_full_name,
    v_email,
    'owner',
    'active',
    p_auth_user_id,
    now(),
    'accepted',
    v_agency,
    NULL
  )
  RETURNING id INTO v_user;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user, 'owner');

  -- Optional purchase intent only. Never active. No Razorpay IDs.
  IF v_product IS NOT NULL OR v_band IS NOT NULL OR v_interval IS NOT NULL OR v_plan IS NOT NULL THEN
    v_included := CASE v_band
      WHEN 'users_1_3' THEN 3
      WHEN 'users_4_10' THEN 10
      WHEN 'users_11_25' THEN 25
      WHEN 'users_26_50' THEN 50
      WHEN 'users_51_100' THEN 100
      ELSE NULL
    END;

    INSERT INTO public.billing_subscriptions (
      agency_profile_id,
      status,
      plan_key,
      product_key,
      user_band_key,
      billing_interval,
      included_users,
      updated_at
    ) VALUES (
      v_agency,
      'incomplete',
      v_plan,
      v_product,
      v_band,
      v_interval,
      v_included,
      now()
    )
    RETURNING id INTO v_billing_id;
  END IF;

  INSERT INTO public.activity_history (
    actor_user_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    record_reference,
    agency_profile_id,
    new_value,
    metadata
  ) VALUES (
    v_user,
    v_full_name,
    'owner',
    'self_serve_agency_created',
    'agency',
    v_agency,
    v_email,
    v_agency,
    jsonb_build_object(
      'agency_id', v_agency,
      'agency_name', v_name,
      'owner_user_id', v_user,
      'owner_email', v_email,
      'product_key', v_product,
      'user_band_key', v_band,
      'billing_interval', v_interval,
      'plan_key', v_plan
    ),
    jsonb_build_object(
      'same_agency_name_exists', v_name_exists,
      'billing_intent_row_id', v_billing_id
    )
  );

  RETURN jsonb_build_object(
    'agency_id', v_agency,
    'owner_user_id', v_user,
    'owner_email', v_email,
    'invite_status', 'accepted',
    'role', 'owner',
    'billing_intent_id', v_billing_id,
    'same_agency_name_warning', v_name_exists
  );
END;
$$;

REVOKE ALL ON FUNCTION public.self_serve_create_agency_owner(uuid, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_serve_create_agency_owner(uuid, text, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.self_serve_create_agency_owner(uuid, text, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.self_serve_create_agency_owner(uuid, text, text, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.self_serve_create_agency_owner(uuid, text, text, text, text, text, text, text) IS
  'Phase 1 self-serve: create one agency + Owner for a new Auth user. service_role only. Optional incomplete billing intent.';
