-- Staging-first: platform ALZA Support login + ticket agency names.
-- Does not weaken operational tenant RLS. Does not attach support staff to customer agencies.
-- AUTHORING for dedicated non-Production apply first. Do NOT apply to Production in this UAT.

-- ---------------------------------------------------------------------------
-- 1) Users may always read their own linked profile (login / access-denied reasons).
--    ALZA Support may still list other platform-only support rows for assignment.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_select_scoped ON public.users;
CREATE POLICY users_select_scoped ON public.users FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR id = public.current_app_user_id()
    OR (public.is_admin_directory_role() AND public.same_agency(agency_profile_id))
    OR (
      public.is_alza_support()
      AND agency_profile_id IS NULL
      AND (
        lower(COALESCE(role, '')) = 'alza_support'
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = users.id AND lower(ur.role) = 'alza_support'
        )
      )
    )
  );

DROP POLICY IF EXISTS user_roles_select_scoped ON public.user_roles;
CREATE POLICY user_roles_select_scoped ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR (public.is_admin_directory_role() AND public.user_is_same_agency(user_id))
    OR (public.is_alza_support() AND lower(role) = 'alza_support')
  );

-- ---------------------------------------------------------------------------
-- 2) Ticket Agency column: ALZA Support sees every agency id+name;
--    agency users see only their own membership (fixes customer-side "—").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_agency_brief()
RETURNS TABLE (id uuid, agency_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.agency_name
  FROM public.agency_profile a
  WHERE public.is_alza_support()
     OR (
       public.can_use_agency_support()
       AND a.id IS NOT NULL
       AND a.id = public.current_user_agency_profile_id()
     );
$$;

COMMENT ON FUNCTION public.support_agency_brief() IS
  'ALZA Support: all agency id+name for tickets. Agency users: own membership only. Not agency settings.';

REVOKE ALL ON FUNCTION public.support_agency_brief() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_agency_brief() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Link support@alzabusiness.com Auth → platform-only public.users (no agency).
--    Idempotent. Skips when the Auth user does not exist in this project.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_auth uuid;
  v_user uuid;
BEGIN
  SELECT au.id
  INTO v_auth
  FROM auth.users au
  WHERE lower(au.email) = 'support@alzabusiness.com'
  LIMIT 1;

  IF v_auth IS NULL THEN
    RAISE NOTICE 'alza_support link skipped: no auth.users row for support@alzabusiness.com';
    RETURN;
  END IF;

  SELECT u.id INTO v_user
  FROM public.users u
  WHERE u.auth_user_id = v_auth
  LIMIT 1;

  IF v_user IS NULL THEN
    SELECT u.id INTO v_user
    FROM public.users u
    WHERE lower(u.email) = 'support@alzabusiness.com'
      AND u.archived_at IS NULL
    LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    INSERT INTO public.users (
      id,
      auth_user_id,
      email,
      full_name,
      role,
      status,
      agency_profile_id,
      archived_at,
      invite_status
    ) VALUES (
      v_auth,
      v_auth,
      'support@alzabusiness.com',
      'ALZA Support',
      'alza_support',
      'active',
      NULL,
      NULL,
      'accepted'
    )
    RETURNING id INTO v_user;
  ELSE
    UPDATE public.users
    SET
      auth_user_id = v_auth,
      email = 'support@alzabusiness.com',
      full_name = COALESCE(NULLIF(btrim(full_name), ''), 'ALZA Support'),
      role = 'alza_support',
      status = 'active',
      agency_profile_id = NULL,
      archived_at = NULL,
      invite_status = COALESCE(invite_status, 'accepted')
    WHERE id = v_user;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = v_user
    AND lower(role) <> 'alza_support';

  INSERT INTO public.user_roles (user_id, role)
  SELECT v_user, 'alza_support'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user
      AND lower(ur.role) = 'alza_support'
  );
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901120000', 'alza_support_platform_login_and_agency_brief')
ON CONFLICT (version) DO NOTHING;
