-- V1 carrier/MGA statement reconciliation foundation.
-- Additive only: new tables, indexes, RLS, storage bucket.
-- Does not alter transactions, receipts, recoveries, payouts, or approval columns.

-- ---------------------------------------------------------------------------
-- 1) Statements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_profile_id uuid NOT NULL REFERENCES public.agency_profile(id),
  carrier text,
  mga text,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  mga_id uuid REFERENCES public.mgas(id) ON DELETE SET NULL,
  statement_date date,
  period_start date NOT NULL,
  period_end date NOT NULL,
  file_name text NOT NULL,
  file_hash text NOT NULL,
  file_storage_path text,
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'mapping', 'staged', 'matching', 'matched', 'reviewed', 'completed', 'cancelled'
    )),
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  confirmed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  rounding_tolerance numeric NOT NULL DEFAULT 0.01,
  notes text,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_statements_period_chk CHECK (period_start <= period_end),
  CONSTRAINT reconciliation_statements_file_hash_agency_uid UNIQUE (file_hash, agency_profile_id)
);

COMMENT ON TABLE public.reconciliation_statements IS
  'One imported carrier/MGA commission statement file. Reconciliation confirms agency receipts only; it does not recalculate producer splits, broker fees, recoveries, or payouts.';

CREATE INDEX IF NOT EXISTS reconciliation_statements_status_idx
  ON public.reconciliation_statements (status);

CREATE INDEX IF NOT EXISTS reconciliation_statements_agency_created_idx
  ON public.reconciliation_statements (agency_profile_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) Saved column mappings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_column_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_profile_id uuid NOT NULL REFERENCES public.agency_profile(id),
  name text NOT NULL,
  carrier text,
  mga text,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  mga_id uuid REFERENCES public.mgas(id) ON DELETE SET NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_column_mappings_agency_name_uid UNIQUE (agency_profile_id, name)
);

COMMENT ON TABLE public.reconciliation_column_mappings IS
  'Reusable CSV/XLSX column mappings per carrier/MGA statement layout.';

CREATE INDEX IF NOT EXISTS reconciliation_column_mappings_carrier_id_idx
  ON public.reconciliation_column_mappings (carrier_id)
  WHERE carrier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_column_mappings_mga_id_idx
  ON public.reconciliation_column_mappings (mga_id)
  WHERE mga_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Statement rows (imported + synthetic missing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_statement_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES public.reconciliation_statements(id) ON DELETE CASCADE,
  row_source text NOT NULL DEFAULT 'import'
    CHECK (row_source IN ('import', 'missing')),
  row_index integer NOT NULL,
  raw_data jsonb,
  policy_number text,
  client_name text,
  commission_amount numeric,
  premium_amount numeric,
  transaction_date date,
  transaction_type text,
  carrier_name text,
  mga_name text,
  description text,
  external_reference text,
  match_status text NOT NULL DEFAULT 'pending'
    CHECK (match_status IN (
      'pending', 'auto_matched', 'manual_matched', 'unmatched', 'exception', 'confirmed', 'skipped'
    )),
  match_confidence text
    CHECK (match_confidence IS NULL OR match_confidence IN ('high', 'medium', 'low', 'none')),
  matched_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  expected_commission numeric,
  variance numeric,
  discrepancy_type text
    CHECK (
      discrepancy_type IS NULL
      OR discrepancy_type IN (
        'exact_match', 'underpaid', 'overpaid', 'missing_from_statement', 'unmatched_row', 'zero_amount'
      )
    ),
  resolution_status text NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open', 'acknowledged', 'resolved', 'ignored')),
  resolution_notes text,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  receipt_id uuid REFERENCES public.agency_commission_receipts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_statement_rows_stmt_source_idx_uid
    UNIQUE (statement_id, row_source, row_index)
);

COMMENT ON TABLE public.reconciliation_statement_rows IS
  'Parsed statement lines plus synthetic missing-from-statement rows. One row may produce at most one agency_commission_receipts row for one transaction.';

COMMENT ON COLUMN public.reconciliation_statement_rows.commission_amount IS
  'Signed carrier-reported commission. Negative amounts are normal for cancellations, negative endorsements, and return audits.';

COMMENT ON COLUMN public.reconciliation_statement_rows.expected_commission IS
  'Signed expected_amount (fallback agency_commission_amount) from the matched ALZA Flow transaction.';

CREATE INDEX IF NOT EXISTS reconciliation_statement_rows_stmt_status_idx
  ON public.reconciliation_statement_rows (statement_id, match_status);

CREATE INDEX IF NOT EXISTS reconciliation_statement_rows_matched_txn_idx
  ON public.reconciliation_statement_rows (matched_transaction_id)
  WHERE matched_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_statement_rows_policy_idx
  ON public.reconciliation_statement_rows (policy_number)
  WHERE policy_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.reconciliation_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_column_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_statement_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_statements_select_ops ON public.reconciliation_statements;
