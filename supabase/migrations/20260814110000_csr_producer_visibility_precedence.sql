-- ALZA Flow — Multi-role visibility: CSR+Producer keeps agency-wide CSR reads
-- Precedence: Owner/Admin → CSR → Producer → Viewer
-- Producer-only scoping is unchanged. Does NOT loosen financial mutation RLS.
-- Does NOT create/consume recoveries or producer payments.

-- Explicit helpers: agency ops (owner/admin/csr) see all rows; producer-only is book-scoped.
CREATE OR REPLACE FUNCTION public.can_read_assigned_producer_row(row_producer text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Broadest operational visibility (Owner/Admin/CSR), including CSR+Producer
    public.is_admin_directory_role()
    OR public.current_user_has_role('csr')
    -- Viewer (without producer) keeps agency read
    OR (
      public.current_user_has_role('viewer')
      AND NOT public.current_user_has_role('producer')
    )
    -- Producer-only (or Producer+Viewer without CSR/Owner/Admin): own book
    OR (
      public.current_user_has_role('producer')
      AND NOT public.is_admin_directory_role()
      AND NOT public.current_user_has_role('csr')
      AND public.current_producer_name() IS NOT NULL
      AND lower(trim(COALESCE(row_producer, ''))) = lower(public.current_producer_name())
    );
$$;

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
  SELECT
    public.is_admin_directory_role()
    OR public.current_user_has_role('csr')
    OR (
      public.current_user_has_role('viewer')
      AND NOT public.current_user_has_role('producer')
    )
    OR (
      public.current_user_has_role('producer')
      AND NOT public.is_admin_directory_role()
      AND NOT public.current_user_has_role('csr')
      AND public.current_producer_name() IS NOT NULL
      AND (
        lower(trim(COALESCE(row_producer, ''))) = lower(public.current_producer_name())
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = row_client_id
            AND lower(trim(COALESCE(c.producer, ''))) = lower(public.current_producer_name())
        )
      )
    );
$$;

COMMENT ON FUNCTION public.can_read_assigned_producer_row(text) IS
  'SELECT visibility: Owner/Admin/CSR (incl. CSR+Producer) = agency-wide; Producer-only = own producer TEXT.';
COMMENT ON FUNCTION public.can_read_policy_row(text, uuid) IS
  'Policy SELECT visibility: Owner/Admin/CSR (incl. CSR+Producer) = agency-wide; Producer-only = own book / client book.';
