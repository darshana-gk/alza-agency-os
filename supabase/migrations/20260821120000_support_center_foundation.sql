-- ALZA Flow — Support Center V1 foundation (security-hardened)
-- Additive: support tables, alza_support helpers, agency membership FK for Support isolation.
-- Does NOT alter commission, reconciliation, billing, or Razorpay tables.
-- Local-only until approved; do not apply to production without release approval.

-- ---------------------------------------------------------------------------
-- 1) Platform support role + block escalation locks
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_check'
  ) THEN
    ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check;
  END IF;
  ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_role_check
    CHECK (role IN ('owner', 'admin', 'csr', 'producer', 'viewer', 'alza_support'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.users.role IS
  'Primary role: owner|admin|csr|producer|viewer|alza_support. alza_support is ALZA platform staff only — never assignable by agency Owners/Admins.';

-- Block client JWT sessions from granting alza_support via normal writes.
-- Platform bootstrap: SQL editor / service_role with auth.uid() IS NULL.
CREATE OR REPLACE FUNCTION public.enforce_platform_only_alza_support_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.role, '')) = 'alza_support' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'alza_support is a platform role and cannot be assigned by agency users';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_enforce_alza_support_role_trg ON public.users;
CREATE TRIGGER users_enforce_alza_support_role_trg
  BEFORE INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_platform_only_alza_support_role();

DROP TRIGGER IF EXISTS user_roles_enforce_alza_support_role_trg ON public.user_roles;
CREATE TRIGGER user_roles_enforce_alza_support_role_trg
  BEFORE INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_platform_only_alza_support_role();

-- Tighten user_roles INSERT RLS: Owner/Admin may manage agency roles only.
DROP POLICY IF EXISTS user_roles_insert_admin ON public.user_roles;
CREATE POLICY user_roles_insert_admin
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin_directory_role()
    AND lower(role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')
  );

CREATE OR REPLACE FUNCTION public.is_alza_support()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_has_role('alza_support');
$$;

COMMENT ON FUNCTION public.is_alza_support() IS
  'True when the signed-in user has the ALZA platform support role (cross-agency support inbox).';

REVOKE ALL ON FUNCTION public.is_alza_support() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_alza_support() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_active_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.archived_at IS NULL
      AND lower(coalesce(u.status, '')) = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_app_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_app_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_use_agency_support()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_active_app_user()
    AND (
      public.current_user_has_role('owner')
      OR public.current_user_has_role('admin')
      OR public.current_user_has_role('csr')
      OR public.current_user_has_role('producer')
      OR public.current_user_has_role('viewer')
    );
$$;

REVOKE ALL ON FUNCTION public.can_use_agency_support() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_use_agency_support() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1b) Agency membership for Support isolation (multi-tenant ready)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS agency_profile_id uuid REFERENCES public.agency_profile (id);

COMMENT ON COLUMN public.users.agency_profile_id IS
  'Workspace membership for Support (and future multi-tenant). Operational tables may still be single-workspace today.';

CREATE INDEX IF NOT EXISTS users_agency_profile_id_idx
  ON public.users (agency_profile_id)
  WHERE agency_profile_id IS NOT NULL;

UPDATE public.users u
SET agency_profile_id = ap.id
FROM (
  SELECT id
  FROM public.agency_profile
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1
) ap
WHERE u.agency_profile_id IS NULL;

CREATE OR REPLACE FUNCTION public.current_support_agency_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.id
  FROM public.agency_profile ap
  WHERE public.is_alza_support()
  UNION
  SELECT u.agency_profile_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND lower(coalesce(u.status, '')) = 'active'
    AND public.can_use_agency_support()
    AND u.agency_profile_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.current_support_agency_ids() IS
  'Support tenant scope. ALZA support: all agency_profile rows. Agency users: users.agency_profile_id only.';

REVOKE ALL ON FUNCTION public.current_support_agency_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_support_agency_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_agency_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.agency_profile_id
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND lower(coalesce(u.status, '')) = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_agency_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_agency_profile_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_profile_id uuid NOT NULL REFERENCES public.agency_profile (id),
  created_by_user_id uuid NOT NULL REFERENCES public.users (id),
  category text NOT NULL
    CHECK (category IN (
      'account_login',
      'billing_subscription',
      'import_data',
      'reconciliation',
      'reports_exports',
      'technical_issue',
      'feature_request',
      'other'
    )),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'waiting_on_alza'
    CHECK (status IN ('open', 'waiting_on_customer', 'waiting_on_alza', 'resolved')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent')),
  assigned_to_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  last_message_preview text,
  last_message_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_conversations_subject_len CHECK (char_length(trim(subject)) BETWEEN 1 AND 200)
);

COMMENT ON TABLE public.support_conversations IS
  'Customer support requests scoped by agency_profile_id. Clients have no UPDATE privilege; status via RPCs + message trigger.';

