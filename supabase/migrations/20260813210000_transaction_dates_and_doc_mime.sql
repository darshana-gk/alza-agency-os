-- ALZA Flow — Transaction-level effective/expiration dates + broader document MIME allowlist
-- Additive only. Does not rewrite policy dates or financial amounts.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_effective_date date,
  ADD COLUMN IF NOT EXISTS transaction_expiration_date date;

COMMENT ON COLUMN public.transactions.transaction_effective_date IS
  'Transaction-level effective date snapshot (may differ from policy).';
COMMENT ON COLUMN public.transactions.transaction_expiration_date IS
  'Transaction-level expiration date snapshot (may differ from policy).';

-- Allow common document uploads (including browsers that send octet-stream).
UPDATE storage.buckets
SET
  public = false,
  allowed_mime_types = NULL,
  file_size_limit = 20971520
WHERE id = 'supporting-documents';
