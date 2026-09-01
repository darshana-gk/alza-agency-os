-- Staging-first: limited display name + role for senders on a visible support ticket.
-- Does not weaken users or operational tenant RLS. Does not change message/status triggers.

CREATE OR REPLACE FUNCTION public.support_ticket_actor_brief(p_conversation_id uuid)
RETURNS TABLE (id uuid, full_name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    u.id,
    NULLIF(btrim(u.full_name), ''),
    COALESCE(
      NULLIF(btrim(u.role), ''),
      (
        SELECT ur.role
        FROM public.user_roles ur
        WHERE ur.user_id = u.id
        ORDER BY CASE lower(ur.role)
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'csr' THEN 3
          WHEN 'producer' THEN 4
          WHEN 'viewer' THEN 5
          WHEN 'alza_support' THEN 6
          ELSE 9
        END,
        ur.role
        LIMIT 1
      )
    )
  FROM public.users u
  WHERE u.id IN (
    SELECT m.sender_user_id
    FROM public.support_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_user_id IS NOT NULL
    UNION
    SELECT c.created_by_user_id
    FROM public.support_conversations c
    WHERE c.id = p_conversation_id
      AND c.created_by_user_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM public.support_conversations c
    WHERE c.id = p_conversation_id
      AND (
        public.is_alza_support()
        OR (
          public.can_use_agency_support()
          AND c.agency_profile_id IN (SELECT public.current_support_agency_ids())
        )
      )
  )
  AND (
    public.is_alza_support()
    OR u.agency_profile_id IN (SELECT public.current_support_agency_ids())
    OR (
      u.agency_profile_id IS NULL
      AND (
        lower(COALESCE(u.role, '')) = 'alza_support'
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = u.id AND lower(ur.role) = 'alza_support'
        )
      )
    )
  );
$$;

COMMENT ON FUNCTION public.support_ticket_actor_brief(uuid) IS
  'Display name + role for senders on one visible support ticket. ALZA Support: ticket actors only. Agency: own-agency actors plus platform ALZA Support. No email/phone/other-tenant users.';

REVOKE ALL ON FUNCTION public.support_ticket_actor_brief(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_ticket_actor_brief(uuid) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901220000', 'support_ticket_actor_brief')
ON CONFLICT (version) DO NOTHING;
