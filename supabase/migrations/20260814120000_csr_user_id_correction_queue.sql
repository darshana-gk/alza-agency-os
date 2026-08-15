-- ALZA Flow — CSR assignment ID + correction-queue reliability
-- Adds transactions.csr_user_id for stable CSR matching (not display-name only).
-- Does NOT loosen financial mutation RLS for payouts/recoveries.
-- Does NOT execute payments or consume recoveries.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS csr_user_id uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS transactions_csr_user_id_idx
  ON public.transactions (csr_user_id)
  WHERE csr_user_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.csr_user_id IS
  'Stable CSR assignee (public.users.id). Used for Returned-for-Correction queue/notifications; csr TEXT remains for display.';

-- Backfill from active CSR-role users by exact normalized full_name match (no fuzzy).
UPDATE public.transactions t
SET csr_user_id = u.id
FROM public.users u
WHERE t.csr_user_id IS NULL
  AND t.archived_at IS NULL
  AND u.archived_at IS NULL
  AND lower(coalesce(u.status, '')) = 'active'
  AND coalesce(nullif(trim(t.csr), ''), '') <> ''
  AND lower(trim(t.csr)) = lower(trim(u.full_name))
  AND (
    lower(coalesce(u.role, '')) = 'csr'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id AND lower(ur.role) = 'csr'
    )
  );
