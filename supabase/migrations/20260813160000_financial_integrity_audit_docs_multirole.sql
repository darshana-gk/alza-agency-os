-- ALZA Flow — Financial integrity: audit, documents, void, return link, recovery settlement, multi-role
-- Reuses existing recovery/payout infrastructure. Does not weaken RLS.
-- Does NOT rewrite historical producer splits or paid commissions.

-- ---------------------------------------------------------------------------
-- 1) Helper already exists: current_app_user_id()
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2) Append-only activity / audit history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.users (id),
  actor_name text,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  record_reference text,
  client_id uuid,
  policy_id uuid,
  transaction_id uuid,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.activity_history IS
  'Append-only operational/financial audit trail. Normal UI must not UPDATE/DELETE.';

CREATE INDEX IF NOT EXISTS activity_history_created_at_idx
  ON public.activity_history (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_history_actor_user_id_idx
  ON public.activity_history (actor_user_id);
CREATE INDEX IF NOT EXISTS activity_history_action_idx
  ON public.activity_history (action);
CREATE INDEX IF NOT EXISTS activity_history_entity_idx
  ON public.activity_history (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS activity_history_transaction_id_idx
  ON public.activity_history (transaction_id)
  WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_history_client_id_idx
  ON public.activity_history (client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_history_policy_id_idx
  ON public.activity_history (policy_id)
  WHERE policy_id IS NOT NULL;

ALTER TABLE public.activity_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_history_select_authenticated ON public.activity_history;
DROP POLICY IF EXISTS activity_history_insert_authenticated ON public.activity_history;

-- Authenticated users can read (app filters by role in UI where needed).
CREATE POLICY activity_history_select_authenticated
  ON public.activity_history
  FOR SELECT
  TO authenticated
  USING (true);

-- Insert only as self-attributed actor (or null actor for system).
CREATE POLICY activity_history_insert_authenticated
  ON public.activity_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_user_id IS NULL
    OR actor_user_id = public.current_app_user_id()
  );

-- No UPDATE/DELETE policies for authenticated — append-only for normal users.
GRANT SELECT, INSERT ON public.activity_history TO authenticated;
GRANT ALL ON public.activity_history TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Supporting documents (transactions + recoveries)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supporting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('transaction', 'recovery')),
  entity_id uuid NOT NULL,
  transaction_id uuid REFERENCES public.transactions (id),
  recovery_id uuid REFERENCES public.producer_commission_recoveries (id),
  document_type text NOT NULL,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  content_type text,
  byte_size bigint,
  notes text,
  uploaded_by uuid REFERENCES public.users (id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users (id),
  delete_reason text,
  CONSTRAINT supporting_documents_entity_coherence CHECK (
    (entity_type = 'transaction' AND transaction_id IS NOT NULL AND recovery_id IS NULL)
    OR (entity_type = 'recovery' AND recovery_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.supporting_documents IS
  'Private supporting documents for transactions and recoveries. Soft-delete preserves audit evidence.';

CREATE INDEX IF NOT EXISTS supporting_documents_transaction_id_idx
  ON public.supporting_documents (transaction_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS supporting_documents_recovery_id_idx
  ON public.supporting_documents (recovery_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS supporting_documents_entity_idx
  ON public.supporting_documents (entity_type, entity_id);

ALTER TABLE public.supporting_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supporting_documents_select_ops ON public.supporting_documents;
DROP POLICY IF EXISTS supporting_documents_insert_ops ON public.supporting_documents;
DROP POLICY IF EXISTS supporting_documents_update_ops ON public.supporting_documents;

CREATE POLICY supporting_documents_select_ops
  ON public.supporting_documents
  FOR SELECT
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role());

CREATE POLICY supporting_documents_insert_ops
  ON public.supporting_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_ops_staff() OR public.is_admin_directory_role());

-- Soft-delete / metadata updates only (ops/admin).
CREATE POLICY supporting_documents_update_ops
  ON public.supporting_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role())
  WITH CHECK (public.is_ops_staff() OR public.is_admin_directory_role());

GRANT SELECT, INSERT, UPDATE ON public.supporting_documents TO authenticated;
GRANT ALL ON public.supporting_documents TO service_role;

-- Private storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supporting-documents',
  'supporting-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS supporting_documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_update ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_delete ON storage.objects;

CREATE POLICY supporting_documents_storage_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND (public.is_ops_staff() OR public.is_admin_directory_role())
  );

CREATE POLICY supporting_documents_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'supporting-documents'
    AND (public.is_ops_staff() OR public.is_admin_directory_role())
  );

CREATE POLICY supporting_documents_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND (public.is_ops_staff() OR public.is_admin_directory_role())
  )
  WITH CHECK (
    bucket_id = 'supporting-documents'
    AND (public.is_ops_staff() OR public.is_admin_directory_role())
  );

