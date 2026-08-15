-- ALZA Flow — Owner/CSR workflow hardening (docs visibility + CSR directory)
-- Does NOT create/consume recoveries or producer payments.
-- Does NOT loosen financial RLS beyond aligning helpers with multi-role user_roles.

-- ---------------------------------------------------------------------------
-- 1) Role helpers: honor user_roles (multi-role) via current_user_has_role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_ops_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_has_role('owner')
      OR public.current_user_has_role('admin')
      OR public.current_user_has_role('csr');
$$;

CREATE OR REPLACE FUNCTION public.is_admin_directory_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_has_role('owner')
      OR public.current_user_has_role('admin');
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT lower(ur.role)
      FROM public.user_roles ur
      JOIN public.users u ON u.id = ur.user_id
      WHERE u.auth_user_id = auth.uid()
        AND u.archived_at IS NULL
        AND lower(coalesce(u.status, '')) = 'active'
        AND lower(ur.role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
      ORDER BY CASE lower(ur.role)
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'csr' THEN 3
        WHEN 'producer' THEN 4
        ELSE 5
      END
      LIMIT 1
    ),
    (
      SELECT lower(u.role)
      FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.archived_at IS NULL
        AND lower(COALESCE(u.status, 'active')) = 'active'
      LIMIT 1
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) Ensure CSR-role app users appear in the CSR directory for TEXT assignment
-- ---------------------------------------------------------------------------
INSERT INTO public.csrs (csr_name, email, status, notes)
SELECT
  u.full_name,
  u.email,
  'active',
  'Synced from users with CSR role for transaction assignment'
FROM public.users u
WHERE u.archived_at IS NULL
  AND lower(coalesce(u.status, '')) = 'active'
  AND (
    lower(coalesce(u.role, '')) = 'csr'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id AND lower(ur.role) = 'csr'
    )
  )
  AND coalesce(nullif(trim(u.full_name), ''), '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.csrs c
    WHERE lower(trim(c.csr_name)) = lower(trim(u.full_name))
      AND c.archived_at IS NULL
  );

-- Point the in-review test transaction at Reese so CSR correction queue can resolve
-- by identity (was free-text "Michael", which matched no CSR-role user).
UPDATE public.transactions t
SET csr = u.full_name
FROM public.users u
WHERE t.transaction_number = 'TRX-2026-000026'
  AND t.review_status = 'matched'
  AND lower(coalesce(u.role, '')) = 'csr'
  AND u.archived_at IS NULL
  AND lower(coalesce(u.status, '')) = 'active'
  AND coalesce(nullif(trim(u.full_name), ''), '') <> '';

COMMENT ON FUNCTION public.is_ops_staff() IS
  'Owner/Admin/CSR via user_roles (fallback users.role). Used by supporting_documents + storage RLS.';
COMMENT ON FUNCTION public.is_admin_directory_role() IS
  'Owner/Admin via user_roles (fallback users.role).';
