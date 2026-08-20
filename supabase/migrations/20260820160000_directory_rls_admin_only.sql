-- ALZA Flow — Directory RLS hardening (onboarding V1 security)
-- Scope: carriers, mgas, producers, csrs ONLY.
-- Does NOT change clients or policies RLS.
--
-- Before: open "Allow all …" / "Allow public …" policies (USING/WITH CHECK true).
-- After:
--   SELECT  → authenticated (app dropdowns + admin pages)
--   INSERT/UPDATE/DELETE → is_admin_directory_role() (Owner/Admin only)
--   anon    → no mutation grants; no write policies

-- ---------------------------------------------------------------------------
-- 1) Drop open mutation / public-true policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all carriers" ON public.carriers;
DROP POLICY IF EXISTS "Allow all mgas" ON public.mgas;
DROP POLICY IF EXISTS "Allow all csrs" ON public.csrs;

DROP POLICY IF EXISTS "Allow public read producers" ON public.producers;
DROP POLICY IF EXISTS "Allow public insert producers" ON public.producers;
DROP POLICY IF EXISTS "Allow public update producers" ON public.producers;
DROP POLICY IF EXISTS "Allow public delete producers" ON public.producers;

-- ---------------------------------------------------------------------------
-- 2) carriers
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS carriers_select_authenticated ON public.carriers;
DROP POLICY IF EXISTS carriers_insert_admin ON public.carriers;
DROP POLICY IF EXISTS carriers_update_admin ON public.carriers;
DROP POLICY IF EXISTS carriers_delete_admin ON public.carriers;

CREATE POLICY carriers_select_authenticated
  ON public.carriers
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY carriers_insert_admin
  ON public.carriers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY carriers_update_admin
  ON public.carriers
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_directory_role())
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY carriers_delete_admin
  ON public.carriers
  FOR DELETE
  TO authenticated
  USING (public.is_admin_directory_role());

-- ---------------------------------------------------------------------------
-- 3) mgas
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS mgas_select_authenticated ON public.mgas;
DROP POLICY IF EXISTS mgas_insert_admin ON public.mgas;
DROP POLICY IF EXISTS mgas_update_admin ON public.mgas;
DROP POLICY IF EXISTS mgas_delete_admin ON public.mgas;

CREATE POLICY mgas_select_authenticated
  ON public.mgas
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY mgas_insert_admin
  ON public.mgas
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY mgas_update_admin
  ON public.mgas
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_directory_role())
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY mgas_delete_admin
  ON public.mgas
  FOR DELETE
  TO authenticated
  USING (public.is_admin_directory_role());

-- ---------------------------------------------------------------------------
-- 4) producers
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS producers_select_authenticated ON public.producers;
DROP POLICY IF EXISTS producers_insert_admin ON public.producers;
DROP POLICY IF EXISTS producers_update_admin ON public.producers;
DROP POLICY IF EXISTS producers_delete_admin ON public.producers;

CREATE POLICY producers_select_authenticated
  ON public.producers
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY producers_insert_admin
  ON public.producers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY producers_update_admin
  ON public.producers
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_directory_role())
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY producers_delete_admin
  ON public.producers
  FOR DELETE
  TO authenticated
  USING (public.is_admin_directory_role());

-- ---------------------------------------------------------------------------
-- 5) csrs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS csrs_select_authenticated ON public.csrs;
DROP POLICY IF EXISTS csrs_insert_admin ON public.csrs;
DROP POLICY IF EXISTS csrs_update_admin ON public.csrs;
DROP POLICY IF EXISTS csrs_delete_admin ON public.csrs;

CREATE POLICY csrs_select_authenticated
  ON public.csrs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY csrs_insert_admin
  ON public.csrs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY csrs_update_admin
  ON public.csrs
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_directory_role())
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY csrs_delete_admin
  ON public.csrs
  FOR DELETE
  TO authenticated
  USING (public.is_admin_directory_role());

-- ---------------------------------------------------------------------------
-- 6) Anon must not mutate directory tables (defense in depth; RLS already blocks)
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.carriers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mgas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.producers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.csrs FROM anon;

COMMENT ON POLICY carriers_insert_admin ON public.carriers IS
  'Owner/Admin only — directory create (onboarding + admin pages).';
COMMENT ON POLICY mgas_insert_admin ON public.mgas IS
  'Owner/Admin only — directory create (onboarding + admin pages).';
COMMENT ON POLICY producers_insert_admin ON public.producers IS
  'Owner/Admin only — directory create (onboarding + admin pages).';
COMMENT ON POLICY csrs_insert_admin ON public.csrs IS
  'Owner/Admin only — directory create (onboarding + admin pages).';
