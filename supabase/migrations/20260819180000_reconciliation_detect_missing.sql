-- Opt-in missing-commission detection for a full carrier/MGA period.
-- Default false so a partial statement does not flag the rest of the book.

ALTER TABLE public.reconciliation_statements
  ADD COLUMN IF NOT EXISTS detect_missing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reconciliation_statements.detect_missing IS
  'When true, matching may create missing_from_statement rows for unpaid same-carrier/MGA transactions in the statement period. Default false so partial statements do not flag the rest of the book.';
