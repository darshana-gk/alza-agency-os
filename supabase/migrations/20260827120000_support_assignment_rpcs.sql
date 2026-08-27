-- PROPOSED / REVIEW BEFORE APPLY — ALZA Support assignment RPCs
-- Additive only. Depends on support_conversations.assigned_to_user_id
-- (foundation migration 20260821120000_support_center_foundation.sql).
-- ALZA-only authorization via is_alza_support().
-- DO NOT apply until reviewed. Preview/code ready; stop before Production apply.

-- ---------------------------------------------------------------------------
-- Assign / unassign (ALZA Support only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_assign_conversation(
  p_conversation_id uuid,
  p_assignee_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assignee_ok boolean;
BEGIN
  IF NOT public.is_alza_support() THEN
    RAISE EXCEPTION 'only ALZA support can assign conversations';
  END IF;

  IF p_assignee_user_id IS NULL THEN
    RAISE EXCEPTION 'assignee required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_assignee_user_id
      AND u.archived_at IS NULL
      AND lower(coalesce(u.status, '')) = 'active'
      AND (
        lower(coalesce(u.role, '')) = 'alza_support'
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = u.id AND lower(ur.role) = 'alza_support'
        )
      )
  ) INTO assignee_ok;

  IF NOT assignee_ok THEN
    RAISE EXCEPTION 'assignee must be an active ALZA support user';
  END IF;

  UPDATE public.support_conversations
  SET
    assigned_to_user_id = p_assignee_user_id,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_unassign_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_alza_support() THEN
    RAISE EXCEPTION 'only ALZA support can unassign conversations';
  END IF;

  UPDATE public.support_conversations
  SET
    assigned_to_user_id = NULL,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.support_assign_conversation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_unassign_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_assign_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_unassign_conversation(uuid) TO authenticated;

COMMENT ON FUNCTION public.support_assign_conversation(uuid, uuid) IS
  'ALZA Support only: assign a conversation to an active alza_support user.';
COMMENT ON FUNCTION public.support_unassign_conversation(uuid) IS
  'ALZA Support only: clear conversation assignment.';
