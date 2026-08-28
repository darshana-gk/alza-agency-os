-- ALZA Flow Multi-Tenancy V1 — Phase 2A
-- Additive tenant-column foundation + defensive Tenant 1 backfill.
--
-- AUTHORING ONLY until explicitly applied on a dedicated non-Production staging database.
-- Do NOT apply to Production. Do NOT apply to Preview Supabase that shares Production.
--
-- This migration:
--   * adds nullable agency_profile_id (+ FK + non-unique index) where the column is missing
--   * includes recovery_number_counters, transaction_number_counters, and
--     producer_payment_batch_number_counters (year PK unchanged; numbering functions unchanged)
--   * does NOT touch task_number_counters (product ownership unconfirmed)
--   * backfills existing business rows to the single existing agency_profile (Tenant 1)
--   * re-NULLs alza_support membership (platform role, not an agency member)
--   * preserves historical updated_at by disabling only set_updated_at() row triggers
--     for the duration of the backfill UPDATEs (see section 2)
--
-- This migration does NOT:
--   * make new tenant columns NOT NULL
--   * drop agency_profile.singleton_key
--   * replace RLS / transaction permissions / approval RPCs
--   * convert uniqueness to tenant-scoped
--   * change counter PKs or next_* numbering functions
--   * recalculate premiums, commissions, splits, receipts, or matches
--   * change Billing, Support, or Integrations behavior
--   * use session_replication_role = replica (would skip unrelated integrity triggers)
--
-- Existing tenant columns are not recreated:
--   users, reconciliation_statements, reconciliation_column_mappings,
--   billing_subscriptions, support_conversations

-- ---------------------------------------------------------------------------
-- 0) Required-table presence (do not invent predating DDL)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t)
  INTO missing
  FROM unnest(ARRAY[
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
    'transaction_number_counters',
    'producer_payment_batch_number_counters',
    'reconciliation_statements',
    'reconciliation_column_mappings',
    'reconciliation_statement_rows',
    'billing_subscriptions',
    'support_conversations',
    'activity_history',
    'supporting_documents'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase 2A abort: required table(s) missing (will not CREATE them): %',
      missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Add nullable tenant columns + FK foundations (new columns only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  has_col boolean;
  has_fk boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY[
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
    'transaction_number_counters',
    'producer_payment_batch_number_counters',
    'reconciliation_statement_rows',
    'activity_history',
    'supporting_documents'
  ]
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'agency_profile_id'
    ) INTO has_col;

    IF NOT has_col THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN agency_profile_id uuid',
        t
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = format('public.%I', t)::regclass
        AND c.contype = 'f'
        AND a.attname = 'agency_profile_id'
    ) INTO has_fk;

    IF NOT has_fk THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (agency_profile_id) REFERENCES public.agency_profile(id)',
        t,
        t || '_agency_profile_id_fkey'
      );
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (agency_profile_id) WHERE agency_profile_id IS NOT NULL',
      t || '_agency_profile_id_idx',
      t
    );
  END LOOP;
END $$;

COMMENT ON COLUMN public.clients.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.policies.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.transactions.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.carriers.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.mgas.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.producers.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.csrs.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.agency_commission_receipts.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.producer_payment_batches.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.producer_payment_batch_items.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.producer_commission_recoveries.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.producer_recovery_allocations.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.recovery_number_counters.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Counter PK remains year until Phase 2B.';
COMMENT ON COLUMN public.transaction_number_counters.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Counter PK remains year until Phase 2B.';
COMMENT ON COLUMN public.producer_payment_batch_number_counters.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Counter PK remains year until Phase 2B.';
COMMENT ON COLUMN public.reconciliation_statement_rows.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.activity_history.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';
COMMENT ON COLUMN public.supporting_documents.agency_profile_id IS
  'Phase 2A additive tenant key. Nullable until Phase 2B. Not used by RLS yet.';

-- ---------------------------------------------------------------------------
-- 2) Defensive guards — abort rather than guess, then backfill Tenant 1
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tenant1 uuid;
  agency_count integer;
  mixed_support integer;
  unexpected_membership integer;
  unexpected_existing integer;
  orphan_user_agency integer;
  policies_missing_client integer;
  txns_missing_client integer;
  txns_missing_policy integer;
  receipts_missing_txn integer;
  items_missing_batch integer;
  items_missing_txn integer;
  alloc_missing_recovery integer;
  alloc_missing_batch integer;
  rows_missing_statement integer;
  docs_missing_txn integer;
  docs_missing_recovery integer;
  trig record;
  disabled jsonb := '[]'::jsonb;
