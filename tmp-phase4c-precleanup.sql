-- Phase 4C staging fixture cleanup (debug + orphaned reconciliation rows)
DELETE FROM public.reconciliation_statement_rows
WHERE statement_id IN (
  SELECT id FROM public.reconciliation_statements
  WHERE file_name LIKE 'dbg%' OR file_name LIKE 'phase4c-%' OR file_hash LIKE 'phase4c-%' OR file_hash LIKE 'dbg%'
);
DELETE FROM public.reconciliation_statements
WHERE file_name LIKE 'dbg%' OR file_name LIKE 'phase4c-%' OR file_hash LIKE 'phase4c-%' OR file_hash LIKE 'dbg%';
UPDATE public.transactions
SET agency_commission_receipt_id = NULL,
    agency_commission_confirmed = false,
    amount_received = NULL,
    received_date = NULL,
    review_status = 'expected'
WHERE producer IN ('DBG', '4C-MATCH', 'DBG2');
DELETE FROM public.agency_commission_receipts
WHERE transaction_id IN (
  SELECT id FROM public.transactions WHERE producer IN ('DBG', '4C-MATCH', 'DBG2')
);
DELETE FROM public.transactions WHERE producer IN ('DBG', '4C-MATCH', 'DBG2');
DELETE FROM public.policies
WHERE policy_number LIKE '4C-%' OR policy_number LIKE 'DBG%';
