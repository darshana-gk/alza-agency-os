-- Reconciliation Pass 2: statement lifecycle DB protection + one receipt per transaction.
-- Additive only. Does not modify existing rows except on future writes governed by new rules.

-- ---------------------------------------------------------------------------
-- 1) Owner/Admin lifecycle gate for reconciliation_statements.status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_reconciliation_statement_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed'
       OR (OLD.status = 'completed' AND NEW.status = 'cancelled') THEN
      IF NOT public.is_admin_directory_role() THEN
        RAISE EXCEPTION
          'Only Owner or Admin may complete or cancel a completed reconciliation statement.';
      END IF;
    END IF;

    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      IF EXISTS (
        SELECT 1
        FROM public.reconciliation_statement_rows r
        WHERE r.statement_id = NEW.id
          AND r.match_status IN ('auto_matched', 'manual_matched')
          AND r.receipt_id IS NULL
      ) THEN
        RAISE EXCEPTION
          'Confirm matched commission receipts before completing this statement.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_reconciliation_statement_lifecycle() IS
  'Blocks CSR from completing statements or cancelling completed statements. CSR may still update other columns when status is unchanged.';

DROP TRIGGER IF EXISTS reconciliation_statements_lifecycle_trg ON public.reconciliation_statements;

CREATE TRIGGER reconciliation_statements_lifecycle_trg
  BEFORE UPDATE ON public.reconciliation_statements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reconciliation_statement_lifecycle();

-- ---------------------------------------------------------------------------
-- 2) One agency commission receipt per transaction (transaction-level)
-- ---------------------------------------------------------------------------
-- Preflight (read-only, run before applying in production):
--   SELECT transaction_id, COUNT(*)
--   FROM agency_commission_receipts
--   WHERE transaction_id IS NOT NULL
--   GROUP BY transaction_id
--   HAVING COUNT(*) > 1;
-- Production preflight on 2026-08-20 returned zero duplicate groups.

CREATE UNIQUE INDEX IF NOT EXISTS agency_commission_receipts_transaction_id_uidx
  ON public.agency_commission_receipts (transaction_id)
  WHERE transaction_id IS NOT NULL;

COMMENT ON INDEX public.agency_commission_receipts_transaction_id_uidx IS
  'At most one agency commission receipt per transaction. Separate NB/endorsement/audit/cancellation transactions remain independent.';
