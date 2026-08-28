-- ALZA Flow Multi-Tenancy V1 — Phase 3B
-- Replace global/open RLS with same-agency policies. Does not SET NOT NULL or drop singleton.
--
-- AUTHORING ONLY until explicitly applied on dedicated non-Production staging.
-- Do NOT apply to Production. Do NOT create Agency B.
--
-- Replaces: USING (true), anon client SELECT, open users/user_roles, ops-global recon,
-- billing without tenant, directory global SELECT, CSR-unscoped txn DELETE.
-- alza_support retains Support tables only. Inactive users have NULL membership → no rows.

DO $$
BEGIN
  IF to_regproc('public.multitenancy_resolve_insert_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3B abort: Phase 3A stamping helper missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'Phase 3B abort: agency_profile_singleton missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.status, '')) = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.same_agency(p_agency uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_agency IS NOT NULL
    AND public.current_user_agency_profile_id() IS NOT NULL
    AND p_agency = public.current_user_agency_profile_id();
$$;

COMMENT ON FUNCTION public.same_agency(uuid) IS
  'Phase 3B: row tenant equals active caller membership. False for inactive, anon, and alza_support.';

REVOKE ALL ON FUNCTION public.same_agency(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.same_agency(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_assigned_producer_row(row_producer text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.current_user_agency_profile_id() IS NOT NULL
    AND (
      public.is_admin_directory_role()
      OR public.current_user_has_role('csr')
      OR (
        public.current_user_has_role('viewer')
        AND NOT public.current_user_has_role('producer')
      )
      OR (
        public.current_user_has_role('producer')
        AND NOT public.is_admin_directory_role()
        AND NOT public.current_user_has_role('csr')
        AND public.current_producer_name() IS NOT NULL
        AND lower(trim(COALESCE(row_producer, ''))) = lower(public.current_producer_name())
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_read_policy_row(row_producer text, row_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.current_user_agency_profile_id() IS NOT NULL
    AND (
      public.is_admin_directory_role()
      OR public.current_user_has_role('csr')
      OR (
        public.current_user_has_role('viewer')
        AND NOT public.current_user_has_role('producer')
      )
      OR (
        public.current_user_has_role('producer')
        AND NOT public.is_admin_directory_role()
        AND NOT public.current_user_has_role('csr')
        AND public.current_producer_name() IS NOT NULL
        AND (
          lower(trim(COALESCE(row_producer, ''))) = lower(public.current_producer_name())
          OR EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = row_client_id
              AND public.same_agency(c.agency_profile_id)
              AND lower(trim(COALESCE(c.producer, ''))) = lower(public.current_producer_name())
          )
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_is_same_agency(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND public.same_agency(u.agency_profile_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.support_agency_brief()
RETURNS TABLE (id uuid, agency_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.agency_name
  FROM public.agency_profile a
  WHERE public.is_alza_support();
$$;

COMMENT ON FUNCTION public.support_agency_brief() IS
  'Phase 3B: ALZA Support may read agency id+name for tickets. Not agency settings.';

REVOKE ALL ON FUNCTION public.support_agency_brief() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_agency_brief() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Revoke anonymous table access
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'policies', 'transactions', 'carriers', 'mgas', 'producers', 'csrs',
    'agency_commission_receipts', 'producer_payment_batches', 'producer_payment_batch_items',
    'producer_commission_recoveries', 'producer_recovery_allocations',
    'reconciliation_statements', 'reconciliation_column_mappings', 'reconciliation_statement_rows',
    'billing_subscriptions', 'activity_history', 'supporting_documents',
    'users', 'user_roles', 'agency_profile'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', t);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      t
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
  REVOKE DELETE ON TABLE public.transactions FROM authenticated;
  REVOKE INSERT, UPDATE, DELETE ON TABLE public.billing_subscriptions FROM authenticated;
  REVOKE INSERT, DELETE ON TABLE public.agency_profile FROM authenticated;
  REVOKE UPDATE, DELETE ON TABLE public.activity_history FROM authenticated;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Drop every existing policy on replaced tables (covers Production catalog names)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'clients', 'policies', 'transactions', 'carriers', 'mgas', 'producers', 'csrs',
        'agency_commission_receipts', 'producer_payment_batches', 'producer_payment_batch_items',
        'producer_commission_recoveries', 'producer_recovery_allocations',
        'reconciliation_statements', 'reconciliation_column_mappings', 'reconciliation_statement_rows',
        'billing_subscriptions', 'activity_history', 'supporting_documents',
        'users', 'user_roles', 'agency_profile'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mgas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_commission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_payment_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_commission_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_recovery_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_column_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_statement_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supporting_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_profile ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4) Operational tables
-- ---------------------------------------------------------------------------
CREATE POLICY clients_select_agency ON public.clients FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.can_read_assigned_producer_row(producer));
CREATE POLICY clients_insert_ops ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY clients_update_ops ON public.clients FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY clients_delete_ops ON public.clients FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());

CREATE POLICY policies_select_agency ON public.policies FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.can_read_policy_row(producer, client_id));
CREATE POLICY policies_insert_ops ON public.policies FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY policies_update_ops ON public.policies FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY policies_delete_ops ON public.policies FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());

CREATE POLICY transactions_select_agency ON public.transactions FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.can_read_assigned_producer_row(producer));
CREATE POLICY transactions_insert_ops ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY transactions_update_ops ON public.transactions FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());

CREATE POLICY directory_carriers_select ON public.carriers FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY directory_carriers_admin ON public.carriers FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_carriers_update ON public.carriers FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_carriers_delete ON public.carriers FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY directory_mgas_select ON public.mgas FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY directory_mgas_admin ON public.mgas FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_mgas_update ON public.mgas FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_mgas_delete ON public.mgas FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY directory_producers_select ON public.producers FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY directory_producers_admin ON public.producers FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_producers_update ON public.producers FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_producers_delete ON public.producers FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY directory_csrs_select ON public.csrs FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY directory_csrs_admin ON public.csrs FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_csrs_update ON public.csrs FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY directory_csrs_delete ON public.csrs FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY receipts_select_ops ON public.agency_commission_receipts FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY receipts_insert_ops ON public.agency_commission_receipts FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY receipts_update_admin ON public.agency_commission_receipts FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY batches_select_ops ON public.producer_payment_batches FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY batch_items_select_ops ON public.producer_payment_batch_items FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recoveries_select_ops ON public.producer_commission_recoveries FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recoveries_mutate_admin ON public.producer_commission_recoveries FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY recoveries_update_admin ON public.producer_commission_recoveries FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY recoveries_delete_admin ON public.producer_commission_recoveries FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY allocations_select_ops ON public.producer_recovery_allocations FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());

CREATE POLICY recon_statements_select_ops ON public.reconciliation_statements FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_statements_insert_ops ON public.reconciliation_statements FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_statements_update_ops ON public.reconciliation_statements FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_statements_delete_admin ON public.reconciliation_statements FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY recon_mappings_select_ops ON public.reconciliation_column_mappings FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_mappings_mutate_admin ON public.reconciliation_column_mappings FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY recon_mappings_update_admin ON public.reconciliation_column_mappings FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY recon_mappings_delete_admin ON public.reconciliation_column_mappings FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY recon_rows_select_ops ON public.reconciliation_statement_rows FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_rows_insert_ops ON public.reconciliation_statement_rows FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_rows_update_ops ON public.reconciliation_statement_rows FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY recon_rows_delete_admin ON public.reconciliation_statement_rows FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY billing_select_own_admin ON public.billing_subscriptions FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

CREATE POLICY activity_select_ops ON public.activity_history FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY activity_insert_self ON public.activity_history FOR INSERT TO authenticated
  WITH CHECK (
    public.same_agency(agency_profile_id)
    AND (actor_user_id IS NULL OR actor_user_id = public.current_app_user_id())
  );

CREATE POLICY docs_select_ops ON public.supporting_documents FOR SELECT TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY docs_insert_ops ON public.supporting_documents FOR INSERT TO authenticated
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_ops_staff());
CREATE POLICY docs_update_admin ON public.supporting_documents FOR UPDATE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
  WITH CHECK (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());
CREATE POLICY docs_delete_admin ON public.supporting_documents FOR DELETE TO authenticated
  USING (public.same_agency(agency_profile_id) AND public.is_admin_directory_role());

-- ---------------------------------------------------------------------------
-- 5) agency_profile / users / user_roles
-- ---------------------------------------------------------------------------
CREATE POLICY agency_profile_select_own ON public.agency_profile FOR SELECT TO authenticated
  USING (id = public.current_user_agency_profile_id());
CREATE POLICY agency_profile_update_own_admin ON public.agency_profile FOR UPDATE TO authenticated
  USING (id = public.current_user_agency_profile_id() AND public.is_admin_directory_role())
  WITH CHECK (id = public.current_user_agency_profile_id() AND public.is_admin_directory_role());

CREATE POLICY users_select_scoped ON public.users FOR SELECT TO authenticated
  USING (
    id = public.current_app_user_id()
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

CREATE POLICY users_update_scoped ON public.users FOR UPDATE TO authenticated
  USING (
    id = public.current_app_user_id()
    OR (public.is_admin_directory_role() AND public.same_agency(agency_profile_id))
  )
  WITH CHECK (
    id = public.current_app_user_id()
    OR (public.is_admin_directory_role() AND public.same_agency(agency_profile_id))
  );

CREATE POLICY user_roles_select_scoped ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR (public.is_admin_directory_role() AND public.user_is_same_agency(user_id))
    OR (public.is_alza_support() AND lower(role) = 'alza_support')
  );

CREATE POLICY user_roles_insert_admin_agency ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_directory_role()
    AND public.user_is_same_agency(user_id)
    AND lower(role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
  );

CREATE POLICY user_roles_delete_admin_agency ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.is_admin_directory_role()
    AND public.user_is_same_agency(user_id)
    AND lower(role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
  );

-- Support conversation/message policies are intentionally NOT dropped.

CREATE OR REPLACE FUNCTION public.multitenancy_protect_user_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
       OR NEW.agency_profile_id IS DISTINCT FROM OLD.agency_profile_id THEN
      RAISE EXCEPTION 'Users cannot change their own status, role, or agency membership';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not authorized to update this user';
END;
$$;

DROP TRIGGER IF EXISTS aab_multitenancy_protect_user ON public.users;
CREATE TRIGGER aab_multitenancy_protect_user
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.multitenancy_protect_user_privilege();
