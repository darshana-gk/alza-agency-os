-- ALZA Flow — Transaction reviewer assignment + return reason + notification read state
-- Single migration for production review workflow completion.
-- Does NOT change payout/recovery math or payment-batch RPCs.

-- ---------------------------------------------------------------------------
-- 1) Helper: current public.users.id for RLS (auth.uid() → users.id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

COMMENT ON FUNCTION public.current_app_user_id() IS
  'Returns the active public.users.id for the authenticated auth.uid(), or NULL.';

-- ---------------------------------------------------------------------------
-- 2) Transaction reviewer assignment + return-for-correction audit
-- Note: reviewed_by / reviewed_date already exist (approval audit) and are NOT reused
-- as the assigned reviewer queue field.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reviewer_user_id uuid,
  ADD COLUMN IF NOT EXISTS review_return_reason text,
  ADD COLUMN IF NOT EXISTS review_returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_returned_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_reviewer_user_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_reviewer_user_id_fkey
      FOREIGN KEY (reviewer_user_id) REFERENCES public.users (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_review_returned_by_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_review_returned_by_fkey
      FOREIGN KEY (review_returned_by) REFERENCES public.users (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transactions_reviewer_user_id_idx
  ON public.transactions (reviewer_user_id)
  WHERE reviewer_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_review_returned_at_idx
  ON public.transactions (review_returned_at)
  WHERE review_returned_at IS NOT NULL;

COMMENT ON COLUMN public.transactions.reviewer_user_id IS
  'Assigned Owner/Admin reviewer (public.users.id). Required before Submit for Review.';
COMMENT ON COLUMN public.transactions.review_return_reason IS
  'Required reason when Owner/Admin returns a transaction for correction.';
COMMENT ON COLUMN public.transactions.review_returned_at IS
  'Timestamp of the latest Return for Correction.';
COMMENT ON COLUMN public.transactions.review_returned_by IS
  'public.users.id of the reviewer who returned the transaction for correction.';

-- ---------------------------------------------------------------------------
-- 3) Per-user persistent notification read state
-- Operational notifications remain derived; this table stores only read/unread.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_read_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_read_state_user_key_unique UNIQUE (user_id, notification_key)
);

COMMENT ON TABLE public.notification_read_state IS
  'Per-user read/unread state for derived operational notification keys. Never shares across users.';

CREATE INDEX IF NOT EXISTS notification_read_state_user_id_idx
  ON public.notification_read_state (user_id);

CREATE INDEX IF NOT EXISTS notification_read_state_user_unread_idx
  ON public.notification_read_state (user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notification_read_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_read_state_select_own ON public.notification_read_state;
DROP POLICY IF EXISTS notification_read_state_insert_own ON public.notification_read_state;
DROP POLICY IF EXISTS notification_read_state_update_own ON public.notification_read_state;
DROP POLICY IF EXISTS notification_read_state_delete_own ON public.notification_read_state;

CREATE POLICY notification_read_state_select_own
  ON public.notification_read_state
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_app_user_id());

CREATE POLICY notification_read_state_insert_own
  ON public.notification_read_state
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY notification_read_state_update_own
  ON public.notification_read_state
  FOR UPDATE
  TO authenticated
  USING (user_id = public.current_app_user_id())
  WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY notification_read_state_delete_own
  ON public.notification_read_state
  FOR DELETE
  TO authenticated
  USING (user_id = public.current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.notification_read_state
  TO authenticated;

GRANT ALL
  ON public.notification_read_state
  TO service_role;
