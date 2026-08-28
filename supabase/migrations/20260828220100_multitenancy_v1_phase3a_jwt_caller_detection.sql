-- ALZA Flow Multi-Tenancy V1 — Phase 3A correction
-- JWT caller detection must not use current_user inside SECURITY DEFINER stamp triggers.
--
-- Staging uzckhxpqnipnovplohpf already applied 20260828220000 with the broken classifier.
-- This file replaces the resolver + users stamp function only. No RLS, no 3B–3E, no NOT NULL.
-- Do NOT apply to Production as a standalone shortcut; Production must apply 3A (now containing
-- the same bodies) then this no-op CREATE OR REPLACE when Phase 3 is applied there.

DO $$
BEGIN
  IF to_regproc('public.multitenancy_resolve_insert_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3A JWT correction abort: resolver missing (apply 3A first)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'Phase 3A JWT correction abort: singleton missing';
  END IF;
  IF (SELECT COUNT(*) FROM public.agency_profile) <> 1 THEN
    RAISE EXCEPTION 'Phase 3A JWT correction abort: expected exactly 1 agency_profile';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.multitenancy_resolve_insert_agency(
  p_supplied uuid,
  p_parent uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  jwt_uid uuid;
  session_agency uuid;
  resolved uuid;
BEGIN
  -- Classify by request JWT, not current_user. Stamp triggers are SECURITY DEFINER
  -- so current_user is postgres even for authenticated PostgREST callers.
  jwt_uid := auth.uid();
  session_agency := public.current_user_agency_profile_id();

  IF jwt_uid IS NOT NULL THEN
    IF session_agency IS NULL THEN
      RAISE EXCEPTION
        'Phase 3A stamp: authenticated caller has no active agency membership (inactive, archived, or platform-only)';
    END IF;
    resolved := COALESCE(p_supplied, p_parent, session_agency);
    IF p_supplied IS NOT NULL AND p_supplied IS DISTINCT FROM session_agency THEN
      RAISE EXCEPTION
        'Phase 3A stamp: supplied agency_profile_id does not match caller membership';
    END IF;
    IF p_parent IS NOT NULL AND resolved IS DISTINCT FROM p_parent THEN
      RAISE EXCEPTION
        'Phase 3A stamp: row agency_profile_id does not match parent tenant';
    END IF;
    RETURN resolved;
  END IF;

  -- auth.uid() is null: postgres / service_role / dashboard. Explicit or parent.
  -- Never session. Never first/singleton agency.
  resolved := COALESCE(p_supplied, p_parent);
  IF resolved IS NULL THEN
    RAISE EXCEPTION
      'Phase 3A stamp: service-role/postgres insert requires explicit agency_profile_id or a parent tenant';
  END IF;
  IF p_supplied IS NOT NULL AND p_parent IS NOT NULL AND p_supplied IS DISTINCT FROM p_parent THEN
    RAISE EXCEPTION
      'Phase 3A stamp: supplied agency_profile_id does not match parent tenant';
  END IF;
  RETURN resolved;
END;
$$;

COMMENT ON FUNCTION public.multitenancy_resolve_insert_agency(uuid, uuid) IS
  'Phase 3A: JWT callers (auth.uid() + active membership) stamp from session/parent. service_role/postgres require explicit tenant or parent. Never first/singleton agency. Does not use current_user.';

REVOKE ALL ON FUNCTION public.multitenancy_resolve_insert_agency(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.multitenancy_resolve_insert_agency(uuid, uuid) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  session_agency uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.agency_profile_id IS NOT NULL
     AND NEW.agency_profile_id IS DISTINCT FROM OLD.agency_profile_id THEN
    RAISE EXCEPTION 'Phase 3A stamp: users.agency_profile_id cannot be changed once set';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    session_agency := public.current_user_agency_profile_id();
    IF session_agency IS NULL THEN
      RAISE EXCEPTION 'Phase 3A stamp: authenticated caller cannot write users without agency membership';
    END IF;
    IF NEW.agency_profile_id IS NULL THEN
      NEW.agency_profile_id := session_agency;
    ELSIF NEW.agency_profile_id IS DISTINCT FROM session_agency THEN
      RAISE EXCEPTION 'Phase 3A stamp: cannot assign a user to another agency';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.agency_profile_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_profile a WHERE a.id = NEW.agency_profile_id) THEN
    RAISE EXCEPTION 'Phase 3A stamp: users.agency_profile_id is not a known agency';
  END IF;
  RETURN NEW;
END;
$$;

-- Membership helper used by the resolver: keep fixed search_path; JWT may execute it.
ALTER FUNCTION public.current_user_agency_profile_id() SET search_path TO 'public';
REVOKE ALL ON FUNCTION public.current_user_agency_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_agency_profile_id() TO authenticated, service_role;