CREATE INDEX IF NOT EXISTS support_conversations_agency_updated_idx
  ON public.support_conversations (agency_profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_conversations_status_idx
  ON public.support_conversations (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_conversations_created_by_idx
  ON public.support_conversations (created_by_user_id);

-- ---------------------------------------------------------------------------
-- 3) Messages (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations (id) ON DELETE RESTRICT,
  sender_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('agency_user', 'alza_support')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_body_len CHECK (char_length(trim(body)) BETWEEN 1 AND 10000)
);

COMMENT ON TABLE public.support_messages IS
  'Append-only support messages. No UPDATE/DELETE grants to authenticated.';

CREATE INDEX IF NOT EXISTS support_messages_conversation_created_idx
  ON public.support_messages (conversation_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.support_message_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_status text;
  conv_agency uuid;
BEGIN
  NEW.sender_user_id := public.current_app_user_id();
  IF NEW.sender_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated as an app user';
  END IF;

  SELECT c.status, c.agency_profile_id
  INTO conv_status, conv_agency
  FROM public.support_conversations c
  WHERE c.id = NEW.conversation_id;

  IF conv_agency IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF conv_status = 'resolved' THEN
    RAISE EXCEPTION 'conversation is resolved; reopen before sending a new message';
  END IF;

  IF public.is_alza_support() AND public.can_use_agency_support() THEN
    IF NEW.sender_type NOT IN ('alza_support', 'agency_user') THEN
      RAISE EXCEPTION 'invalid sender_type';
    END IF;
    IF NEW.sender_type = 'agency_user'
       AND conv_agency IS DISTINCT FROM public.current_user_agency_profile_id() THEN
      RAISE EXCEPTION 'cannot send agency reply on another agency conversation';
    END IF;
  ELSIF public.is_alza_support() THEN
    NEW.sender_type := 'alza_support';
  ELSIF public.can_use_agency_support() THEN
    NEW.sender_type := 'agency_user';
    IF conv_agency IS DISTINCT FROM public.current_user_agency_profile_id() THEN
      RAISE EXCEPTION 'cannot message another agency conversation';
    END IF;
  ELSE
    RAISE EXCEPTION 'not allowed to send support messages';
  END IF;

  NEW.body := trim(NEW.body);
  IF NEW.body IS NULL OR char_length(NEW.body) < 1 THEN
    RAISE EXCEPTION 'message body is required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_messages_before_insert_trg ON public.support_messages;
CREATE TRIGGER support_messages_before_insert_trg
  BEFORE INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.support_message_before_insert();

CREATE OR REPLACE FUNCTION public.support_message_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.support_conversations
  SET
    last_message_at = NEW.created_at,
    last_message_preview = left(trim(NEW.body), 180),
    updated_at = NEW.created_at,
    resolved_at = NULL,
    status = CASE
      WHEN NEW.sender_type = 'alza_support' THEN 'waiting_on_customer'
      ELSE 'waiting_on_alza'
    END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_messages_after_insert_trg ON public.support_messages;
CREATE TRIGGER support_messages_after_insert_trg
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.support_message_after_insert();

-- ---------------------------------------------------------------------------
-- 4) Status RPCs (authenticated has NO direct UPDATE on conversations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_reopen_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.support_conversations%ROWTYPE;
BEGIN
  SELECT * INTO c
  FROM public.support_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF public.is_alza_support() THEN
    NULL;
  ELSIF public.can_use_agency_support()
        AND c.agency_profile_id = public.current_user_agency_profile_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'not allowed to reopen this conversation';
  END IF;

  UPDATE public.support_conversations
  SET
    status = 'waiting_on_alza',
    resolved_at = NULL,
    updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_resolve_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_alza_support() THEN
    RAISE EXCEPTION 'only ALZA support can resolve conversations';
  END IF;

  UPDATE public.support_conversations
  SET
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_alza_set_waiting_status(
  p_conversation_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_alza_support() THEN
    RAISE EXCEPTION 'only ALZA support can change waiting status';
  END IF;

  IF p_status NOT IN ('waiting_on_customer', 'waiting_on_alza', 'open') THEN
    RAISE EXCEPTION 'invalid waiting status';
  END IF;

  UPDATE public.support_conversations
  SET
    status = p_status,
    resolved_at = NULL,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.support_reopen_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_resolve_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_alza_set_waiting_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_reopen_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_resolve_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_alza_set_waiting_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_conversations_select ON public.support_conversations;
CREATE POLICY support_conversations_select
  ON public.support_conversations
  FOR SELECT
  TO authenticated
  USING (
    public.is_alza_support()
    OR (
      public.can_use_agency_support()
      AND agency_profile_id IN (SELECT public.current_support_agency_ids())
    )
  );

DROP POLICY IF EXISTS support_conversations_insert ON public.support_conversations;
CREATE POLICY support_conversations_insert
  ON public.support_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_use_agency_support()
    AND agency_profile_id = public.current_user_agency_profile_id()
    AND agency_profile_id IN (SELECT public.current_support_agency_ids())
    AND created_by_user_id = public.current_app_user_id()
    AND assigned_to_user_id IS NULL
    AND status = 'waiting_on_alza'
  );

DROP POLICY IF EXISTS support_conversations_update ON public.support_conversations;
DROP POLICY IF EXISTS support_conversations_delete ON public.support_conversations;

DROP POLICY IF EXISTS support_messages_select ON public.support_messages;
CREATE POLICY support_messages_select
  ON public.support_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (
          public.is_alza_support()
          OR (
            public.can_use_agency_support()
            AND c.agency_profile_id IN (SELECT public.current_support_agency_ids())
          )
        )
    )
  );

DROP POLICY IF EXISTS support_messages_insert ON public.support_messages;
CREATE POLICY support_messages_insert
  ON public.support_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.support_conversations c
      WHERE c.id = conversation_id
        AND (
          public.is_alza_support()
          OR (
            public.can_use_agency_support()
            AND c.agency_profile_id = public.current_user_agency_profile_id()
          )
        )
    )
  );

DROP POLICY IF EXISTS support_messages_update ON public.support_messages;
DROP POLICY IF EXISTS support_messages_delete ON public.support_messages;

REVOKE ALL ON public.support_conversations FROM PUBLIC;
REVOKE ALL ON public.support_messages FROM PUBLIC;
GRANT SELECT, INSERT ON public.support_conversations TO authenticated;
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_conversations TO service_role;
GRANT ALL ON public.support_messages TO service_role;
