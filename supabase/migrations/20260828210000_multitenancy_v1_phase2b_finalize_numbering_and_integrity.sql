-- ALZA Flow Multi-Tenancy V1 — Phase 2B-finalize
-- Tenant-scoped numbering functions + drop global number uniqueness + composite tenant FKs.
--
-- AUTHORING ONLY until explicitly applied on dedicated non-Production staging.
-- Do NOT apply to Production. Do NOT apply to Preview that shares Production.
-- Apply only after Phase 2A and Phase 2B-prep. Do not apply without 2B-prep.
--
-- This migration:
--   * replaces next_*/set_* numbering to (agency_profile_id, year)
--   * resolves agency from the inserting row or current_user_agency_profile_id()
--   * never uses first-agency / singleton fallback
--   * does NOT stamp agency_profile_id onto the row (Phase 3/4)
--   * does NOT rewrite historical transaction/batch/recovery numbers
--   * drops both global transaction_number unique indexes
--   * converts counter PRIMARY KEY from (year) to (agency_profile_id, year)
--   * adds composite FKs so child.agency_profile_id must match parent
--
-- This migration does NOT:
--   * drop agency_profile_singleton (Phase 3/4 security cutover)
--   * SET NOT NULL on app-written business tables
--   * change RLS / CREATE POLICY / DROP POLICY
--   * touch task_number_counters
--   * change Billing, Support, or Integrations application behavior
--   * create Agency B

-- ---------------------------------------------------------------------------
-- 0) Require 2B-prep objects
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.agency_profile) <> 1 THEN
    RAISE EXCEPTION
      'Phase 2B-finalize abort: expected exactly 1 agency_profile until Phase 3/4 singleton removal';
  END IF;

  IF to_regproc('public.multitenancy_numbering_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 2B-finalize abort: 2B-prep helper missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'transaction_number_counters_agency_year_uidx'
  ) THEN
    RAISE EXCEPTION 'Phase 2B-finalize abort: 2B-prep counter unique missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_id_agency_profile_key') THEN
    RAISE EXCEPTION 'Phase 2B-finalize abort: 2B-prep parent unique (id, agency_profile_id) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'transactions_agency_transaction_number_uidx'
  ) THEN
    RAISE EXCEPTION 'Phase 2B-finalize abort: 2B-prep tenant transaction unique missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Tenant-scoped generators
