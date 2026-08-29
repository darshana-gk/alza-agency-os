-- Multi-tenancy V1 Phase 4D — producer identity same-agency linkage (staging-safe).
-- Does NOT loosen Producer RLS. Does NOT add transactions.producer_id.
-- Tightens current_producer_name() to fail closed without a valid same-agency
-- users.producer_id → producers.id link. Rejects cross-agency producer_id writes.

CREATE OR REPLACE FUNCTION public.current_producer_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NULLIF(trim(p.producer_name), '')
  FROM public.users u
  INNER JOIN public.producers p
    ON p.id = u.producer_id
   AND p.archived_at IS NULL
   AND p.agency_profile_id IS NOT NULL
   AND p.agency_profile_id = u.agency_profile_id
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.status, 'active')) = 'active'
    AND u.agency_profile_id IS NOT NULL
    AND (
      lower(COALESCE(u.role, '')) = 'producer'
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = u.id
          AND lower(ur.role) = 'producer'
      )
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_producer_name() IS
  'Phase 4D: Producer book name for RLS — only users.producer_id → same-agency producers.producer_name. Fail closed when unlinked or cross-agency.';

CREATE OR REPLACE FUNCTION public.enforce_users_producer_same_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prod_agency uuid;
BEGIN
  IF NEW.producer_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.agency_profile_id IS NULL THEN
    RAISE EXCEPTION 'users.producer_id requires agency membership (same-agency producer link)';
  END IF;
  SELECT p.agency_profile_id INTO prod_agency
  FROM public.producers p
  WHERE p.id = NEW.producer_id
    AND p.archived_at IS NULL;
  IF prod_agency IS NULL THEN
    RAISE EXCEPTION 'users.producer_id must reference an active producer directory row';
  END IF;
  IF prod_agency IS DISTINCT FROM NEW.agency_profile_id THEN
    RAISE EXCEPTION 'users.producer_id cannot reference a producer in another agency';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_producer_same_agency ON public.users;
CREATE TRIGGER trg_users_producer_same_agency
  BEFORE INSERT OR UPDATE OF producer_id, agency_profile_id
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_users_producer_same_agency();

COMMENT ON FUNCTION public.enforce_users_producer_same_agency() IS
  'Phase 4D: reject users.producer_id links that are missing, archived, or cross-agency.';

-- Also block self-service producer_id / role escalation (Owner/Admin still manage links).
-- SECURITY INVOKER so current_user is the JWT role (authenticated), matching Phase 3C privilege fix.
CREATE OR REPLACE FUNCTION public.multitenancy_protect_user_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin_directory_role() AND public.same_agency(OLD.agency_profile_id) THEN
    IF NEW.agency_profile_id IS DISTINCT FROM OLD.agency_profile_id THEN
      RAISE EXCEPTION 'Owner/Admin cannot move a user to another agency';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id = public.current_app_user_id() THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.agency_profile_id IS DISTINCT FROM OLD.agency_profile_id
       OR NEW.producer_id IS DISTINCT FROM OLD.producer_id THEN
      RAISE EXCEPTION 'Users cannot change their own status, role, agency membership, or producer identity link';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not authorized to update this user';
END;
$$;

COMMENT ON FUNCTION public.multitenancy_protect_user_privilege() IS
  'Phase 3B+4D: protect privileged user fields as SECURITY INVOKER; blocks self-service producer_id changes.';
