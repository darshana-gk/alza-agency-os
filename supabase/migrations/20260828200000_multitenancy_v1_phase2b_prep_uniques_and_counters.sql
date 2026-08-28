-- ALZA Flow Multi-Tenancy V1 — Phase 2B-prep
-- Additive uniqueness + counter identity preparation.
--
-- AUTHORING ONLY until explicitly applied on dedicated non-Production staging.
-- Do NOT apply to Production. Do NOT apply to Preview that shares Production.
-- Apply only after Phase 2A. Do not apply 2B-finalize without this file.
--
-- This migration:
--   * requires Phase 2A tenant columns to already exist and be backfilled
--   * backfills Tenant-1 counter last_value from GREATEST(counter, max historical suffix)
--   * does NOT rewrite transaction_number / batch_number / recovery_number
--   * adds UNIQUE (id, agency_profile_id) keys so 2B-finalize can add composite FKs
--   * adds tenant-scoped unique indexes that coexist with today's global number uniques
--   * RETAINS global transaction/batch/recovery uniques (dropped in Phase 3, not 2B)
--     so (Agency A, NUM) and (NULL, NUM) cannot coexist and later collide on stamp
--   * adds a transitional global unique on client_number (Production has none) for the
--     same stamp-safety reason; drop it in Phase 3 when tenant uniqueness is enough
--   * adds NULL-agency unique bridges (NULL-bucket only; not sufficient without global)
--   * SET NOT NULL on numbering COUNTER tables only (functions write them)
--   * adds unique (agency_profile_id, year) on counters (PK swap is 2B-finalize)
--   * installs numbering helper (does not replace next_* yet)
--
-- This migration does NOT:
--   * drop global transaction/batch/recovery unique indexes
--   * change next_* / set_* numbering functions (still ON CONFLICT (year))
--   * drop agency_profile_singleton
--   * SET NOT NULL on app-written business tables
--   * CREATE/DROP POLICY or change RLS
--   * touch task_number_counters
--   * create Agency B
--   * use first-agency / singleton fallback for numbering

