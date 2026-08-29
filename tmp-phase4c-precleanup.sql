-- Phase 4C staging pre-cleanup — ONLY known ephemeral 4C/debug fixture producers.
-- Does NOT delete policies by broad 4C-% / DBG% patterns (those wiped seed POL-STAGING-0001).
-- Per-run cleanup in tmp-phase4c-staging-jwt.ts deletes by fixture IDs only.

DELETE FROM public.reconciliation_statement_rows
WHERE statement_id IN (
  SELECT id FROM public.reconciliation_statements
  WHERE file_name LIKE 'dbg%.csv' OR file_name LIKE 'phase4c-%.csv'
     OR file_hash LIKE 'phase4c-%' OR file_hash LIKE 'dbg%'
);
DELETE FROM public.reconciliation_statements
WHERE file_name LIKE 'dbg%.csv' OR file_name LIKE 'phase4c-%.csv'
   OR file_hash LIKE 'phase4c-%' OR file_hash LIKE 'dbg%';

UPDATE public.transactions
SET agency_commission_receipt_id = NULL,
    agency_commission_confirmed = false,
    amount_received = NULL,
    received_date = NULL,
    review_status = 'expected'
WHERE producer IN ('DBG', '4C-MATCH', 'DBG2')
  AND id NOT IN (
    -- never touch seed book
    SELECT id FROM public.transactions WHERE producer = 'DUMMY Payout V1 Producer'
  );

DELETE FROM public.agency_commission_receipts
WHERE transaction_id IN (
  SELECT id FROM public.transactions WHERE producer IN ('DBG', '4C-MATCH', 'DBG2')
);
DELETE FROM public.transactions WHERE producer IN ('DBG', '4C-MATCH', 'DBG2');

-- Only delete ephemeral 4C policies that are unused by any remaining transaction
-- and are NOT the known seed policy id.
DELETE FROM public.policies p
WHERE p.id <> '05000000-0000-4000-8000-000000000005'
  AND p.policy_number <> 'POL-STAGING-0001'
  AND (
    p.policy_number LIKE '4C-%'
    OR p.policy_number LIKE 'DBG%'
    OR p.policy_number LIKE 'DBG2-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions t WHERE t.policy_id = p.id
  );