--    Agency comes from the record or securely derived session membership.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_transaction_number(p_agency uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  agency uuid;
  yr integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  next_val integer;
BEGIN
  agency := public.multitenancy_numbering_agency(p_agency);

  INSERT INTO public.transaction_number_counters AS c (agency_profile_id, year, last_value)
  VALUES (agency, yr, 1)
  ON CONFLICT (agency_profile_id, year) DO UPDATE
    SET last_value = c.last_value + 1
  RETURNING last_value INTO next_val;

  RETURN 'TRX-' || yr::text || '-' || lpad(next_val::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_transaction_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.next_transaction_number(public.current_user_agency_profile_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.set_transaction_number_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.transaction_number IS NULL OR btrim(NEW.transaction_number) = '' THEN
    NEW.transaction_number := public.next_transaction_number(NEW.agency_profile_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_producer_payment_batch_number(p_agency uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  agency uuid;
  yr integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  next_val integer;
BEGIN
  agency := public.multitenancy_numbering_agency(p_agency);

  INSERT INTO public.producer_payment_batch_number_counters AS c (agency_profile_id, year, last_value)
  VALUES (agency, yr, 1)
  ON CONFLICT (agency_profile_id, year) DO UPDATE
    SET last_value = c.last_value + 1
  RETURNING last_value INTO next_val;

  RETURN 'PPB-' || yr::text || '-' || lpad(next_val::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_producer_payment_batch_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.next_producer_payment_batch_number(public.current_user_agency_profile_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.set_producer_payment_batch_number_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.batch_number IS NULL OR btrim(NEW.batch_number) = '' THEN
    NEW.batch_number := public.next_producer_payment_batch_number(NEW.agency_profile_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_recovery_number(p_agency uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  agency uuid;
  yr integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  next_val integer;
BEGIN
  agency := public.multitenancy_numbering_agency(p_agency);

  INSERT INTO public.recovery_number_counters AS c (agency_profile_id, year, last_value)
  VALUES (agency, yr, 1)
  ON CONFLICT (agency_profile_id, year) DO UPDATE
    SET last_value = c.last_value + 1
  RETURNING last_value INTO next_val;

  RETURN 'RCV-' || yr::text || '-' || lpad(next_val::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_recovery_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.next_recovery_number(public.current_user_agency_profile_id());
END;
$$;

CREATE OR REPLACE FUNCTION public.set_recovery_number_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.recovery_number IS NULL OR btrim(NEW.recovery_number) = '' THEN
    NEW.recovery_number := public.next_recovery_number(NEW.agency_profile_id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.next_transaction_number(uuid) IS
  'Phase 2B tenant-scoped TRX-YYYY-######. Agency from row or session membership. Does not stamp the row.';
COMMENT ON FUNCTION public.next_producer_payment_batch_number(uuid) IS
  'Phase 2B tenant-scoped PPB-YYYY-######. Agency from row or session membership. Does not stamp the row.';
COMMENT ON FUNCTION public.next_recovery_number(uuid) IS
  'Phase 2B tenant-scoped RCV-YYYY-######. Agency from row or session membership. Does not stamp the row.';

REVOKE ALL ON FUNCTION public.next_transaction_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_transaction_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_producer_payment_batch_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_producer_payment_batch_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_recovery_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_recovery_number() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.next_transaction_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_transaction_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_producer_payment_batch_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_producer_payment_batch_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_recovery_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_recovery_number() TO authenticated, service_role;

DROP TRIGGER IF EXISTS transactions_set_number ON public.transactions;
CREATE TRIGGER transactions_set_number
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_transaction_number_if_missing();

DROP TRIGGER IF EXISTS producer_payment_batches_set_number ON public.producer_payment_batches;
DROP TRIGGER IF EXISTS trg_set_producer_payment_batch_number ON public.producer_payment_batches;
CREATE TRIGGER producer_payment_batches_set_number
  BEFORE INSERT ON public.producer_payment_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_producer_payment_batch_number_if_missing();

DROP TRIGGER IF EXISTS trg_set_recovery_number ON public.producer_commission_recoveries;
CREATE TRIGGER trg_set_recovery_number
  BEFORE INSERT ON public.producer_commission_recoveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_recovery_number_if_missing();

-- ---------------------------------------------------------------------------
-- 2) Counter PK (year) → (agency_profile_id, year)
-- ---------------------------------------------------------------------------
ALTER TABLE public.transaction_number_counters
  DROP CONSTRAINT IF EXISTS transaction_number_counters_pkey;
ALTER TABLE public.transaction_number_counters
  ADD CONSTRAINT transaction_number_counters_pkey
  PRIMARY KEY USING INDEX transaction_number_counters_agency_year_uidx;

ALTER TABLE public.producer_payment_batch_number_counters
  DROP CONSTRAINT IF EXISTS producer_payment_batch_number_counters_pkey;
ALTER TABLE public.producer_payment_batch_number_counters
  ADD CONSTRAINT producer_payment_batch_number_counters_pkey
  PRIMARY KEY USING INDEX producer_payment_batch_number_counters_agency_year_uidx;

ALTER TABLE public.recovery_number_counters
  DROP CONSTRAINT IF EXISTS recovery_number_counters_pkey;
ALTER TABLE public.recovery_number_counters
  ADD CONSTRAINT recovery_number_counters_pkey
  PRIMARY KEY USING INDEX recovery_number_counters_agency_year_uidx;

-- ---------------------------------------------------------------------------
-- 3) Drop global number uniqueness (both Production transaction indexes)
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_transaction_number_key;
DROP INDEX IF EXISTS public.transactions_transaction_number_uidx;
DROP INDEX IF EXISTS public.transactions_transaction_number_key;

ALTER TABLE public.producer_payment_batches
  DROP CONSTRAINT IF EXISTS producer_payment_batches_batch_number_key;
DROP INDEX IF EXISTS public.producer_payment_batches_batch_number_key;

ALTER TABLE public.producer_commission_recoveries
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_recovery_number_key;
DROP INDEX IF EXISTS public.producer_commission_recoveries_recovery_number_key;

-- ---------------------------------------------------------------------------
-- 4) Composite tenant FKs (MATCH SIMPLE: NULL agency on either side skips)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'policies_client_tenant_fkey') THEN
    ALTER TABLE public.policies
      ADD CONSTRAINT policies_client_tenant_fkey
      FOREIGN KEY (client_id, agency_profile_id)
      REFERENCES public.clients (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_client_tenant_fkey') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_client_tenant_fkey
      FOREIGN KEY (client_id, agency_profile_id)
      REFERENCES public.clients (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_policy_tenant_fkey') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_policy_tenant_fkey
      FOREIGN KEY (policy_id, agency_profile_id)
      REFERENCES public.policies (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_transaction_tenant_fkey') THEN
    ALTER TABLE public.agency_commission_receipts
      ADD CONSTRAINT receipts_transaction_tenant_fkey
      FOREIGN KEY (transaction_id, agency_profile_id)
      REFERENCES public.transactions (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_client_tenant_fkey') THEN
    ALTER TABLE public.agency_commission_receipts
      ADD CONSTRAINT receipts_client_tenant_fkey
      FOREIGN KEY (client_id, agency_profile_id)
      REFERENCES public.clients (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipts_policy_tenant_fkey') THEN
    ALTER TABLE public.agency_commission_receipts
      ADD CONSTRAINT receipts_policy_tenant_fkey
      FOREIGN KEY (policy_id, agency_profile_id)
      REFERENCES public.policies (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_items_batch_tenant_fkey') THEN
    ALTER TABLE public.producer_payment_batch_items
      ADD CONSTRAINT batch_items_batch_tenant_fkey
      FOREIGN KEY (batch_id, agency_profile_id)
      REFERENCES public.producer_payment_batches (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_items_transaction_tenant_fkey') THEN
    ALTER TABLE public.producer_payment_batch_items
      ADD CONSTRAINT batch_items_transaction_tenant_fkey
      FOREIGN KEY (transaction_id, agency_profile_id)
      REFERENCES public.transactions (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recoveries_transaction_tenant_fkey') THEN
    ALTER TABLE public.producer_commission_recoveries
      ADD CONSTRAINT recoveries_transaction_tenant_fkey
      FOREIGN KEY (transaction_id, agency_profile_id)
      REFERENCES public.transactions (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocations_recovery_tenant_fkey') THEN
    ALTER TABLE public.producer_recovery_allocations
      ADD CONSTRAINT allocations_recovery_tenant_fkey
      FOREIGN KEY (recovery_id, agency_profile_id)
      REFERENCES public.producer_commission_recoveries (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocations_batch_tenant_fkey') THEN
    ALTER TABLE public.producer_recovery_allocations
      ADD CONSTRAINT allocations_batch_tenant_fkey
      FOREIGN KEY (payment_batch_id, agency_profile_id)
      REFERENCES public.producer_payment_batches (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recon_rows_statement_tenant_fkey') THEN
    ALTER TABLE public.reconciliation_statement_rows
      ADD CONSTRAINT recon_rows_statement_tenant_fkey
      FOREIGN KEY (statement_id, agency_profile_id)
      REFERENCES public.reconciliation_statements (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recon_rows_transaction_tenant_fkey') THEN
    ALTER TABLE public.reconciliation_statement_rows
      ADD CONSTRAINT recon_rows_transaction_tenant_fkey
      FOREIGN KEY (matched_transaction_id, agency_profile_id)
      REFERENCES public.transactions (id, agency_profile_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reconciliation_statement_rows'
      AND column_name = 'receipt_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recon_rows_receipt_tenant_fkey'
  ) THEN
    ALTER TABLE public.reconciliation_statement_rows
      ADD CONSTRAINT recon_rows_receipt_tenant_fkey
      FOREIGN KEY (receipt_id, agency_profile_id)
      REFERENCES public.agency_commission_receipts (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supporting_docs_transaction_tenant_fkey') THEN
    ALTER TABLE public.supporting_documents
      ADD CONSTRAINT supporting_docs_transaction_tenant_fkey
      FOREIGN KEY (transaction_id, agency_profile_id)
      REFERENCES public.transactions (id, agency_profile_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supporting_docs_recovery_tenant_fkey') THEN
    ALTER TABLE public.supporting_documents
      ADD CONSTRAINT supporting_docs_recovery_tenant_fkey
      FOREIGN KEY (recovery_id, agency_profile_id)
      REFERENCES public.producer_commission_recoveries (id, agency_profile_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT policies_client_tenant_fkey ON public.policies IS
  'Phase 2B: policy and client must share agency_profile_id when both are non-NULL (MATCH SIMPLE).';
COMMENT ON CONSTRAINT transactions_client_tenant_fkey ON public.transactions IS
  'Phase 2B: transaction and client must share agency_profile_id when both are non-NULL.';
COMMENT ON CONSTRAINT transactions_policy_tenant_fkey ON public.transactions IS
  'Phase 2B: transaction and policy must share agency_profile_id when both are non-NULL.';
