-- Phase31C — lock users.producer_id against self-service changes.
-- Does NOT rewrite users RLS policies.
-- Does NOT change existing producer_id values.
-- Owner/Admin same-agency assignment remains allowed.
-- SERVICE_ROLE / postgres (Edge Functions) still bypasses this INVOKER guard.

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
  'Protect privileged user fields as SECURITY INVOKER. Blocks self-service producer_id changes; Owner/Admin same-agency assignment still allowed.';

DROP TRIGGER IF EXISTS aab_multitenancy_protect_user ON public.users;
CREATE TRIGGER aab_multitenancy_protect_user
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.multitenancy_protect_user_privilege();
