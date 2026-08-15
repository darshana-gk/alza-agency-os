-- ALZA Flow — Tighten supporting_documents soft-delete + audit grants
-- Closes CSR soft-delete bypass via PostgREST UPDATE.
-- Does not alter financial tables, upload/view SELECT/INSERT for ops, or existing rows.

-- ---------------------------------------------------------------------------
-- 1) supporting_documents UPDATE: Owner/Admin only (soft-delete)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS supporting_documents_update_ops ON public.supporting_documents;

CREATE POLICY supporting_documents_update_admin
  ON public.supporting_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_directory_role())
  WITH CHECK (public.is_admin_directory_role());

-- SELECT/INSERT remain ops (owner|admin|csr) from prior migration.

-- ---------------------------------------------------------------------------
-- 2) Storage: tighten UPDATE; keep DELETE as Owner/Admin; SELECT/INSERT ops
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS supporting_documents_storage_update ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_delete ON storage.objects;

CREATE POLICY supporting_documents_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
  )
  WITH CHECK (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
  );

-- Recreate DELETE explicitly (idempotent) — Owner/Admin only.
CREATE POLICY supporting_documents_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
  );

-- ---------------------------------------------------------------------------
-- 3) Table privileges: revoke excess from anon/authenticated
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.activity_history FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.activity_history TO authenticated;
-- service_role retains full access (default / prior GRANT ALL)

REVOKE ALL ON TABLE public.supporting_documents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.supporting_documents TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) activity_history SELECT: Owner/Admin/CSR only (align with /activity nav)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS activity_history_select_authenticated ON public.activity_history;

CREATE POLICY activity_history_select_ops
  ON public.activity_history
  FOR SELECT
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role());

-- INSERT policy unchanged (self-attributed actor).

COMMENT ON POLICY supporting_documents_update_admin ON public.supporting_documents IS
  'Soft-delete / metadata UPDATE restricted to Owner/Admin. CSR may SELECT/INSERT only.';

COMMENT ON POLICY activity_history_select_ops ON public.activity_history IS
  'Agency-wide audit readable by Owner/Admin/CSR only; not Producer/Viewer.';