BEGIN
  LOCK TABLE public.agency_profile IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*)::integer INTO agency_count FROM public.agency_profile;

  IF agency_count = 0 THEN
    RAISE EXCEPTION
      'Phase 2A abort: agency_profile is empty; cannot identify Tenant 1';
  END IF;

  IF agency_count <> 1 THEN
    RAISE EXCEPTION
      'Phase 2A abort: expected exactly 1 agency_profile row (singleton Cartier/test), found %',
      agency_count;
  END IF;

  SELECT id INTO tenant1 FROM public.agency_profile LIMIT 1;

  -- Mixed platform + agency roles: do not guess which membership wins.
  SELECT COUNT(*)::integer
  INTO mixed_support
  FROM public.users u
  WHERE (
      lower(COALESCE(u.role, '')) = 'alza_support'
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = u.id
          AND lower(ur.role) = 'alza_support'
      )
    )
    AND (
      lower(COALESCE(u.role, '')) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = u.id
          AND lower(ur.role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
      )
    );

  IF mixed_support > 0 THEN
    RAISE EXCEPTION
      'Phase 2A abort: % user(s) have both alza_support and an agency role; will not guess membership',
      mixed_support;
  END IF;

  -- Agency users pointing at a different (or missing) agency.
  SELECT COUNT(*)::integer
  INTO unexpected_membership
  FROM public.users u
  WHERE NOT (
      lower(COALESCE(u.role, '')) = 'alza_support'
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = u.id
          AND lower(ur.role) = 'alza_support'
      )
    )
    AND u.agency_profile_id IS NOT NULL
    AND u.agency_profile_id IS DISTINCT FROM tenant1;

  IF unexpected_membership > 0 THEN
    RAISE EXCEPTION
      'Phase 2A abort: % agency user(s) have agency_profile_id other than Tenant 1',
      unexpected_membership;
  END IF;

  SELECT COUNT(*)::integer
  INTO orphan_user_agency
  FROM public.users u
  WHERE u.agency_profile_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.agency_profile ap WHERE ap.id = u.agency_profile_id
    );

  IF orphan_user_agency > 0 THEN
    RAISE EXCEPTION
      'Phase 2A abort: % user(s) have agency_profile_id that does not exist',
      orphan_user_agency;
  END IF;

  -- Existing tenant columns (do not recreate) must already be Tenant 1 or NULL.
  SELECT COUNT(*)::integer INTO unexpected_existing FROM (
    SELECT agency_profile_id FROM public.reconciliation_statements
    WHERE agency_profile_id IS NOT NULL AND agency_profile_id IS DISTINCT FROM tenant1
    UNION ALL
    SELECT agency_profile_id FROM public.reconciliation_column_mappings
    WHERE agency_profile_id IS NOT NULL AND agency_profile_id IS DISTINCT FROM tenant1
    UNION ALL
    SELECT agency_profile_id FROM public.billing_subscriptions
    WHERE agency_profile_id IS NOT NULL AND agency_profile_id IS DISTINCT FROM tenant1
    UNION ALL
    SELECT agency_profile_id FROM public.support_conversations
    WHERE agency_profile_id IS NOT NULL AND agency_profile_id IS DISTINCT FROM tenant1
  ) x;

  IF unexpected_existing > 0 THEN
    RAISE EXCEPTION
      'Phase 2A abort: % existing tenant-column row(s) are not Tenant 1; will not guess',
      unexpected_existing;
  END IF;

  -- Orphan relationship notices (do not abort: predating data quality).
  -- Column names on predating tables are only queried when present.
  -- All surviving rows still receive Tenant 1; IDs/amounts are not rewritten.
  policies_missing_client := 0;
  txns_missing_client := 0;
  txns_missing_policy := 0;
  receipts_missing_txn := 0;
  items_missing_batch := 0;
  items_missing_txn := 0;
  alloc_missing_recovery := 0;
  alloc_missing_batch := 0;
  rows_missing_statement := 0;
  docs_missing_txn := 0;
  docs_missing_recovery := 0;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'policies' AND column_name = 'client_id'
  ) THEN
    SELECT COUNT(*)::integer INTO policies_missing_client
    FROM public.policies p
    WHERE p.client_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p.client_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'client_id'
  ) THEN
    SELECT COUNT(*)::integer INTO txns_missing_client
    FROM public.transactions t
    WHERE t.client_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = t.client_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'policy_id'
  ) THEN
    SELECT COUNT(*)::integer INTO txns_missing_policy
    FROM public.transactions t
    WHERE t.policy_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.policies p WHERE p.id = t.policy_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agency_commission_receipts' AND column_name = 'transaction_id'
  ) THEN
    SELECT COUNT(*)::integer INTO receipts_missing_txn
    FROM public.agency_commission_receipts r
    WHERE r.transaction_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = r.transaction_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'producer_payment_batch_items' AND column_name = 'batch_id'
  ) THEN
    SELECT COUNT(*)::integer INTO items_missing_batch
    FROM public.producer_payment_batch_items i
    WHERE i.batch_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.producer_payment_batches b WHERE b.id = i.batch_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'producer_payment_batch_items' AND column_name = 'transaction_id'
  ) THEN
    SELECT COUNT(*)::integer INTO items_missing_txn
    FROM public.producer_payment_batch_items i
    WHERE i.transaction_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = i.transaction_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'producer_recovery_allocations' AND column_name = 'recovery_id'
  ) THEN
    SELECT COUNT(*)::integer INTO alloc_missing_recovery
    FROM public.producer_recovery_allocations a
    WHERE a.recovery_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.producer_commission_recoveries r WHERE r.id = a.recovery_id
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'producer_recovery_allocations' AND column_name = 'payment_batch_id'
  ) THEN
    SELECT COUNT(*)::integer INTO alloc_missing_batch
    FROM public.producer_recovery_allocations a
    WHERE a.payment_batch_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.producer_payment_batches b WHERE b.id = a.payment_batch_id
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reconciliation_statement_rows' AND column_name = 'statement_id'
  ) THEN
    SELECT COUNT(*)::integer INTO rows_missing_statement
    FROM public.reconciliation_statement_rows r
    WHERE r.statement_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_statements s WHERE s.id = r.statement_id
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supporting_documents' AND column_name = 'transaction_id'
  ) THEN
    SELECT COUNT(*)::integer INTO docs_missing_txn
    FROM public.supporting_documents d
    WHERE d.transaction_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = d.transaction_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supporting_documents' AND column_name = 'recovery_id'
  ) THEN
    SELECT COUNT(*)::integer INTO docs_missing_recovery
    FROM public.supporting_documents d
    WHERE d.recovery_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.producer_commission_recoveries r WHERE r.id = d.recovery_id
      );
  END IF;

  RAISE NOTICE 'Phase 2A Tenant 1 = %', tenant1;
  RAISE NOTICE 'Phase 2A orphan notices (non-fatal): policies_missing_client=%, txns_missing_client=%, txns_missing_policy=%, receipts_missing_txn=%, items_missing_batch=%, items_missing_txn=%, alloc_missing_recovery=%, alloc_missing_batch=%, rows_missing_statement=%, docs_missing_txn=%, docs_missing_recovery=%',
    policies_missing_client,
    txns_missing_client,
    txns_missing_policy,
    receipts_missing_txn,
    items_missing_batch,
    items_missing_txn,
    alloc_missing_recovery,
    alloc_missing_batch,
    rows_missing_statement,
    docs_missing_txn,
    docs_missing_recovery;

  -- Timestamp preservation:
  -- Live Production uses BEFORE UPDATE ... EXECUTE FUNCTION public.set_updated_at()
  -- (predating this repo; not defined in migrations). Known Production names:
  --   agency_commission_receipts_set_updated_at
  --   carriers_set_updated_at
  --   csrs_set_updated_at
  --   mgas_set_updated_at
  --   producer_commission_recoveries_set_updated_at
  --   producer_payment_batches_set_updated_at
  --   transactions_set_updated_at
  --   users_set_updated_at
  -- That function assigns NEW.updated_at := now(), so SET updated_at = updated_at
  -- cannot preserve history. session_replication_role = replica is not used:
  -- it would also skip integrity/security triggers (lifecycle, recovery cap,
  -- alza_support lock). Catalog lookup disables only non-internal row triggers
  -- whose function is public.set_updated_at on tables this backfill UPDATEs.
  -- Re-enable is guaranteed on success and on abort (inner + outer EXCEPTION).
  -- DISABLE TRIGGER ALL is not used.
  BEGIN
  FOR trig IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace np ON np.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND np.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT t.tgisinternal
      AND p.proname = 'set_updated_at'
      AND c.relname IN (
        'users',
        'reconciliation_statements',
        'reconciliation_column_mappings',
        'billing_subscriptions',
        'support_conversations',
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
        'transaction_number_counters',
        'producer_payment_batch_number_counters',
        'reconciliation_statement_rows',
        'activity_history',
        'supporting_documents'
      )
    ORDER BY c.relname, t.tgname
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DISABLE TRIGGER %I',
      trig.table_name,
      trig.trigger_name
    );
    disabled := disabled || jsonb_build_array(
      jsonb_build_object('table_name', trig.table_name, 'trigger_name', trig.trigger_name)
    );
  END LOOP;

  RAISE NOTICE 'Phase 2A disabled set_updated_at triggers: %', disabled;

  BEGIN
    -- Platform support: never an agency member (known Support-foundation backfill).
    UPDATE public.users u
    SET agency_profile_id = NULL
    WHERE (
        lower(COALESCE(u.role, '')) = 'alza_support'
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = u.id
            AND lower(ur.role) = 'alza_support'
        )
      )
      AND u.agency_profile_id IS NOT NULL;

    -- Agency users with NULL membership → Tenant 1.
    UPDATE public.users u
    SET agency_profile_id = tenant1
    WHERE u.agency_profile_id IS NULL
      AND NOT (
        lower(COALESCE(u.role, '')) = 'alza_support'
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = u.id
            AND lower(ur.role) = 'alza_support'
        )
      );

    -- Existing nullable tenant columns (users handled above). These tables are
    -- NOT NULL in repo DDL; UPDATE is a no-op if already populated.
    UPDATE public.reconciliation_statements
    SET agency_profile_id = tenant1
    WHERE agency_profile_id IS NULL;

    UPDATE public.reconciliation_column_mappings
    SET agency_profile_id = tenant1
    WHERE agency_profile_id IS NULL;

    UPDATE public.billing_subscriptions
    SET agency_profile_id = tenant1
    WHERE agency_profile_id IS NULL;

    UPDATE public.support_conversations
    SET agency_profile_id = tenant1
    WHERE agency_profile_id IS NULL;

    -- Newly added columns: stamp Tenant 1. Do not rewrite IDs or money columns.
    UPDATE public.clients SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.policies SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.transactions SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.carriers SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.mgas SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.producers SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.csrs SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.agency_commission_receipts SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.producer_payment_batches SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.producer_payment_batch_items SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.producer_commission_recoveries SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.producer_recovery_allocations SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.recovery_number_counters SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.transaction_number_counters SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.producer_payment_batch_number_counters SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.reconciliation_statement_rows SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.activity_history SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
    UPDATE public.supporting_documents SET agency_profile_id = tenant1 WHERE agency_profile_id IS NULL;
  EXCEPTION WHEN OTHERS THEN
    FOR trig IN
      SELECT x.table_name, x.trigger_name
      FROM jsonb_to_recordset(disabled) AS x(table_name text, trigger_name text)
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE TRIGGER %I',
        trig.table_name,
        trig.trigger_name
      );
    END LOOP;
    RAISE;
  END;

  FOR trig IN
    SELECT x.table_name, x.trigger_name
    FROM jsonb_to_recordset(disabled) AS x(table_name text, trigger_name text)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE TRIGGER %I',
      trig.table_name,
      trig.trigger_name
    );
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    FOR trig IN
      SELECT x.table_name, x.trigger_name
      FROM jsonb_to_recordset(disabled) AS x(table_name text, trigger_name text)
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE TRIGGER %I',
        trig.table_name,
        trig.trigger_name
      );
    END LOOP;
    RAISE;
  END;
END $$;
