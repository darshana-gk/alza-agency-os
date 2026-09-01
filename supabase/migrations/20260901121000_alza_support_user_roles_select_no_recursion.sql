-- Correction: user_roles SELECT must not subquery public.users (RLS recursion).
-- 20260901120000 originally added an EXISTS on users; that loops with users_select_scoped.
-- Own role rows remain visible via current_app_user_id() (SECURITY DEFINER).

DROP POLICY IF EXISTS user_roles_select_scoped ON public.user_roles;
CREATE POLICY user_roles_select_scoped ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR (public.is_admin_directory_role() AND public.user_is_same_agency(user_id))
    OR (public.is_alza_support() AND lower(role) = 'alza_support')
  );

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901121000', 'alza_support_user_roles_select_no_recursion')
ON CONFLICT (version) DO NOTHING;
