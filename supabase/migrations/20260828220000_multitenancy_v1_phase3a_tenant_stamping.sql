-- ALZA Flow Multi-Tenancy V1 — Phase 3A
-- Tenant stamping on INSERT/UPDATE. Does not change RLS, storage, workflow RPCs, or NOT NULL.
--
-- AUTHORING ONLY until explicitly applied on dedicated non-Production staging.
-- Do NOT apply to Production. Do NOT create Agency B. Do NOT drop agency_profile_singleton.
--
-- This migration:
--   * stamps agency_profile_id for authenticated agency users from current_user_agency_profile_id()
--   * copies tenant from parent rows for child inserts when omitted
--   * rejects a client-supplied tenant that does not match the caller (JWT) or parent
--   * requires service-role / postgres inserts to pass an explicit tenant or inherit a parent tenant
--   * never uses the first/singleton agency_profile row as a guess
--   * removes the Phase 2B is_alza_support() numbering mismatch exception
--   * numbering continues to use NEW.agency_profile_id (now stamped before number triggers)
--
-- This migration does NOT:
--   * SET NOT NULL
--   * DROP uniqueness bridges or global number uniques
--   * replace RLS
--   * modify Razorpay / Billing V2 / Edge Functions / SPA

-- ---------------------------------------------------------------------------
-- 0) Preconditions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regproc('public.current_user_agency_profile_id') IS NULL THEN
    RAISE EXCEPTION 'Phase 3A abort: current_user_agency_profile_id() missing (Phase 2A/Support required)';
  END IF;
  IF to_regproc('public.multitenancy_numbering_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3A abort: multitenancy_numbering_agency() missing (Phase 2B required)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'Phase 3A abort: agency_profile_singleton missing; refusing to stamp without singleton lock';
  END IF;
  IF (SELECT COUNT(*) FROM public.agency_profile) <> 1 THEN
    RAISE EXCEPTION 'Phase 3A abort: expected exactly 1 agency_profile (no Agency B in Phase 3)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Resolver — never LIMIT 1 from agency_profile
-- ---------------------------------------------------------------------------
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
  session_agency uuid;
  resolved uuid;
BEGIN
  session_agency := public.current_user_agency_profile_id();

  IF current_user IN ('authenticated', 'anon') THEN
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

  -- service_role / postgres / dashboard: explicit or parent. Never session. Never singleton.
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
  'Phase 3A: resolve INSERT tenant from caller session, supplied value, or parent. Never first/singleton agency.';

REVOKE ALL ON FUNCTION public.multitenancy_resolve_insert_agency(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.multitenancy_resolve_insert_agency(uuid, uuid) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.multitenancy_protect_tenant_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.agency_profile_id IS NOT NULL
     AND NEW.agency_profile_id IS DISTINCT FROM OLD.agency_profile_id THEN
    RAISE EXCEPTION
      'Phase 3A stamp: agency_profile_id cannot be changed once set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_root()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.agency_profile_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(NEW.agency_profile_id, NULL);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_from_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  parent_agency uuid;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT c.agency_profile_id INTO parent_agency FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(NEW.agency_profile_id, parent_agency);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_agency uuid;
  policy_agency uuid;
  parent_agency uuid;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT c.agency_profile_id INTO client_agency FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;
  IF NEW.policy_id IS NOT NULL THEN
    SELECT p.agency_profile_id INTO policy_agency FROM public.policies p WHERE p.id = NEW.policy_id;
  END IF;
  IF client_agency IS NOT NULL AND policy_agency IS NOT NULL
     AND client_agency IS DISTINCT FROM policy_agency THEN
    RAISE EXCEPTION 'Phase 3A stamp: transaction client and policy tenants differ';
  END IF;
  parent_agency := COALESCE(client_agency, policy_agency);
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(NEW.agency_profile_id, parent_agency);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  parent_agency uuid;
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    SELECT t.agency_profile_id INTO parent_agency
    FROM public.transactions t WHERE t.id = NEW.transaction_id;
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(NEW.agency_profile_id, parent_agency);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_batch_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  batch_agency uuid;
  txn_agency uuid;
BEGIN
  IF NEW.batch_id IS NOT NULL THEN
    SELECT b.agency_profile_id INTO batch_agency
    FROM public.producer_payment_batches b WHERE b.id = NEW.batch_id;
  END IF;
  IF NEW.transaction_id IS NOT NULL THEN
    SELECT t.agency_profile_id INTO txn_agency
    FROM public.transactions t WHERE t.id = NEW.transaction_id;
  END IF;
  IF batch_agency IS NOT NULL AND txn_agency IS NOT NULL
     AND batch_agency IS DISTINCT FROM txn_agency THEN
    RAISE EXCEPTION 'Phase 3A stamp: batch item batch/transaction tenants differ';
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(
    NEW.agency_profile_id,
    COALESCE(batch_agency, txn_agency)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recovery_agency uuid;
  batch_agency uuid;
BEGIN
  IF NEW.recovery_id IS NOT NULL THEN
    SELECT r.agency_profile_id INTO recovery_agency
    FROM public.producer_commission_recoveries r WHERE r.id = NEW.recovery_id;
  END IF;
  IF NEW.payment_batch_id IS NOT NULL THEN
    SELECT b.agency_profile_id INTO batch_agency
    FROM public.producer_payment_batches b WHERE b.id = NEW.payment_batch_id;
  END IF;
  IF recovery_agency IS NOT NULL AND batch_agency IS NOT NULL
     AND recovery_agency IS DISTINCT FROM batch_agency THEN
    RAISE EXCEPTION 'Phase 3A stamp: allocation recovery/batch tenants differ';
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(
    NEW.agency_profile_id,
    COALESCE(recovery_agency, batch_agency)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_recon_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  parent_agency uuid;
BEGIN
  IF NEW.statement_id IS NOT NULL THEN
    SELECT s.agency_profile_id INTO parent_agency
    FROM public.reconciliation_statements s WHERE s.id = NEW.statement_id;
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(NEW.agency_profile_id, parent_agency);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_supporting_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  txn_agency uuid;
  rec_agency uuid;
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    SELECT t.agency_profile_id INTO txn_agency
    FROM public.transactions t WHERE t.id = NEW.transaction_id;
  END IF;
  IF NEW.recovery_id IS NOT NULL THEN
    SELECT r.agency_profile_id INTO rec_agency
    FROM public.producer_commission_recoveries r WHERE r.id = NEW.recovery_id;
  END IF;
  IF txn_agency IS NOT NULL AND rec_agency IS NOT NULL
     AND txn_agency IS DISTINCT FROM rec_agency THEN
    RAISE EXCEPTION 'Phase 3A stamp: supporting document transaction/recovery tenants differ';
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(
    NEW.agency_profile_id,
    COALESCE(txn_agency, rec_agency)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_stamp_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  parent_agency uuid;
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    SELECT t.agency_profile_id INTO parent_agency
    FROM public.transactions t WHERE t.id = NEW.transaction_id;
  ELSIF NEW.client_id IS NOT NULL THEN
    SELECT c.agency_profile_id INTO parent_agency
    FROM public.clients c WHERE c.id = NEW.client_id;
  ELSIF NEW.policy_id IS NOT NULL THEN
    SELECT p.agency_profile_id INTO parent_agency
    FROM public.policies p WHERE p.id = NEW.policy_id;
  END IF;
  NEW.agency_profile_id := public.multitenancy_resolve_insert_agency(NEW.agency_profile_id, parent_agency);
  RETURN NEW;
END;
$$;

-- users: service-role may insert ALZA Support with NULL or an agency member with explicit tenant.
-- JWT must not create a user in another agency.
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

  IF current_user IN ('authenticated', 'anon') THEN
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

  -- service_role/postgres: NULL is valid (alza_support). Non-null must be a real agency.
  IF NEW.agency_profile_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.agency_profile a WHERE a.id = NEW.agency_profile_id) THEN
    RAISE EXCEPTION 'Phase 3A stamp: users.agency_profile_id is not a known agency';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Attach triggers (aaa_ sorts before transactions_set_number)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('clients', 'multitenancy_stamp_root'),
      ('carriers', 'multitenancy_stamp_root'),
      ('mgas', 'multitenancy_stamp_root'),
      ('producers', 'multitenancy_stamp_root'),
      ('csrs', 'multitenancy_stamp_root'),
      ('producer_payment_batches', 'multitenancy_stamp_root'),
      ('reconciliation_statements', 'multitenancy_stamp_root'),
      ('reconciliation_column_mappings', 'multitenancy_stamp_root'),
      ('policies', 'multitenancy_stamp_from_client'),
      ('transactions', 'multitenancy_stamp_transaction'),
      ('agency_commission_receipts', 'multitenancy_stamp_from_transaction'),
      ('producer_commission_recoveries', 'multitenancy_stamp_from_transaction'),
      ('producer_payment_batch_items', 'multitenancy_stamp_batch_item'),
      ('producer_recovery_allocations', 'multitenancy_stamp_allocation'),
      ('reconciliation_statement_rows', 'multitenancy_stamp_recon_row'),
      ('supporting_documents', 'multitenancy_stamp_supporting_document'),
      ('activity_history', 'multitenancy_stamp_activity')
    ) AS v(tbl, stamp_fn)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aaa_multitenancy_stamp ON public.%I', spec.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS aaa_multitenancy_stamp_insert ON public.%I', spec.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS aab_multitenancy_protect_tenant ON public.%I', spec.tbl);
    EXECUTE format(
      'CREATE TRIGGER aaa_multitenancy_stamp
         BEFORE INSERT OR UPDATE
         ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.%I()',
      spec.tbl,
      spec.stamp_fn
    );
    EXECUTE format(
      'CREATE TRIGGER aab_multitenancy_protect_tenant
         BEFORE UPDATE
         ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.multitenancy_protect_tenant_column()',
      spec.tbl
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS aaa_multitenancy_stamp ON public.users;
CREATE TRIGGER aaa_multitenancy_stamp
  BEFORE INSERT OR UPDATE
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.multitenancy_stamp_users();

-- ---------------------------------------------------------------------------
-- 3) Numbering: drop ALZA Support mismatch exception; row tenant is source of truth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.multitenancy_numbering_agency(row_agency uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  session_agency uuid;
BEGIN
  session_agency := public.current_user_agency_profile_id();

  IF row_agency IS NOT NULL THEN
    IF session_agency IS NOT NULL AND row_agency IS DISTINCT FROM session_agency THEN
      RAISE EXCEPTION
        'refusing tenant-scoped number: row agency_profile_id does not match caller membership';
    END IF;
    RETURN row_agency;
  END IF;

  IF session_agency IS NOT NULL THEN
    RETURN session_agency;
  END IF;

  RAISE EXCEPTION
    'Cannot allocate a tenant-scoped number without agency_profile_id on the row or authenticated agency membership';
END;
$$;

COMMENT ON FUNCTION public.multitenancy_numbering_agency(uuid) IS
  'Phase 3A: numbering agency is the stamped row tenant, else session membership. No ALZA Support mismatch exception. Never first/singleton agency.';

REVOKE ALL ON FUNCTION public.multitenancy_numbering_agency(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.multitenancy_numbering_agency(uuid) TO authenticated, service_role;