DROP POLICY IF EXISTS reconciliation_statements_insert_ops ON public.reconciliation_statements;
DROP POLICY IF EXISTS reconciliation_statements_update_ops ON public.reconciliation_statements;
DROP POLICY IF EXISTS reconciliation_statements_delete_ops ON public.reconciliation_statements;

CREATE POLICY reconciliation_statements_select_ops
  ON public.reconciliation_statements FOR SELECT TO authenticated
  USING (public.is_ops_staff());

CREATE POLICY reconciliation_statements_insert_ops
  ON public.reconciliation_statements FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_staff());

CREATE POLICY reconciliation_statements_update_ops
  ON public.reconciliation_statements FOR UPDATE TO authenticated
  USING (public.is_ops_staff())
  WITH CHECK (public.is_ops_staff());

CREATE POLICY reconciliation_statements_delete_ops
  ON public.reconciliation_statements FOR DELETE TO authenticated
  USING (public.is_ops_staff());

DROP POLICY IF EXISTS reconciliation_column_mappings_select_ops ON public.reconciliation_column_mappings;
DROP POLICY IF EXISTS reconciliation_column_mappings_insert_ops ON public.reconciliation_column_mappings;
DROP POLICY IF EXISTS reconciliation_column_mappings_update_ops ON public.reconciliation_column_mappings;
DROP POLICY IF EXISTS reconciliation_column_mappings_delete_ops ON public.reconciliation_column_mappings;

CREATE POLICY reconciliation_column_mappings_select_ops
  ON public.reconciliation_column_mappings FOR SELECT TO authenticated
  USING (public.is_ops_staff());

CREATE POLICY reconciliation_column_mappings_insert_ops
  ON public.reconciliation_column_mappings FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_staff());

CREATE POLICY reconciliation_column_mappings_update_ops
  ON public.reconciliation_column_mappings FOR UPDATE TO authenticated
  USING (public.is_ops_staff())
  WITH CHECK (public.is_ops_staff());

CREATE POLICY reconciliation_column_mappings_delete_ops
  ON public.reconciliation_column_mappings FOR DELETE TO authenticated
  USING (public.is_ops_staff());

DROP POLICY IF EXISTS reconciliation_statement_rows_select_ops ON public.reconciliation_statement_rows;
DROP POLICY IF EXISTS reconciliation_statement_rows_insert_ops ON public.reconciliation_statement_rows;
DROP POLICY IF EXISTS reconciliation_statement_rows_update_ops ON public.reconciliation_statement_rows;
DROP POLICY IF EXISTS reconciliation_statement_rows_delete_ops ON public.reconciliation_statement_rows;

CREATE POLICY reconciliation_statement_rows_select_ops
  ON public.reconciliation_statement_rows FOR SELECT TO authenticated
  USING (public.is_ops_staff());

CREATE POLICY reconciliation_statement_rows_insert_ops
  ON public.reconciliation_statement_rows FOR INSERT TO authenticated
  WITH CHECK (public.is_ops_staff());

CREATE POLICY reconciliation_statement_rows_update_ops
  ON public.reconciliation_statement_rows FOR UPDATE TO authenticated
  USING (public.is_ops_staff())
  WITH CHECK (public.is_ops_staff());

CREATE POLICY reconciliation_statement_rows_delete_ops
  ON public.reconciliation_statement_rows FOR DELETE TO authenticated
  USING (public.is_ops_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_statements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_column_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_statement_rows TO authenticated;
GRANT ALL ON public.reconciliation_statements TO service_role;
GRANT ALL ON public.reconciliation_column_mappings TO service_role;
GRANT ALL ON public.reconciliation_statement_rows TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Storage bucket (audit trail of raw statement files)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reconciliation-statements',
  'reconciliation-statements',
  false,
  20971520,
  ARRAY[
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS reconciliation_statements_storage_select ON storage.objects;
DROP POLICY IF EXISTS reconciliation_statements_storage_insert ON storage.objects;
DROP POLICY IF EXISTS reconciliation_statements_storage_update ON storage.objects;
DROP POLICY IF EXISTS reconciliation_statements_storage_delete ON storage.objects;

CREATE POLICY reconciliation_statements_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reconciliation-statements' AND public.is_ops_staff());

CREATE POLICY reconciliation_statements_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reconciliation-statements' AND public.is_ops_staff());

CREATE POLICY reconciliation_statements_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'reconciliation-statements' AND public.is_ops_staff())
  WITH CHECK (bucket_id = 'reconciliation-statements' AND public.is_ops_staff());

CREATE POLICY reconciliation_statements_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reconciliation-statements' AND public.is_admin_directory_role());
