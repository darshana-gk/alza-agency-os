-- PROPOSED / DO NOT apply until reviewed.
-- Prospect agency signup + billing identity (restricted).
-- Allows additional agency_profile rows with lifecycle=prospect.
-- Does NOT auto-activate agencies. Does NOT tenant-scope clients/policies/transactions.
-- Existing Production agency is backfilled to lifecycle=active.

-- ---------------------------------------------------------------------------
-- 1) Agency lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE public.agency_profile
  ADD COLUMN IF NOT EXISTS lifecycle text;

UPDATE public.agency_profile
SET lifecycle = 'active'
WHERE lifecycle IS NULL;

ALTER TABLE public.agency_profile
  ALTER COLUMN lifecycle SET DEFAULT 'prospect';

ALTER TABLE public.agency_profile
  ALTER COLUMN lifecycle SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_lifecycle_check'
  ) THEN
    ALTER TABLE public.agency_profile
      ADD CONSTRAINT agency_profile_lifecycle_check
      CHECK (lifecycle IN ('prospect', 'billing_pending', 'active', 'suspended'));
  END IF;
END $$;

COMMENT ON COLUMN public.agency_profile.lifecycle IS
  'prospect|billing_pending|active|suspended. Only active may enter operational app. Paid Razorpay must NOT auto-set active.';

-- Allow multiple agencies: drop singleton UNIQUE (keep column as historical marker).
ALTER TABLE public.agency_profile
  DROP CONSTRAINT IF EXISTS agency_profile_singleton;

COMMENT ON TABLE public.agency_profile IS
  'Agency/workspace profile. Multiple rows allowed; ops tables remain global until tenant isolation. Non-active agencies are restricted to billing/settings/support.';

-- ---------------------------------------------------------------------------
-- 2) Lifecycle helpers (no Owner promote-to-active)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_agency_lifecycle()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.lifecycle
  FROM public.users u
  JOIN public.agency_profile ap ON ap.id = u.agency_profile_id
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_agency_lifecycle() IS
  'Returns lifecycle for the authenticated user agency membership.';

REVOKE ALL ON FUNCTION public.current_agency_lifecycle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_agency_lifecycle() TO authenticated;

CREATE OR REPLACE FUNCTION public.agency_is_ops_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_agency_lifecycle(), '') = 'active'
    OR public.is_alza_support();
$$;

COMMENT ON FUNCTION public.agency_is_ops_active() IS
  'True when caller agency is active (ops allowed) or caller is ALZA support.';

REVOKE ALL ON FUNCTION public.agency_is_ops_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_is_ops_active() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Membership-scoped RLS on agency_profile
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agency_profile_select_authenticated ON public.agency_profile;
CREATE POLICY agency_profile_select_authenticated
  ON public.agency_profile
  FOR SELECT
  TO authenticated
  USING (
    public.is_alza_support()
    OR id = public.current_user_agency_profile_id()
  );

DROP POLICY IF EXISTS agency_profile_insert_admin ON public.agency_profile;
CREATE POLICY agency_profile_insert_admin
  ON public.agency_profile
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
-- Inserts for new agencies are service-role only (create-agency-signup).

DROP POLICY IF EXISTS agency_profile_update_admin ON public.agency_profile;
CREATE POLICY agency_profile_update_admin
  ON public.agency_profile
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin_directory_role()
    AND id = public.current_user_agency_profile_id()
  )
  WITH CHECK (
    public.is_admin_directory_role()
    AND id = public.current_user_agency_profile_id()
  );

-- Block client JWT sessions from changing lifecycle (no Owner self-promote to active).
CREATE OR REPLACE FUNCTION public.enforce_agency_lifecycle_immutable_for_clients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.lifecycle IS DISTINCT FROM OLD.lifecycle
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'agency lifecycle cannot be changed by client sessions';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agency_profile_lifecycle_immutable_trg ON public.agency_profile;
CREATE TRIGGER agency_profile_lifecycle_immutable_trg
  BEFORE UPDATE OF lifecycle ON public.agency_profile
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agency_lifecycle_immutable_for_clients();

-- ---------------------------------------------------------------------------
-- 4) Billing subscriptions: membership-scoped SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS billing_subscriptions_select_admin ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_select_admin
  ON public.billing_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_directory_role()
    AND agency_profile_id = public.current_user_agency_profile_id()
  );

-- Seed incomplete billing rows for any agency missing one (idempotent).
INSERT INTO public.billing_subscriptions (agency_profile_id, status)
SELECT ap.id, 'incomplete'
FROM public.agency_profile ap
WHERE NOT EXISTS (
  SELECT 1 FROM public.billing_subscriptions bs WHERE bs.agency_profile_id = ap.id
);
