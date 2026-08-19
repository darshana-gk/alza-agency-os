-- Additive: allow agency_commission_receipts.source = 'reconciliation'.
-- Does not alter existing rows. Does not change reconciliation_status CHECK.

ALTER TABLE public.agency_commission_receipts
  DROP CONSTRAINT IF EXISTS agency_commission_receipts_source_check;

ALTER TABLE public.agency_commission_receipts
  ADD CONSTRAINT agency_commission_receipts_source_check
  CHECK (source = ANY (ARRAY[
    'ascend'::text,
    'webhook'::text,
    'api'::text,
    'csv'::text,
    'manual'::text,
    'reconciliation'::text
  ]));

COMMENT ON CONSTRAINT agency_commission_receipts_source_check ON public.agency_commission_receipts IS
  'Receipt origin. reconciliation is written only by confirm-reconciliation-receipts; existing sources are unchanged.';
