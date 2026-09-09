-- Controlled new-customer provisioning.
-- Replaces only the singleton unique restriction so Agency 2+ can exist.
-- Does not UPDATE Tenant 1. Does not weaken RLS, tenant FKs, or stamps.
-- Does not create a billing row. Does not invent Razorpay ids.

-- ---------------------------------------------------------------------------
-- 1) Singleton unique constraint only
-- ---------------------------------------------------------------------------
-- Old mechanism: CONSTRAINT agency_profile_singleton UNIQUE (singleton_key)
-- with singleton_key boolean NOT NULL DEFAULT true.
-- A second agency_profile row failed because it also stored singleton_key = true.
-- Tenant 1 keeps its existing singleton_key value. No row update.

ALTER TABLE public.agency_profile
  DROP CONSTRAINT IF EXISTS agency_profile_singleton;

ALTER TABLE public.agency_profile
  ALTER COLUMN singleton_key SET DEFAULT false;

COMMENT ON COLUMN public.agency_profile.singleton_key IS
  'Legacy single-agency marker. No longer unique. Existing Tenant 1 value is left unchanged. New agencies default false.';

-- Allow ALZA Flow checkout SKUs on plan_key. Existing essential/professional rows stay valid.
ALTER TABLE public.billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_plan_key_check;

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

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS product_key text,
  ADD COLUMN IF NOT EXISTS user_band_key text,
  ADD COLUMN IF NOT EXISTS billing_interval text,
  ADD COLUMN IF NOT EXISTS included_users integer;