-- ---------------------------------------------------------------------------
-- 0) Phase 2A presence + abort rather than guess
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t)
  INTO missing
  FROM unnest(ARRAY[
    'agency_profile',
    'clients',
    'policies',
    'transactions',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_payment_batch_items',
    'producer_commission_recoveries',
    'producer_recovery_allocations',
    'recovery_number_counters',
    'transaction_number_counters',
    'producer_payment_batch_number_counters',
    'reconciliation_statements',
    'reconciliation_statement_rows',
    'supporting_documents'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2B-prep abort: required table(s) missing: %', missing;
  END IF;

  IF (SELECT COUNT(*) FROM public.agency_profile) <> 1 THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: expected exactly 1 agency_profile while counter PK is still year; do not create Agency B until Phase 3/4';
  END IF;

  IF to_regproc('public.is_alza_support') IS NULL THEN
    RAISE EXCEPTION 'Phase 2B-prep abort: is_alza_support() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'agency_profile_id'
  ) THEN
    RAISE EXCEPTION 'Phase 2B-prep abort: Phase 2A tenant columns are not present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transaction_number IS NOT NULL AND btrim(transaction_number) <> ''
      AND agency_profile_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: numbered transactions still have NULL agency_profile_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producer_payment_batches
    WHERE batch_number IS NOT NULL AND btrim(batch_number) <> ''
      AND agency_profile_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: numbered payment batches still have NULL agency_profile_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producer_commission_recoveries
    WHERE recovery_number IS NOT NULL AND btrim(recovery_number) <> ''
      AND agency_profile_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: numbered recoveries still have NULL agency_profile_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transaction_number_counters WHERE agency_profile_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.producer_payment_batch_number_counters WHERE agency_profile_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.recovery_number_counters WHERE agency_profile_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: numbering counters still have NULL agency_profile_id';
  END IF;

  -- Global duplicate numbers would already violate Production uniques; abort with a
  -- named message anyway so a missing/renamed unique cannot silently proceed.
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE transaction_number IS NOT NULL AND btrim(transaction_number) <> ''
    GROUP BY transaction_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2B-prep abort: duplicate transaction_number values exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producer_payment_batches
    WHERE batch_number IS NOT NULL AND btrim(batch_number) <> ''
    GROUP BY batch_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2B-prep abort: duplicate batch_number values exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producer_commission_recoveries
    WHERE recovery_number IS NOT NULL AND btrim(recovery_number) <> ''
    GROUP BY recovery_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2B-prep abort: duplicate recovery_number values exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.clients
    WHERE client_number IS NOT NULL AND btrim(client_number) <> ''
    GROUP BY lower(btrim(client_number))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: duplicate client_number values exist (case-insensitive)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Numbering helper — resolve agency from the row or authenticated membership.
--    Does NOT stamp the row. Does NOT use first/singleton agency.
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
    IF session_agency IS NOT NULL
       AND row_agency IS DISTINCT FROM session_agency
       AND NOT public.is_alza_support() THEN
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
  'Phase 2B numbering only. Resolves agency from the inserting row or current_user_agency_profile_id(). Does not stamp agency_profile_id. Never falls back to the first/singleton agency. Phase 3/4 owns row stamping.';

REVOKE ALL ON FUNCTION public.multitenancy_numbering_agency(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.multitenancy_numbering_agency(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Preserve historical numbers: raise counter last_value to max existing suffix.
--    Never UPDATE the business-number columns. Never reduce last_value.
--    Malformed / non-matching strings are ignored for counter math (row preserved).
--    Parsed year comes from the number, not CURRENT_DATE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  txn_underrun integer;
  batch_underrun integer;
  rec_underrun integer;
BEGIN
  -- Transactions TRX-YYYY-######
  INSERT INTO public.transaction_number_counters (year, last_value, agency_profile_id)
  SELECT
    (regexp_match(t.transaction_number, '^TRX-([0-9]{4})-([0-9]+)$'))[1]::integer,
    MAX((regexp_match(t.transaction_number, '^TRX-([0-9]{4})-([0-9]+)$'))[2]::integer),
    t.agency_profile_id
  FROM public.transactions t
  WHERE t.transaction_number ~ '^TRX-[0-9]{4}-[0-9]+$'
    AND t.agency_profile_id IS NOT NULL
  GROUP BY t.agency_profile_id, 1
  ON CONFLICT (year) DO UPDATE
    SET last_value = GREATEST(
      public.transaction_number_counters.last_value,
      EXCLUDED.last_value
    );

  -- Batches PREFIX-YYYY-###### (Production generator uses PPB-; generic parse
  -- never misses a higher suffix from a historical prefix).
  INSERT INTO public.producer_payment_batch_number_counters (year, last_value, agency_profile_id)
  SELECT
    (regexp_match(b.batch_number, '^[A-Za-z]+-([0-9]{4})-([0-9]+)$'))[1]::integer,
    MAX((regexp_match(b.batch_number, '^[A-Za-z]+-([0-9]{4})-([0-9]+)$'))[2]::integer),
    b.agency_profile_id
  FROM public.producer_payment_batches b
  WHERE b.batch_number ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$'
    AND b.agency_profile_id IS NOT NULL
  GROUP BY b.agency_profile_id, 1
  ON CONFLICT (year) DO UPDATE
    SET last_value = GREATEST(
      public.producer_payment_batch_number_counters.last_value,
      EXCLUDED.last_value
    );

  -- Recoveries RCV-YYYY-######
  INSERT INTO public.recovery_number_counters (year, last_value, agency_profile_id)
  SELECT
    (regexp_match(r.recovery_number, '^RCV-([0-9]{4})-([0-9]+)$'))[1]::integer,
    MAX((regexp_match(r.recovery_number, '^RCV-([0-9]{4})-([0-9]+)$'))[2]::integer),
    r.agency_profile_id
  FROM public.producer_commission_recoveries r
  WHERE r.recovery_number ~ '^RCV-[0-9]{4}-[0-9]+$'
    AND r.agency_profile_id IS NOT NULL
  GROUP BY r.agency_profile_id, 1
  ON CONFLICT (year) DO UPDATE
    SET last_value = GREATEST(
      public.recovery_number_counters.last_value,
      EXCLUDED.last_value
    );

  -- Monotonicity: last_value must be >= every parsed historical suffix.
  SELECT COUNT(*) INTO txn_underrun
  FROM (
    SELECT
      t.agency_profile_id,
      (regexp_match(t.transaction_number, '^TRX-([0-9]{4})-([0-9]+)$'))[1]::integer AS yr,
      MAX((regexp_match(t.transaction_number, '^TRX-([0-9]{4})-([0-9]+)$'))[2]::integer) AS mx
    FROM public.transactions t
    WHERE t.transaction_number ~ '^TRX-[0-9]{4}-[0-9]+$'
      AND t.agency_profile_id IS NOT NULL
    GROUP BY t.agency_profile_id, 2
  ) s
  JOIN public.transaction_number_counters c
    ON c.agency_profile_id = s.agency_profile_id AND c.year = s.yr
  WHERE c.last_value < s.mx;

  SELECT COUNT(*) INTO batch_underrun
  FROM (
    SELECT
      b.agency_profile_id,
      (regexp_match(b.batch_number, '^[A-Za-z]+-([0-9]{4})-([0-9]+)$'))[1]::integer AS yr,
      MAX((regexp_match(b.batch_number, '^[A-Za-z]+-([0-9]{4})-([0-9]+)$'))[2]::integer) AS mx
    FROM public.producer_payment_batches b
    WHERE b.batch_number ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$'
      AND b.agency_profile_id IS NOT NULL
    GROUP BY b.agency_profile_id, 2
  ) s
  JOIN public.producer_payment_batch_number_counters c
    ON c.agency_profile_id = s.agency_profile_id AND c.year = s.yr
  WHERE c.last_value < s.mx;

  SELECT COUNT(*) INTO rec_underrun
  FROM (
    SELECT
      r.agency_profile_id,
      (regexp_match(r.recovery_number, '^RCV-([0-9]{4})-([0-9]+)$'))[1]::integer AS yr,
      MAX((regexp_match(r.recovery_number, '^RCV-([0-9]{4})-([0-9]+)$'))[2]::integer) AS mx
    FROM public.producer_commission_recoveries r
    WHERE r.recovery_number ~ '^RCV-[0-9]{4}-[0-9]+$'
      AND r.agency_profile_id IS NOT NULL
    GROUP BY r.agency_profile_id, 2
  ) s
  JOIN public.recovery_number_counters c
    ON c.agency_profile_id = s.agency_profile_id AND c.year = s.yr
  WHERE c.last_value < s.mx;

  IF txn_underrun > 0 OR batch_underrun > 0 OR rec_underrun > 0 THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: counter last_value underran historical max suffix (txn %, batch %, recovery %)',
      txn_underrun, batch_underrun, rec_underrun;
  END IF;
END $$;

-- Counter tables are written only by numbering functions. Safe to NOT NULL in 2B.
ALTER TABLE public.transaction_number_counters
  ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.producer_payment_batch_number_counters
  ALTER COLUMN agency_profile_id SET NOT NULL;
ALTER TABLE public.recovery_number_counters
  ALTER COLUMN agency_profile_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_number_counters_agency_year_uidx
  ON public.transaction_number_counters (agency_profile_id, year);
CREATE UNIQUE INDEX IF NOT EXISTS producer_payment_batch_number_counters_agency_year_uidx
  ON public.producer_payment_batch_number_counters (agency_profile_id, year);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_number_counters_agency_year_uidx
  ON public.recovery_number_counters (agency_profile_id, year);

-- ---------------------------------------------------------------------------
-- 3) Parent UNIQUE (id, agency_profile_id) — prerequisite for composite FKs
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  con text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients',
    'policies',
    'transactions',
    'producers',
    'agency_commission_receipts',
    'producer_payment_batches',
    'producer_commission_recoveries',
    'reconciliation_statements'
  ]
  LOOP
    con := t || '_id_agency_profile_key';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = con) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, agency_profile_id)',
        t,
        con
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Tenant-scoped number uniqueness (coexists with global uniques until Phase 3)
--
-- NULL-agency bridges only unique the NULL bucket. They do NOT prevent
-- (Agency A, NUM) and (NULL, NUM) from coexisting. That coexistence would
-- become a unique violation when Phase 3 stamps NULL → Agency A.
-- Stamp-safety therefore requires a global unique on the number itself:
--   * transactions/batches/recoveries: keep Production global uniques
--   * clients: add a transitional global unique (Production has none)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.clients
    WHERE agency_profile_id IS NOT NULL
      AND client_number IS NOT NULL AND btrim(client_number) <> ''
    GROUP BY agency_profile_id, lower(btrim(client_number))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: duplicate client_number within an agency';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.policies
    WHERE client_id IS NOT NULL
      AND policy_number IS NOT NULL AND btrim(policy_number) <> ''
    GROUP BY client_id, lower(btrim(policy_number))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Phase 2B-prep abort: duplicate policy_number within a client';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS clients_agency_client_number_uidx
  ON public.clients (agency_profile_id, lower(btrim(client_number)))
  WHERE agency_profile_id IS NOT NULL
    AND client_number IS NOT NULL
    AND btrim(client_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS clients_null_agency_client_number_uidx
  ON public.clients (lower(btrim(client_number)))
  WHERE agency_profile_id IS NULL
    AND client_number IS NOT NULL
    AND btrim(client_number) <> '';

-- Transitional: unique across stamped + NULL rows so Phase 3 stamping cannot collide.
-- Drop in Phase 3 after insert-stamping (Agency B may then share client numbers).
CREATE UNIQUE INDEX IF NOT EXISTS clients_transitional_global_client_number_uidx
  ON public.clients (lower(btrim(client_number)))
  WHERE client_number IS NOT NULL
    AND btrim(client_number) <> '';

-- Product contract: policy number unique per client, not per agency.
CREATE UNIQUE INDEX IF NOT EXISTS policies_client_policy_number_uidx
  ON public.policies (client_id, lower(btrim(policy_number)))
  WHERE client_id IS NOT NULL
    AND policy_number IS NOT NULL
    AND btrim(policy_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS transactions_agency_transaction_number_uidx
  ON public.transactions (agency_profile_id, transaction_number)
  WHERE agency_profile_id IS NOT NULL
    AND transaction_number IS NOT NULL
    AND btrim(transaction_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS transactions_null_agency_transaction_number_uidx
  ON public.transactions (transaction_number)
  WHERE agency_profile_id IS NULL
    AND transaction_number IS NOT NULL
    AND btrim(transaction_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS producer_payment_batches_agency_batch_number_uidx
  ON public.producer_payment_batches (agency_profile_id, batch_number)
  WHERE agency_profile_id IS NOT NULL
    AND batch_number IS NOT NULL
    AND btrim(batch_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS producer_payment_batches_null_agency_batch_number_uidx
  ON public.producer_payment_batches (batch_number)
  WHERE agency_profile_id IS NULL
    AND batch_number IS NOT NULL
    AND btrim(batch_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS producer_commission_recoveries_agency_recovery_number_uidx
  ON public.producer_commission_recoveries (agency_profile_id, recovery_number)
  WHERE agency_profile_id IS NOT NULL
    AND recovery_number IS NOT NULL
    AND btrim(recovery_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS producer_commission_recoveries_null_agency_recovery_number_uidx
  ON public.producer_commission_recoveries (recovery_number)
  WHERE agency_profile_id IS NULL
    AND recovery_number IS NOT NULL
    AND btrim(recovery_number) <> '';

-- Directory names: no unique index. See docs/multitenancy-v1-implementation-notes.md.

COMMENT ON INDEX public.clients_agency_client_number_uidx IS
  'Phase 2B: tenant-scoped client_number. End-state uniqueness; Agency B sharing waits until Phase 3 drops the transitional global unique.';
COMMENT ON INDEX public.clients_null_agency_client_number_uidx IS
  'Phase 2B: NULL-bucket client_number unique. Not sufficient for stamp-safety without clients_transitional_global_client_number_uidx.';
COMMENT ON INDEX public.clients_transitional_global_client_number_uidx IS
  'Phase 2B transitional: client_number unique across stamped and NULL rows so Phase 3 stamping cannot collide. Drop in Phase 3 after insert-stamping.';
COMMENT ON INDEX public.policies_client_policy_number_uidx IS
  'Phase 2B: policy_number unique per client, not per agency.';
COMMENT ON INDEX public.transactions_agency_transaction_number_uidx IS
  'Phase 2B: tenant-scoped transaction_number. Production global unique is retained until Phase 3.';
COMMENT ON INDEX public.transactions_null_agency_transaction_number_uidx IS
  'Phase 2B: NULL-bucket transaction_number unique. Stamp-safety depends on retaining transactions_transaction_number_key / _uidx until Phase 3.';
COMMENT ON INDEX public.transaction_number_counters_agency_year_uidx IS
  'Phase 2B-prep: counter identity (agency_profile_id, year). Promoted to PK in 2B-finalize.';