CREATE POLICY supporting_documents_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
  );

-- ---------------------------------------------------------------------------
-- 4) Transaction return link + void + split source snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS original_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS producer_split_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_original_transaction_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_original_transaction_id_fkey
      FOREIGN KEY (original_transaction_id) REFERENCES public.transactions (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_voided_by_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_voided_by_fkey
      FOREIGN KEY (voided_by) REFERENCES public.users (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_producer_split_source_check'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_producer_split_source_check
      CHECK (
        producer_split_source IS NULL
        OR producer_split_source IN ('producer_default', 'policy_override', 'transaction_override')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_original_not_self_check'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_original_not_self_check
      CHECK (original_transaction_id IS NULL OR original_transaction_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transactions_original_transaction_id_idx
  ON public.transactions (original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_voided_at_idx
  ON public.transactions (voided_at)
  WHERE voided_at IS NOT NULL;

COMMENT ON COLUMN public.transactions.original_transaction_id IS
  'For return_premium: link to the original positive premium transaction.';
COMMENT ON COLUMN public.transactions.producer_split_source IS
  'Snapshot of where producer_split_percentage came from at save time.';
COMMENT ON COLUMN public.transactions.voided_at IS
  'Financial VOID marker. Voided transactions remain visible for audit.';

-- ---------------------------------------------------------------------------
-- 5) Recovery settlement: next payout (existing) + direct repayment
-- ---------------------------------------------------------------------------
ALTER TABLE public.producer_commission_recoveries
  ADD COLUMN IF NOT EXISTS settlement_method text,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS policy_id uuid,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS recovery_date date,
  ADD COLUMN IF NOT EXISTS direct_paid_amount numeric,
  ADD COLUMN IF NOT EXISTS direct_paid_date date,
  ADD COLUMN IF NOT EXISTS direct_payment_reference text,
  ADD COLUMN IF NOT EXISTS direct_paid_notes text,
  ADD COLUMN IF NOT EXISTS direct_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS direct_paid_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producer_commission_recoveries_settlement_method_check'
  ) THEN
    ALTER TABLE public.producer_commission_recoveries
      ADD CONSTRAINT producer_commission_recoveries_settlement_method_check
      CHECK (
        settlement_method IS NULL
        OR settlement_method IN ('next_payout', 'direct_payment')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producer_commission_recoveries_direct_paid_by_fkey'
  ) THEN
    ALTER TABLE public.producer_commission_recoveries
      ADD CONSTRAINT producer_commission_recoveries_direct_paid_by_fkey
      FOREIGN KEY (direct_paid_by) REFERENCES public.users (id);
  END IF;
END $$;

UPDATE public.producer_commission_recoveries
SET settlement_method = 'next_payout'
WHERE settlement_method IS NULL;

COMMENT ON COLUMN public.producer_commission_recoveries.settlement_method IS
  'next_payout = deduct via payment batch allocations; direct_payment = producer paid agency.';

-- ---------------------------------------------------------------------------
-- 6) Multi-role: user_roles (preserve users.role as primary/legacy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'csr', 'producer', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role)
);

COMMENT ON TABLE public.user_roles IS
  'Additive roles for a single login. users.role remains primary/legacy display role.';

CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);

-- Migrate existing single roles safely (idempotent).
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, lower(u.role)
FROM public.users u
WHERE u.role IS NOT NULL
  AND lower(u.role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
ON CONFLICT (user_id, role) DO NOTHING;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_select_authenticated ON public.user_roles;
DROP POLICY IF EXISTS user_roles_insert_admin ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete_admin ON public.user_roles;

CREATE POLICY user_roles_select_authenticated
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY user_roles_insert_admin
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_directory_role());

CREATE POLICY user_roles_delete_admin
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (public.is_admin_directory_role());

GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- Helper: does current user have a role (multi-role aware)
CREATE OR REPLACE FUNCTION public.current_user_has_role(target_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.users u ON u.id = ur.user_id
    WHERE u.auth_user_id = auth.uid()
      AND u.archived_at IS NULL
      AND lower(coalesce(u.status, '')) = 'active'
      AND lower(ur.role) = lower(target_role)
  )
  OR EXISTS (
    -- Fallback for rows not yet mirrored into user_roles
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.archived_at IS NULL
      AND lower(coalesce(u.status, '')) = 'active'
      AND lower(coalesce(u.role, '')) = lower(target_role)
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text) TO authenticated;
