-- Additive Support resolve: agency users may resolve their own agency's tickets.
-- Production already applied 20260821120000 with ALZA-only resolve; this CREATE OR REPLACE
-- does not re-run that file and makes no table/data/backfill/schema changes.
-- Cross-agency resolve is impossible: agency path requires matching agency_profile_id.

CREATE OR REPLACE FUNCTION public.support_resolve_conversation(p_conversation_id uuid)
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

  -- ALZA Support may resolve any ticket; agency users may resolve their own agency's tickets.
  IF public.is_alza_support() THEN
    NULL;
  ELSIF public.can_use_agency_support()
        AND c.agency_profile_id IS NOT NULL
        AND public.current_user_agency_profile_id() IS NOT NULL
        AND c.agency_profile_id = public.current_user_agency_profile_id() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'not allowed to resolve this conversation';
  END IF;

  UPDATE public.support_conversations
  SET
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

COMMENT ON FUNCTION public.support_resolve_conversation(uuid) IS
  'ALZA Support may resolve any conversation. Agency users may resolve only their own agency_profile_id.';