-- ---------------------------------------------------------------------------
-- 2) Platform support check — never trust a caller-supplied role string
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_platform_support_actor(p_actor_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Platform support actor is required';
  END IF;

  SELECT u.id
  INTO v_id
  FROM public.users u
  WHERE u.id = p_actor_user_id
    AND lower(u.role) = 'alza_support'
    AND lower(COALESCE(u.status, '')) = 'active'
    AND u.archived_at IS NULL
    AND u.agency_profile_id IS NULL;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Only platform ALZA Support can provision customers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_id
      AND lower(ur.role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
  ) THEN
    RAISE EXCEPTION 'Only platform ALZA Support can provision customers';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_platform_support_actor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_platform_support_actor(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_platform_support_actor(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_platform_support_actor(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Atomic agency + Owner provisioning. Auth UUID comes from the Edge Function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_alza_customer(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_agency_name text,
  p_agency_email text,
  p_agency_phone text,
  p_website text,
  p_owner_first_name text,
  p_owner_last_name text,
  p_owner_email text,
  p_intended_plan text DEFAULT NULL,
  p_billing_interval text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_user uuid;
  v_name text;
  v_agency_email text;
  v_owner_email text;
  v_full_name text;
  v_plan text;
  v_interval text;
  v_name_exists boolean;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'provision_alza_customer is restricted to the trusted backend';
  END IF;

  v_actor := public.assert_platform_support_actor(p_actor_user_id);

  v_name := NULLIF(btrim(COALESCE(p_agency_name, '')), '');
  v_agency_email := NULLIF(lower(btrim(COALESCE(p_agency_email, ''))), '');
  v_owner_email := NULLIF(lower(btrim(COALESCE(p_owner_email, ''))), '');
  v_full_name := NULLIF(btrim(concat_ws(' ', btrim(COALESCE(p_owner_first_name, '')), btrim(COALESCE(p_owner_last_name, '')))), '');

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Agency name is required';
  END IF;
  IF v_agency_email IS NULL OR position('@' in v_agency_email) = 0 THEN
    RAISE EXCEPTION 'Agency email is required';
  END IF;
  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'Owner name is required';
  END IF;
  IF v_owner_email IS NULL OR position('@' in v_owner_email) = 0 THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Owner auth user is required';
  END IF;

  v_plan := NULLIF(lower(btrim(COALESCE(p_intended_plan, ''))), '');
  v_interval := NULLIF(lower(btrim(COALESCE(p_billing_interval, ''))), '');
  IF v_plan IS NOT NULL AND v_plan NOT IN (
    'users_1_3', 'users_4_10', 'users_11_25', 'users_26_50', 'users_51_100', 'users_100_plus'
  ) THEN
    RAISE EXCEPTION 'Invalid intended plan';
  END IF;
  IF v_interval IS NOT NULL AND v_interval NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Invalid billing interval';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE lower(u.email) = v_owner_email
  ) THEN
    RAISE EXCEPTION 'Owner email already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = p_auth_user_id
  ) THEN
    RAISE EXCEPTION 'Auth user is already linked to an ALZA Flow user';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agency_profile ap
    WHERE lower(btrim(COALESCE(ap.email, ''))) = v_agency_email
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
    phone,
    website,
    singleton_key
  ) VALUES (
    v_name,
    v_agency_email,
    NULLIF(btrim(COALESCE(p_agency_phone, '')), ''),
    NULLIF(btrim(COALESCE(p_website, '')), ''),
    false
  )
  RETURNING id INTO v_agency;

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
    v_owner_email,
    'owner',
    'active',
    p_auth_user_id,
    now(),
    'pending',
    v_agency,
    NULL
  )
  RETURNING id INTO v_user;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user, 'owner');

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
  )
  SELECT
    v_actor,
    u.full_name,
    u.role,
    'customer_agency_provisioned',
    'agency',
    v_agency,
    v_owner_email,
    v_agency,
    jsonb_build_object(
      'agency_id', v_agency,
      'agency_name', v_name,
      'agency_email', v_agency_email,
      'owner_user_id', v_user,
      'owner_email', v_owner_email,
      'intended_plan', v_plan,
      'billing_interval', v_interval
    ),
    jsonb_build_object('same_agency_name_exists', v_name_exists)
  FROM public.users u
  WHERE u.id = v_actor;

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
  )
  SELECT
    v_actor,
    u.full_name,
    u.role,
    'owner_invited',
    'user',
    v_user,
    v_owner_email,
    v_agency,
    jsonb_build_object(
      'agency_id', v_agency,
      'owner_email', v_owner_email,
      'invite_status', 'pending'
    ),
    '{}'::jsonb
  FROM public.users u
  WHERE u.id = v_actor;

  RETURN jsonb_build_object(
    'agency_id', v_agency,
    'owner_user_id', v_user,
    'owner_email', v_owner_email,
    'invite_status', 'pending',
    'billing_rows', 0,
    'same_agency_name_warning', v_name_exists
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_alza_customer(uuid, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_alza_customer(uuid, uuid, text, text, text, text, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.provision_alza_customer(uuid, uuid, text, text, text, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_alza_customer(uuid, uuid, text, text, text, text, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.provision_alza_customer(uuid, uuid, text, text, text, text, text, text, text, text, text) IS
  'Platform Support only, via service_role Edge Function. Creates a new agency and first Owner. Does not create billing. Compensating Auth delete is the Edge Function''s job if this fails.';

-- ---------------------------------------------------------------------------
-- 4) Narrow platform agency directory. No financial columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_platform_agencies(p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'list_platform_agencies is restricted to the trusted backend';
  END IF;

  PERFORM public.assert_platform_support_actor(p_actor_user_id);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT
        ap.id,
        ap.agency_name,
        ap.email AS agency_email,
        ap.phone,
        ap.website,
        ap.created_at,
        owner_row.id AS owner_user_id,
        owner_row.full_name AS owner_name,
        owner_row.email AS owner_email,
        owner_row.invite_status,
        owner_row.status AS owner_status,
        bs.status AS subscription_status,
        bs.user_band_key,
        bs.billing_interval,
        bs.plan_key
      FROM public.agency_profile ap
      LEFT JOIN LATERAL (
        SELECT u.id, u.full_name, u.email, u.invite_status, u.status
        FROM public.users u
        WHERE u.agency_profile_id = ap.id
          AND lower(u.role) = 'owner'
          AND u.archived_at IS NULL
        ORDER BY u.created_at
        LIMIT 1
      ) owner_row ON true
      LEFT JOIN public.billing_subscriptions bs
        ON bs.agency_profile_id = ap.id
    ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_agencies(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_platform_agencies(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_platform_agencies(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_agencies(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Manual subscription activation. No Razorpay ids.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_manual_alza_flow_subscription(
  p_actor_user_id uuid,
  p_agency_id uuid,
  p_user_band text,
  p_billing_interval text,
  p_period_start date,
  p_period_end date,
  p_external_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_band text;
  v_interval text;
  v_sku text;
  v_included integer;
  v_existing_status text;
  v_billing_id uuid;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'activate_manual_alza_flow_subscription is restricted to the trusted backend';
  END IF;

  v_actor := public.assert_platform_support_actor(p_actor_user_id);

  IF p_agency_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.agency_profile WHERE id = p_agency_id) THEN
    RAISE EXCEPTION 'Agency not found';
  END IF;

  v_band := lower(btrim(COALESCE(p_user_band, '')));
  v_interval := lower(btrim(COALESCE(p_billing_interval, '')));

  IF v_band NOT IN ('users_1_3', 'users_4_10', 'users_11_25', 'users_26_50', 'users_51_100', 'users_100_plus') THEN
    RAISE EXCEPTION 'Invalid plan';
  END IF;
  IF v_interval NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Invalid billing interval';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Valid subscription dates are required';
  END IF;

  v_included := CASE v_band
    WHEN 'users_1_3' THEN 3
    WHEN 'users_4_10' THEN 10
    WHEN 'users_11_25' THEN 25
    WHEN 'users_26_50' THEN 50
    WHEN 'users_51_100' THEN 100
    ELSE NULL
  END;

  v_sku := CASE
    WHEN v_band = 'users_100_plus' THEN NULL
    ELSE 'flow_' || replace(v_band, 'users_', '') || '_' || v_interval
  END;

  SELECT bs.status, bs.id
  INTO v_existing_status, v_billing_id
  FROM public.billing_subscriptions bs
  WHERE bs.agency_profile_id = p_agency_id;

  IF v_billing_id IS NOT NULL AND lower(COALESCE(v_existing_status, '')) = 'active' THEN
    IF EXISTS (
      SELECT 1
      FROM public.billing_subscriptions bs
      WHERE bs.id = v_billing_id
        AND bs.user_band_key IS NOT DISTINCT FROM v_band
        AND bs.billing_interval IS NOT DISTINCT FROM v_interval
        AND bs.razorpay_subscription_id IS NULL
    ) THEN
      RETURN jsonb_build_object('agency_id', p_agency_id, 'billing_id', v_billing_id, 'changed', false, 'status', 'active');
    END IF;
    RAISE EXCEPTION 'An active subscription already exists for this agency';
  END IF;

  IF v_billing_id IS NULL THEN
    INSERT INTO public.billing_subscriptions (
      agency_profile_id,
      status,
      plan_key,
      product_key,
      user_band_key,
      billing_interval,
      included_users,
      current_period_start,
      current_period_end,
      razorpay_customer_id,
      razorpay_subscription_id,
      razorpay_plan_id
    ) VALUES (
      p_agency_id,
      'active',
      v_sku,
      'alza_flow',
      v_band,
      v_interval,
      v_included,
      p_period_start::timestamptz,
      p_period_end::timestamptz,
      NULL,
      NULL,
      NULL
    )
    RETURNING id INTO v_billing_id;
  ELSE
    UPDATE public.billing_subscriptions
    SET
      status = 'active',
      plan_key = v_sku,
      product_key = 'alza_flow',
      user_band_key = v_band,
      billing_interval = v_interval,
      included_users = v_included,
      current_period_start = p_period_start::timestamptz,
      current_period_end = p_period_end::timestamptz,
      razorpay_customer_id = NULL,
      razorpay_subscription_id = NULL,
      razorpay_plan_id = NULL,
      updated_at = now()
    WHERE id = v_billing_id
      AND agency_profile_id = p_agency_id;
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
  )
  SELECT
    v_actor,
    u.full_name,
    u.role,
    'subscription_manually_activated',
    'agency',
    p_agency_id,
    NULLIF(btrim(COALESCE(p_external_reference, '')), ''),
    p_agency_id,
    jsonb_build_object(
      'status', 'active',
      'plan', v_band,
      'interval', v_interval,
      'sku', v_sku,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'external_reference', NULLIF(btrim(COALESCE(p_external_reference, '')), ''),
      'razorpay_subscription_id', NULL
    ),
    jsonb_build_object('provider', 'manual')
  FROM public.users u
  WHERE u.id = v_actor;

  RETURN jsonb_build_object(
    'agency_id', p_agency_id,
    'billing_id', v_billing_id,
    'status', 'active',
    'plan', v_band,
    'interval', v_interval,
    'changed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_manual_alza_flow_subscription(uuid, uuid, text, text, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_manual_alza_flow_subscription(uuid, uuid, text, text, date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.activate_manual_alza_flow_subscription(uuid, uuid, text, text, date, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_manual_alza_flow_subscription(uuid, uuid, text, text, date, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_owner_invite_resent(
  p_actor_user_id uuid,
  p_owner_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_email text;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'record_owner_invite_resent is restricted to the trusted backend';
  END IF;

  v_actor := public.assert_platform_support_actor(p_actor_user_id);

  SELECT u.agency_profile_id, lower(u.email)
  INTO v_agency, v_email
  FROM public.users u
  WHERE u.id = p_owner_user_id
    AND lower(u.role) = 'owner'
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.invite_status, '')) = 'pending';

  IF v_agency IS NULL THEN
    RAISE EXCEPTION 'Pending Owner invitation was not found';
  END IF;

  INSERT INTO public.activity_history (
    actor_user_id, actor_name, actor_role, action, entity_type, entity_id,
    record_reference, agency_profile_id, new_value, metadata
  )
  SELECT
    v_actor, u.full_name, u.role, 'owner_invite_resent', 'user', p_owner_user_id,
    v_email, v_agency,
    jsonb_build_object('owner_email', v_email, 'invite_status', 'pending'),
    '{}'::jsonb
  FROM public.users u
  WHERE u.id = v_actor;
END;
$$;

REVOKE ALL ON FUNCTION public.record_owner_invite_resent(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_owner_invite_resent(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_owner_invite_resent(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_owner_invite_resent(uuid, uuid) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260909140000', 'controlled_customer_provisioning')
ON CONFLICT (version) DO NOTHING;
