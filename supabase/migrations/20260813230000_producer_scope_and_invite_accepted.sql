-- ALZA Flow — Producer scoped reads + invite acceptance sync
-- Does NOT alter commissions, payments, recoveries, or supporting-document policies.
-- Does NOT execute payments or consume recoveries.

-- ---------------------------------------------------------------------------
-- 1) Resolve producer book name for the signed-in user
--    Prior gap: only producer_id / producers.email — Michael had neither match.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_producer_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(trim(p.producer_name), ''),
    (
      SELECT NULLIF(trim(p2.producer_name), '')
      FROM public.producers p2
      WHERE u.email IS NOT NULL
        AND lower(p2.email) = lower(u.email)
        AND p2.archived_at IS NULL
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(p3.producer_name), '')
      FROM public.producers p3
      WHERE lower(trim(p3.producer_name)) = lower(trim(COALESCE(u.full_name, '')))
        AND p3.archived_at IS NULL
      LIMIT 1
    ),
    CASE
      WHEN lower(COALESCE(u.role, '')) = 'producer'
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = u.id
            AND lower(ur.role) = 'producer'
        )
      THEN NULLIF(trim(u.full_name), '')
      ELSE NULL
    END
  )
  FROM public.users u
  LEFT JOIN public.producers p
    ON p.id = u.producer_id
   AND p.archived_at IS NULL
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.status, 'active')) = 'active'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_producer_name() IS
  'Producer book name for RLS: producer_id → producers.email → producers.full_name match → producer-role users.full_name.';

-- Link producer-role users to directory rows by exact name when unlinked.
UPDATE public.users u
SET producer_id = p.id
FROM public.producers p
WHERE u.producer_id IS NULL
  AND u.archived_at IS NULL
  AND p.archived_at IS NULL
  AND lower(trim(p.producer_name)) = lower(trim(u.full_name))
  AND (
    lower(COALESCE(u.role, '')) = 'producer'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id AND lower(ur.role) = 'producer'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Policy row read helper — producer may read policies they own OR whose
--    client belongs to their book (covers legacy NULL policy.producer).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_policy_row(
  row_producer text,
  row_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.current_app_role()
    WHEN 'owner' THEN true
    WHEN 'admin' THEN true
    WHEN 'csr' THEN true
    WHEN 'viewer' THEN true
    WHEN 'producer' THEN (
      public.current_producer_name() IS NOT NULL
      AND (
        lower(trim(COALESCE(row_producer, ''))) = lower(public.current_producer_name())
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = row_client_id
            AND lower(trim(COALESCE(c.producer, ''))) = lower(public.current_producer_name())
        )
      )
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_policy_row(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_policy_row(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Tighten policies + transactions SELECT to producer ownership
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read policies" ON public.policies;
DROP POLICY IF EXISTS "Allow public insert policies" ON public.policies;
DROP POLICY IF EXISTS "Allow public update policies" ON public.policies;
DROP POLICY IF EXISTS "Allow public delete policies" ON public.policies;
DROP POLICY IF EXISTS policies_select_scoped ON public.policies;
DROP POLICY IF EXISTS policies_insert_ops ON public.policies;
DROP POLICY IF EXISTS policies_update_ops ON public.policies;
DROP POLICY IF EXISTS policies_delete_ops ON public.policies;

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY policies_select_scoped
  ON public.policies
  FOR SELECT
  TO authenticated
  USING (public.can_read_policy_row(producer, client_id));

CREATE POLICY policies_insert_ops
  ON public.policies
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_ops_staff() OR public.is_admin_directory_role());

CREATE POLICY policies_update_ops
  ON public.policies
  FOR UPDATE
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role())
  WITH CHECK (public.is_ops_staff() OR public.is_admin_directory_role());

CREATE POLICY policies_delete_ops
  ON public.policies
  FOR DELETE
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role());

DROP POLICY IF EXISTS "Allow all transactions" ON public.transactions;
DROP POLICY IF EXISTS transactions_select_scoped ON public.transactions;
DROP POLICY IF EXISTS transactions_insert_ops ON public.transactions;
DROP POLICY IF EXISTS transactions_update_ops ON public.transactions;
DROP POLICY IF EXISTS transactions_delete_ops ON public.transactions;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_select_scoped
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (public.can_read_assigned_producer_row(producer));

CREATE POLICY transactions_insert_ops
  ON public.transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_ops_staff() OR public.is_admin_directory_role());

CREATE POLICY transactions_update_ops
  ON public.transactions
  FOR UPDATE
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role())
  WITH CHECK (public.is_ops_staff() OR public.is_admin_directory_role());

CREATE POLICY transactions_delete_ops
  ON public.transactions
  FOR DELETE
  TO authenticated
  USING (public.is_ops_staff() OR public.is_admin_directory_role());

-- ---------------------------------------------------------------------------
-- 4) Invite acceptance — reliable SECURITY DEFINER path + backfill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_current_user_invite_accepted()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.users u
  SET invite_status = 'accepted'
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND COALESCE(u.invite_status, 'pending') = 'pending';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_current_user_invite_accepted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_current_user_invite_accepted() TO authenticated;

COMMENT ON FUNCTION public.mark_current_user_invite_accepted() IS
  'Sets invite_status=accepted for the signed-in ALZA user (invite completion / first login).';

-- Users who already signed into Auth are accepted (not Invitation Pending).
UPDATE public.users u
SET invite_status = 'accepted'
FROM auth.users au
WHERE u.auth_user_id = au.id
  AND u.archived_at IS NULL
  AND COALESCE(u.invite_status, 'pending') = 'pending'
  AND au.last_sign_in_at IS NOT NULL;
