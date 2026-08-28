-- ALZA Flow Multi-Tenancy V1 — Phase 2B prerequisite
-- READ-ONLY Production schema inspection
--
-- DO NOT RUN unless separately approved as a read-only Production inspection.
-- This file is SELECT/catalog-only. It must never INSERT/UPDATE/DELETE/DDL.
-- Do not infer that git migrations have been applied from this file existing.
--
-- Purpose: capture live PKs, unique constraints, indexes, RLS, and tenant
-- columns on tables whose original DDL predates this repo, before Phase 2B
-- uniqueness / NOT NULL work is authored.

-- ---------------------------------------------------------------------------
-- A. agency_profile singleton + existing tenant columns
-- ---------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname IN ('agency_profile_id', 'singleton_key')
ORDER BY c.relname, a.attname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.agency_profile'::regclass
ORDER BY conname;

SELECT COUNT(*) AS agency_profile_row_count FROM public.agency_profile;

-- ---------------------------------------------------------------------------
-- B. Columns on predating operational tables (do not assume repo DDL)
-- ---------------------------------------------------------------------------
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'clients',
    'policies',
    'transactions',
    'carriers',
    'mgas',
    'producers',
    'csrs',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_payment_batch_items',
    'producer_commission_recoveries',
    'producer_recovery_allocations',
    'recovery_number_counters',
    'users',
    'user_roles',
    'reconciliation_statements',
    'reconciliation_column_mappings',
    'reconciliation_statement_rows',
    'billing_subscriptions',
    'support_conversations',
    'activity_history',
    'supporting_documents'
  )
  AND column_name IN (
    'id',
    'agency_profile_id',
    'client_id',
    'policy_id',
    'transaction_id',
    'batch_id',
    'payment_batch_id',
    'recovery_id',
    'statement_id',
    'client_number',
    'policy_number',
    'transaction_number',
    'batch_number',
    'recovery_number',
    'producer_name',
    'csr_name',
    'carrier_name',
    'mga_name',
    'email',
    'file_hash',
    'singleton_key',
    'role'
  )
ORDER BY table_name, ordinal_position;

-- ---------------------------------------------------------------------------
-- C. Primary keys, unique constraints, foreign keys
-- ---------------------------------------------------------------------------
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'agency_profile',
    'users',
    'user_roles',
    'clients',
    'policies',
    'transactions',
    'carriers',
    'mgas',
    'producers',
    'csrs',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_payment_batch_items',
    'producer_commission_recoveries',
    'producer_recovery_allocations',
    'recovery_number_counters',
    'reconciliation_statements',
    'reconciliation_column_mappings',
    'reconciliation_statement_rows',
    'billing_subscriptions',
    'support_conversations',
    'activity_history',
    'supporting_documents'
  )
ORDER BY c.relname, con.contype, con.conname;

-- ---------------------------------------------------------------------------
-- D. Indexes (including unique indexes not backed by a named constraint)
-- ---------------------------------------------------------------------------
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'agency_profile',
    'users',
    'clients',
    'policies',
    'transactions',
    'carriers',
    'mgas',
    'producers',
    'csrs',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_payment_batch_items',
    'producer_commission_recoveries',
    'recovery_number_counters',
    'reconciliation_statements',
    'reconciliation_column_mappings',
    'billing_subscriptions'
  )
ORDER BY tablename, indexname;

-- ---------------------------------------------------------------------------
-- E. RLS enabled + policy definitions
-- ---------------------------------------------------------------------------
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'agency_profile',
    'users',
    'user_roles',
    'clients',
    'policies',
    'transactions',
    'carriers',
    'mgas',
    'producers',
    'csrs',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_payment_batch_items',
    'producer_commission_recoveries',
    'producer_recovery_allocations',
    'reconciliation_statements',
    'reconciliation_column_mappings',
    'reconciliation_statement_rows',
    'billing_subscriptions',
    'support_conversations',
    'activity_history',
    'supporting_documents'
  )
ORDER BY c.relname;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'agency_profile',
    'users',
    'user_roles',
    'clients',
    'policies',
    'transactions',
    'carriers',
    'mgas',
    'producers',
    'csrs',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_commission_recoveries',
    'reconciliation_statements',
    'billing_subscriptions',
    'support_conversations',
    'activity_history',
    'supporting_documents'
  )
ORDER BY tablename, policyname;

-- ---------------------------------------------------------------------------
-- F. Numbering functions / triggers (live DDL not in this repo)
-- ---------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'next_transaction_number',
    'set_transaction_number_if_missing',
    'next_recovery_number',
    'set_recovery_number_if_missing',
    'next_client_number',
    'current_user_agency_profile_id',
    'current_producer_name',
    'can_read_policy_row',
    'can_read_assigned_producer_row',
    'is_ops_staff',
    'is_alza_support'
  )
ORDER BY p.proname;

SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN (
    'transactions',
    'producer_payment_batches',
    'producer_commission_recoveries',
    'clients',
    'users'
  )
ORDER BY c.relname, t.tgname;

-- ---------------------------------------------------------------------------
-- G. Storage bucket policies (branding / recon / supporting-documents)
-- ---------------------------------------------------------------------------
SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id IN ('agency-branding', 'reconciliation-statements', 'supporting-documents')
ORDER BY id;

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;

-- ---------------------------------------------------------------------------
-- H. Membership snapshot (no PII beyond role flags)
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS user_rows,
  COUNT(*) FILTER (WHERE agency_profile_id IS NULL) AS null_agency,
  COUNT(*) FILTER (WHERE lower(COALESCE(role, '')) = 'alza_support') AS role_alza_support
FROM public.users;
