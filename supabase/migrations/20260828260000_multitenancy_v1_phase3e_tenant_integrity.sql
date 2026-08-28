-- ALZA Flow Multi-Tenancy V1 — Phase 3E
-- Backfill remaining NULL tenants from parents, SET NOT NULL on agency-owned business
-- tables, drop NULL uniqueness bridges and global number uniques.
--
-- AUTHORING ONLY. Do NOT apply to Production. Do NOT drop agency_profile_singleton.
-- Do NOT create Agency B.
--
-- SET NOT NULL tables (agency-owned business rows only):
--   clients
--   policies
--   transactions
--   carriers
--   mgas
--   producers
--   csrs
--   agency_commission_receipts
--   producer_payment_batches
--   producer_payment_batch_items
--   producer_commission_recoveries
--   producer_recovery_allocations
--   reconciliation_statement_rows
--   activity_history
--   supporting_documents
--
-- NOT SET NOT NULL:
--   users.agency_profile_id          -- alza_support is platform-scoped NULL
--   transaction_number_counters      -- already NOT NULL in Phase 2B
--   producer_payment_batch_number_counters
--   recovery_number_counters
--   billing_subscriptions            -- already NOT NULL
--   reconciliation_statements        -- already NOT NULL
--   reconciliation_column_mappings   -- already NOT NULL
--   support_conversations            -- already NOT NULL
--
-- Unresolvable NULL roots abort. Never copies from first/singleton agency_profile.

DO $$
BEGIN
  IF to_regproc('public.multitenancy_resolve_insert_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3E abort: Phase 3A missing';
  END IF;
  IF to_regproc('public.same_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3E abort: Phase 3B missing';
  END IF;
  IF to_regproc('public.enforce_transaction_privilege') IS NULL THEN
    RAISE EXCEPTION 'Phase 3E abort: Phase 3C missing';
  END IF;
  IF to_regproc('public.multitenancy_storage_agency_object') IS NULL THEN
    RAISE EXCEPTION 'Phase 3E abort: Phase 3D missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'Phase 3E abort: agency_profile_singleton missing — refusing integrity cutover';
  END IF;
  IF (SELECT COUNT(*) FROM public.agency_profile) <> 1 THEN
    RAISE EXCEPTION 'Phase 3E abort: expected exactly 1 agency_profile';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'transactions_agency_transaction_number_uidx'
  ) THEN
    RAISE EXCEPTION 'Phase 3E abort: tenant-scoped transaction_number unique missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Parent-before-child backfill. Never SELECT FROM agency_profile LIMIT 1.
-- ---------------------------------------------------------------------------
UPDATE public.policies p
SET agency_profile_id = c.agency_profile_id
FROM public.clients c
WHERE p.client_id = c.id
  AND p.agency_profile_id IS NULL
  AND c.agency_profile_id IS NOT NULL;

UPDATE public.transactions t
SET agency_profile_id = COALESCE(c.agency_profile_id, p.agency_profile_id)
FROM public.clients c
LEFT JOIN public.policies p ON p.id = t.policy_id
WHERE t.client_id = c.id
  AND t.agency_profile_id IS NULL
  AND COALESCE(c.agency_profile_id, p.agency_profile_id) IS NOT NULL;

UPDATE public.agency_commission_receipts r
SET agency_profile_id = t.agency_profile_id
FROM public.transactions t
WHERE r.transaction_id = t.id
  AND r.agency_profile_id IS NULL
  AND t.agency_profile_id IS NOT NULL;

UPDATE public.producer_commission_recoveries r
SET agency_profile_id = t.agency_profile_id
FROM public.transactions t
WHERE r.transaction_id = t.id
  AND r.agency_profile_id IS NULL
  AND t.agency_profile_id IS NOT NULL;

UPDATE public.producer_payment_batch_items i
SET agency_profile_id = COALESCE(b.agency_profile_id, t.agency_profile_id)
FROM public.producer_payment_batches b
JOIN public.transactions t ON t.id = i.transaction_id
WHERE i.batch_id = b.id
  AND i.agency_profile_id IS NULL
  AND COALESCE(b.agency_profile_id, t.agency_profile_id) IS NOT NULL;

UPDATE public.producer_payment_batches b
SET agency_profile_id = t.agency_profile_id
FROM public.producer_payment_batch_items i
JOIN public.transactions t ON t.id = i.transaction_id
WHERE i.batch_id = b.id
  AND b.agency_profile_id IS NULL
  AND t.agency_profile_id IS NOT NULL;

UPDATE public.producer_recovery_allocations a
SET agency_profile_id = COALESCE(r.agency_profile_id, b.agency_profile_id)
FROM public.producer_commission_recoveries r
LEFT JOIN public.producer_payment_batches b ON b.id = a.payment_batch_id
WHERE a.recovery_id = r.id
  AND a.agency_profile_id IS NULL
  AND COALESCE(r.agency_profile_id, b.agency_profile_id) IS NOT NULL;

UPDATE public.reconciliation_statement_rows r
SET agency_profile_id = s.agency_profile_id
FROM public.reconciliation_statements s
WHERE r.statement_id = s.id
  AND r.agency_profile_id IS NULL
  AND s.agency_profile_id IS NOT NULL;

UPDATE public.supporting_documents d
SET agency_profile_id = t.agency_profile_id
FROM public.transactions t
WHERE d.transaction_id = t.id
  AND d.agency_profile_id IS NULL
  AND t.agency_profile_id IS NOT NULL;

UPDATE public.supporting_documents d
SET agency_profile_id = rec.agency_profile_id
FROM public.producer_commission_recoveries rec
WHERE d.recovery_id = rec.id
  AND d.agency_profile_id IS NULL
  AND rec.agency_profile_id IS NOT NULL;

UPDATE public.activity_history a
SET agency_profile_id = t.agency_profile_id
FROM public.transactions t
WHERE a.transaction_id = t.id
  AND a.agency_profile_id IS NULL
  AND t.agency_profile_id IS NOT NULL;

UPDATE public.activity_history a
SET agency_profile_id = c.agency_profile_id
FROM public.clients c
WHERE a.client_id = c.id
  AND a.agency_profile_id IS NULL
  AND c.agency_profile_id IS NOT NULL;

UPDATE public.activity_history a
SET agency_profile_id = p.agency_profile_id
FROM public.policies p
WHERE a.policy_id = p.id
  AND a.agency_profile_id IS NULL
  AND p.agency_profile_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Abort on unresolvable NULL business tenants (do not guess singleton)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(src, ', ' ORDER BY src) INTO leftover
  FROM (
    SELECT 'clients=' || COUNT(*)::text FROM public.clients WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'policies=' || COUNT(*)::text FROM public.policies WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'transactions=' || COUNT(*)::text FROM public.transactions WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'carriers=' || COUNT(*)::text FROM public.carriers WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'mgas=' || COUNT(*)::text FROM public.mgas WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'producers=' || COUNT(*)::text FROM public.producers WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'csrs=' || COUNT(*)::text FROM public.csrs WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'receipts=' || COUNT(*)::text FROM public.agency_commission_receipts WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'batches=' || COUNT(*)::text FROM public.producer_payment_batches WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'batch_items=' || COUNT(*)::text FROM public.producer_payment_batch_items WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'recoveries=' || COUNT(*)::text FROM public.producer_commission_recoveries WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'allocations=' || COUNT(*)::text FROM public.producer_recovery_allocations WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'recon_rows=' || COUNT(*)::text FROM public.reconciliation_statement_rows WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'activity=' || COUNT(*)::text FROM public.activity_history WHERE agency_profile_id IS NULL
    UNION ALL SELECT 'docs=' || COUNT(*)::text FROM public.supporting_documents WHERE agency_profile_id IS NULL
  ) s(src)
  WHERE split_part(src, '=', 2) <> '0';

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase 3E abort: unresolvable NULL agency_profile_id remain (%). Will not use singleton/first agency.',
      leftover;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) SET NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.policies ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.carriers ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.mgas ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.producers ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.csrs ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.agency_commission_receipts ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.producer_payment_batches ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.producer_payment_batch_items ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.producer_commission_recoveries ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.producer_recovery_allocations ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.reconciliation_statement_rows ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.activity_history ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.supporting_documents ALTER COLUMN agency_profile_id SET NOT NULL;

