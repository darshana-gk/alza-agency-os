-- STEP 16 — Producer recovery database foundation
-- Schema + allocation ledger + RLS only.
-- Does NOT create payment-batch RPC.
-- Does NOT modify producer_payment_batches / batch_items data.
-- Does NOT touch PPB-2026-000004.
--
-- REVIEW ONLY until explicitly authorized to apply.

-- ---------------------------------------------------------------------------
-- 1) ALTER producer_commission_recoveries — balance + void audit columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.producer_commission_recoveries
  ADD COLUMN IF NOT EXISTS applied_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid;

COMMENT ON COLUMN public.producer_commission_recoveries.applied_amount IS
  'Cumulative amount applied to producer payment batches via producer_recovery_allocations.';
COMMENT ON COLUMN public.producer_commission_recoveries.remaining_amount IS
  'Unconsumed recovery balance available for future producer payouts.';
COMMENT ON COLUMN public.producer_commission_recoveries.voided_at IS
  'Set when status becomes voided; required for status=voided.';
COMMENT ON COLUMN public.producer_commission_recoveries.voided_by IS
  'Audit user id (same uuid convention as created_by).';

-- ---------------------------------------------------------------------------
-- 2) Backfill remaining_amount (safe; inspect statuses first in ops)
-- Live probe at STEP 16 creation time: 0 recovery rows, so no legacy
-- status conversion is performed here.
-- Do NOT convert pending/other statuses in this migration.
-- ---------------------------------------------------------------------------

UPDATE public.producer_commission_recoveries
SET
  applied_amount = COALESCE(applied_amount, 0),
  remaining_amount = COALESCE(amount, 0) - COALESCE(applied_amount, 0)
WHERE remaining_amount IS NULL;

-- Guard: refuse NOT NULL / constraints if unexpected statuses appear later.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM public.producer_commission_recoveries
  WHERE status IS NULL
     OR status NOT IN ('open', 'applied', 'voided');

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'STEP 16 aborted: % producer_commission_recoveries row(s) have status outside (open|applied|voided). Inspect and resolve before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.producer_commission_recoveries
  ALTER COLUMN remaining_amount SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Initialize remaining_amount on INSERT when omitted by clients
-- (BEFORE INSERT so NOT NULL + balance CHECKs see a concrete value)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.producer_commission_recoveries_init_balances()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.applied_amount IS NULL THEN
    NEW.applied_amount := 0;
  END IF;

  IF NEW.remaining_amount IS NULL THEN
    NEW.remaining_amount := NEW.amount - NEW.applied_amount;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producer_commission_recoveries_init_balances
  ON public.producer_commission_recoveries;

CREATE TRIGGER trg_producer_commission_recoveries_init_balances
  BEFORE INSERT ON public.producer_commission_recoveries
  FOR EACH ROW
  EXECUTE FUNCTION public.producer_commission_recoveries_init_balances();

-- ---------------------------------------------------------------------------
-- 4) Safety CHECK constraints (preserve existing status CHECK open|applied|voided)
-- ---------------------------------------------------------------------------

ALTER TABLE public.producer_commission_recoveries
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_amount_positive,
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_applied_nonneg,
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_remaining_nonneg,
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_applied_lte_amount,
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_remaining_lte_amount,
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_balance_identity,
  DROP CONSTRAINT IF EXISTS producer_commission_recoveries_status_consistency;

ALTER TABLE public.producer_commission_recoveries
  ADD CONSTRAINT producer_commission_recoveries_amount_positive
    CHECK (amount > 0),
  ADD CONSTRAINT producer_commission_recoveries_applied_nonneg
    CHECK (applied_amount >= 0),
  ADD CONSTRAINT producer_commission_recoveries_remaining_nonneg
    CHECK (remaining_amount >= 0),
  ADD CONSTRAINT producer_commission_recoveries_applied_lte_amount
    CHECK (applied_amount <= amount),
  ADD CONSTRAINT producer_commission_recoveries_remaining_lte_amount
    CHECK (remaining_amount <= amount),
  ADD CONSTRAINT producer_commission_recoveries_balance_identity
    CHECK (
      status = 'voided'
      OR (applied_amount + remaining_amount = amount)
    ),
  ADD CONSTRAINT producer_commission_recoveries_status_consistency
    CHECK (
      (status = 'open' AND remaining_amount > 0 AND voided_at IS NULL)
      OR (status = 'applied' AND remaining_amount = 0 AND voided_at IS NULL)
      OR (status = 'voided' AND voided_at IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- 5) Allocation ledger (multi-batch recovery application)
-- Planned RPC creates at most one allocation per (recovery_id, payment_batch_id).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.producer_recovery_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id uuid NOT NULL
    REFERENCES public.producer_commission_recoveries (id),
  payment_batch_id uuid NOT NULL
    REFERENCES public.producer_payment_batches (id),
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT producer_recovery_allocations_amount_positive CHECK (amount > 0),
  CONSTRAINT producer_recovery_allocations_recovery_batch_unique
    UNIQUE (recovery_id, payment_batch_id)
);

COMMENT ON TABLE public.producer_recovery_allocations IS
  'Ledger of recovery amounts applied to producer payment batches. One row per recovery/batch pair.';

CREATE INDEX IF NOT EXISTS producer_recovery_allocations_recovery_id_idx
  ON public.producer_recovery_allocations (recovery_id);

CREATE INDEX IF NOT EXISTS producer_recovery_allocations_payment_batch_id_idx
  ON public.producer_recovery_allocations (payment_batch_id);

-- ---------------------------------------------------------------------------
-- 6) RLS — same ops-staff pattern as financial operational tables
-- authenticated + public.is_ops_staff() (owner | admin | csr)
-- ---------------------------------------------------------------------------

ALTER TABLE public.producer_recovery_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS producer_recovery_allocations_select_ops
  ON public.producer_recovery_allocations;
DROP POLICY IF EXISTS producer_recovery_allocations_insert_ops
  ON public.producer_recovery_allocations;
DROP POLICY IF EXISTS producer_recovery_allocations_update_ops
  ON public.producer_recovery_allocations;
DROP POLICY IF EXISTS producer_recovery_allocations_delete_ops
  ON public.producer_recovery_allocations;

CREATE POLICY producer_recovery_allocations_select_ops
  ON public.producer_recovery_allocations
  FOR SELECT
  TO authenticated
  USING (public.is_ops_staff());

CREATE POLICY producer_recovery_allocations_insert_ops
  ON public.producer_recovery_allocations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_ops_staff());

CREATE POLICY producer_recovery_allocations_update_ops
  ON public.producer_recovery_allocations
  FOR UPDATE
  TO authenticated
  USING (public.is_ops_staff())
  WITH CHECK (public.is_ops_staff());

CREATE POLICY producer_recovery_allocations_delete_ops
  ON public.producer_recovery_allocations
  FOR DELETE
  TO authenticated
  USING (public.is_ops_staff());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.producer_recovery_allocations
  TO authenticated;

GRANT ALL
  ON public.producer_recovery_allocations
  TO service_role;

-- Explicitly no grants to anon beyond whatever project defaults already withhold.
-- Unauthorized / anon roles cannot write allocations under these policies.
