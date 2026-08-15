-- STEP 17 — Broker fee + percentage/flat commission foundation
--
-- REVIEW / APPLY MANUALLY in Supabase SQL editor (or authorized migrate).
-- This file is CREATED ONLY from the app environment — DDL cannot be run via anon REST.
--
-- Safety guarantees:
-- - Does NOT recalculate agency_commission_amount / producer_commission_amount / agency_net_commission
-- - Does NOT touch receipts, payment batches, recoveries, or paid/batched rows' money
-- - Existing rows default to commission_type='percentage', broker_fee=0 (preserves prior math)
-- - Does NOT drop or rename legacy carrier_commission_percentage

-- ---------------------------------------------------------------------------
-- 1) POLICIES — commission_type + broker_fee
-- ---------------------------------------------------------------------------

ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS broker_fee numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.policies.commission_type IS
  'Default commission basis for new transactions: percentage | flat.';
COMMENT ON COLUMN public.policies.broker_fee IS
  'Default broker fee included in commission pool (shared with producer). Snapshot onto transactions at create time.';

-- Flat basis does not use a percentage — allow NULL (do not fake 0%).
ALTER TABLE public.policies
  ALTER COLUMN agency_commission_percentage DROP NOT NULL;

ALTER TABLE public.policies
  DROP CONSTRAINT IF EXISTS policies_commission_type_check;

ALTER TABLE public.policies
  ADD CONSTRAINT policies_commission_type_check
  CHECK (commission_type IN ('percentage', 'flat'));

-- ---------------------------------------------------------------------------
-- 2) TRANSACTIONS — commission_type + broker_fee (per-row snapshot)
-- ---------------------------------------------------------------------------

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS broker_fee numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.transactions.commission_type IS
  'Snapshot commission basis at transaction create/edit time: percentage | flat.';
COMMENT ON COLUMN public.transactions.broker_fee IS
  'Snapshot broker fee at transaction time. Explicit; not re-read from policy. May be 0, positive, or negative.';

ALTER TABLE public.transactions
  ALTER COLUMN agency_commission_percentage DROP NOT NULL;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_commission_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_commission_type_check
  CHECK (commission_type IN ('percentage', 'flat'));

-- ---------------------------------------------------------------------------
-- 3) Backfill defaults only (no amount recalculation)
-- ---------------------------------------------------------------------------

UPDATE public.policies
SET
  commission_type = COALESCE(commission_type, 'percentage'),
  broker_fee = COALESCE(broker_fee, 0)
WHERE commission_type IS NULL
   OR broker_fee IS NULL;

UPDATE public.transactions
SET
  commission_type = COALESCE(commission_type, 'percentage'),
  broker_fee = COALESCE(broker_fee, 0)
WHERE commission_type IS NULL
   OR broker_fee IS NULL;