-- users.agency_profile_id remains nullable (alza_support)

-- ---------------------------------------------------------------------------
-- 4) Drop NULL uniqueness bridges, then global number uniques
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.clients_null_agency_client_number_uidx;
DROP INDEX IF EXISTS public.transactions_null_agency_transaction_number_uidx;
DROP INDEX IF EXISTS public.producer_payment_batches_null_agency_batch_number_uidx;
DROP INDEX IF EXISTS public.producer_commission_recoveries_null_agency_recovery_number_uidx;
DROP INDEX IF EXISTS public.clients_transitional_global_client_number_uidx;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_transaction_number_key;
DROP INDEX IF EXISTS public.transactions_transaction_number_key;
DROP INDEX IF EXISTS public.transactions_transaction_number_uidx;

ALTER TABLE public.producer_payment_batches DROP CONSTRAINT IF EXISTS producer_payment_batches_batch_number_key;
DROP INDEX IF EXISTS public.producer_payment_batches_batch_number_key;

ALTER TABLE public.producer_commission_recoveries DROP CONSTRAINT IF EXISTS producer_commission_recoveries_recovery_number_key;
DROP INDEX IF EXISTS public.producer_commission_recoveries_recovery_number_key;

-- Tenant-scoped uniques must still exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'transactions_agency_transaction_number_uidx'
  ) THEN
    RAISE EXCEPTION 'Phase 3E abort: dropped global txn unique but tenant unique is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'producer_payment_batches_agency_batch_number_uidx'
  ) THEN
    RAISE EXCEPTION 'Phase 3E abort: tenant batch unique missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'producer_commission_recoveries_agency_recovery_number_uidx'
  ) THEN
    RAISE EXCEPTION 'Phase 3E abort: tenant recovery unique missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'Phase 3E abort: singleton was dropped — this migration must never drop it';
  END IF;
END $$;
