-- STAGING ONLY — UAT BUG 007
-- Bring public.transactions to Production V1 financial-column parity.
--
-- DO NOT APPLY TO PRODUCTION (rwxhqvrpqbkrrfamizgn).
-- Production already has these columns from:
--   20260812183000_broker_fee_commission_type_foundation.sql
--   20260813210000_transaction_dates_and_doc_mime.sql
--   plus baseline amount / split / net / snapshot text columns.
--
-- Additive only:
-- - ADD COLUMN IF NOT EXISTS
-- - Does NOT rewrite stored money on existing rows (no broker_fee / split / net backfill
--   from policy defaults or derived percentages)
-- - Does NOT touch RLS, tenant FKs, numbering, review/payment workflow, or Phase 3 RPCs
-- - Voided/archived rows are unchanged

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS csr text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS mga text,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS carrier_commission_percentage numeric,
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS agency_commission_percentage numeric,
  ADD COLUMN IF NOT EXISTS broker_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_amount numeric,
  ADD COLUMN IF NOT EXISTS producer_split_percentage numeric,
  ADD COLUMN IF NOT EXISTS agency_net_commission numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_payment_date date,
  ADD COLUMN IF NOT EXISTS transaction_effective_date date,
  ADD COLUMN IF NOT EXISTS transaction_expiration_date date;

COMMENT ON COLUMN public.transactions.commission_type IS
  'Snapshot commission basis at transaction create/edit time: percentage | flat.';
COMMENT ON COLUMN public.transactions.broker_fee IS
  'Snapshot broker fee at transaction time. Explicit; not re-read from policy. May be 0, positive, or negative.';
COMMENT ON COLUMN public.transactions.agency_commission_percentage IS
  'Snapshot agency commission percent at transaction time. NULL for flat basis.';
COMMENT ON COLUMN public.transactions.producer_split_percentage IS
  'Snapshot producer split percent at transaction time. NULL when unknown (do not invent 0%).';
COMMENT ON COLUMN public.transactions.agency_net_commission IS
  'Snapshot agency net (pool − producer) at transaction time.';
COMMENT ON COLUMN public.transactions.expected_amount IS
  'Expected agency commission amount snapshot (mirrors agency_commission_amount at create).';
COMMENT ON COLUMN public.transactions.amount IS
  'Signed premium movement for the transaction (same meaning as premium_amount).';
COMMENT ON COLUMN public.transactions.transaction_effective_date IS
  'Transaction-level effective date snapshot (may differ from policy).';
COMMENT ON COLUMN public.transactions.transaction_expiration_date IS
  'Transaction-level expiration date snapshot (may differ from policy).';
COMMENT ON COLUMN public.transactions.csr IS
  'CSR name snapshot at transaction time.';
COMMENT ON COLUMN public.transactions.carrier IS
  'Carrier name snapshot at transaction time.';
COMMENT ON COLUMN public.transactions.mga IS
  'MGA name snapshot at transaction time.';

-- amount is the Production premium column; staging historically stored only premium_amount.
UPDATE public.transactions
SET amount = premium_amount
WHERE amount IS NULL
  AND premium_amount IS NOT NULL;

UPDATE public.transactions
SET expected_amount = agency_commission_amount
WHERE expected_amount IS NULL
  AND agency_commission_amount IS NOT NULL;

UPDATE public.transactions
SET carrier_commission_percentage = agency_commission_percentage
WHERE carrier_commission_percentage IS NULL
  AND agency_commission_percentage IS NOT NULL;

UPDATE public.transactions
SET status = COALESCE(NULLIF(trim(status), ''), 'pending')
WHERE status IS NULL OR trim(status) = '';

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_commission_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_commission_type_check
  CHECK (commission_type IN ('percentage', 'flat'));

-- Record this staging-only apply. Production must never receive this version.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260831140000', 'staging_transactions_v1_financial_parity')
ON CONFLICT (version) DO NOTHING;
