-- ALZA Flow Multi-Tenancy V1 — Phase 3D
-- Storage isolation: agency-prefixed paths. Do not delete existing branding objects.
--
-- AUTHORING ONLY. Do NOT apply to Production.
-- Bucket public flags are unchanged so existing getPublicUrl logo paths keep working.
-- Listing is no longer USING (true). Legacy logo/{agency_id}.* remains readable/writable
-- alongside {agency_id}/... so Phase 4 can copy objects without a breaking cut.

DO $$
BEGIN
  IF to_regproc('public.same_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3D abort: Phase 3B same_agency() missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.multitenancy_storage_agency_object(
  p_bucket text,
  p_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.current_user_agency_profile_id() IS NOT NULL
    AND p_name IS NOT NULL
    AND (
      p_name LIKE public.current_user_agency_profile_id()::text || '/%'
      OR (
        p_bucket = 'agency-branding'
        AND p_name LIKE 'logo/' || public.current_user_agency_profile_id()::text || '.%'
      )
      OR (
        p_bucket = 'supporting-documents'
        AND (storage.foldername(p_name))[1] IN ('transaction', 'recovery')
        AND public.is_ops_staff()
      )
      OR (
        p_bucket = 'reconciliation-statements'
        AND (storage.foldername(p_name))[1] = public.current_user_agency_profile_id()::text
      )
    );
$$;

COMMENT ON FUNCTION public.multitenancy_storage_agency_object(text, text) IS
  'Phase 3D: object is in {agency_id}/... or approved legacy branding/docs prefix. Not a bucket-wide list.';

REVOKE ALL ON FUNCTION public.multitenancy_storage_agency_object(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.multitenancy_storage_agency_object(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- agency-branding: drop bucket-wide public SELECT (prevents listing).
-- Bucket remains public so known URLs still download (Phase 4 copies to {agency_id}/).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agency_branding_public_read ON storage.objects;
DROP POLICY IF EXISTS agency_branding_admin_insert ON storage.objects;
DROP POLICY IF EXISTS agency_branding_admin_update ON storage.objects;
DROP POLICY IF EXISTS agency_branding_admin_delete ON storage.objects;
DROP POLICY IF EXISTS agency_branding_select_agency ON storage.objects;
DROP POLICY IF EXISTS agency_branding_insert_agency ON storage.objects;
DROP POLICY IF EXISTS agency_branding_update_agency ON storage.objects;
DROP POLICY IF EXISTS agency_branding_delete_agency ON storage.objects;

CREATE POLICY agency_branding_select_agency
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY agency_branding_insert_agency
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY agency_branding_update_agency
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY agency_branding_delete_agency
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

-- ---------------------------------------------------------------------------
-- reconciliation-statements: require {agency_id}/ prefix (already used by app)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS reconciliation_statements_storage_select ON storage.objects;
DROP POLICY IF EXISTS reconciliation_statements_storage_insert ON storage.objects;
DROP POLICY IF EXISTS reconciliation_statements_storage_update ON storage.objects;
DROP POLICY IF EXISTS reconciliation_statements_storage_delete ON storage.objects;

CREATE POLICY reconciliation_statements_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'reconciliation-statements'
    AND public.is_ops_staff()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY reconciliation_statements_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reconciliation-statements'
    AND public.is_ops_staff()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY reconciliation_statements_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'reconciliation-statements'
    AND public.is_ops_staff()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id = 'reconciliation-statements'
    AND public.is_ops_staff()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY reconciliation_statements_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'reconciliation-statements'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

-- ---------------------------------------------------------------------------
-- supporting-documents: new {agency_id}/... plus legacy transaction|recovery/...
-- Legacy prefix is ops+membership only (singleton still in place until Phase 4 path rewrite).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS supporting_documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_update ON storage.objects;
DROP POLICY IF EXISTS supporting_documents_storage_delete ON storage.objects;

CREATE POLICY supporting_documents_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND public.is_ops_staff()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY supporting_documents_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'supporting-documents'
    AND public.is_ops_staff()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY supporting_documents_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

CREATE POLICY supporting_documents_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'supporting-documents'
    AND public.is_admin_directory_role()
    AND public.multitenancy_storage_agency_object(bucket_id, name)
  );

-- Do not ALTER storage.buckets.public. Phase 4 copies logo/{id}.* → {id}/logo.* then may privatize.
