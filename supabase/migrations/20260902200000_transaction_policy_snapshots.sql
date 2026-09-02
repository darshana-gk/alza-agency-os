-- Snapshot policy number and policy term onto each transaction at create time.
-- Additive only. Does not change commission math, RLS, rewrite lineage, or reconciliation matching.
-- Do not backfill policy_number from the current Policy File — that would relabel history
-- after a renewal that changed the number. Unsnapshotted rows are frozen at renew time
-- (old number / expiring term) before the Policy File is renamed.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS policy_number text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS policy_effective_date date;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS policy_expiration_date date;

COMMENT ON COLUMN public.transactions.policy_number IS
  'Immutable snapshot of the policy number at transaction create. Not updated when the Policy File is renamed on renewal.';

COMMENT ON COLUMN public.transactions.policy_effective_date IS
  'Immutable snapshot of the policy term effective date at transaction create.';

COMMENT ON COLUMN public.transactions.policy_expiration_date IS
  'Immutable snapshot of the policy term expiration date at transaction create.';

-- Establishing txns already store the term on transaction_* dates. Copy those into the
-- dedicated policy-term snapshot when empty. Do not copy from policies.effective_date.
UPDATE public.transactions
SET
  policy_effective_date = transaction_effective_date,
  policy_expiration_date = transaction_expiration_date
WHERE policy_effective_date IS NULL
  AND transaction_type IN ('new_policy_premium', 'renewal_premium')
  AND transaction_effective_date IS NOT NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260902200000',
  'transaction_policy_snapshots',
  ARRAY['applied on staging uzckhxpqnipnovplohpf via supabase db query']
)
ON CONFLICT (version) DO NOTHING;
