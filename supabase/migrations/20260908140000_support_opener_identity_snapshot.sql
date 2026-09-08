-- Staging-first: immutable opener name + email on support_conversations.
-- ALZA Support cannot SELECT other-agency public.users (users_select_scoped), so the
-- creator embed returns null and the inbox showed Opened by / Contact email as "—".
-- Snapshots live on the conversation row (already visible to ALZA Support via existing
-- conversation RLS). Does not weaken users, agency_profile, or operational tenant RLS.
-- Does not change ticket numbers, messages, statuses, assignment, or notify workflow.

-- ---------------------------------------------------------------------------
-- 1) Agency brief: include agency contact fields for ticket detail (not opener email).
--    Return-type change requires DROP; same EXECUTE grant restored below.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.support_agency_brief();

CREATE FUNCTION public.support_agency_brief()
RETURNS TABLE (id uuid, agency_name text, email text, phone text, website text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.id,
    a.agency_name,
    NULLIF(btrim(a.email), ''),
    NULLIF(btrim(a.phone), ''),
    NULLIF(btrim(a.website), '')
  FROM public.agency_profile a
  WHERE public.is_alza_support()
     OR (
       public.can_use_agency_support()
       AND a.id IS NOT NULL
       AND a.id = public.current_user_agency_profile_id()
     );
$$;

COMMENT ON FUNCTION public.support_agency_brief() IS
  'ALZA Support: all agency id/name/contact for tickets. Agency users: own membership only. Not user contact email.';

REVOKE ALL ON FUNCTION public.support_agency_brief() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_agency_brief() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Immutable opener identity columns (conversation-scoped; not a users RLS change)
-- ---------------------------------------------------------------------------
ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS opened_by_name text;

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS opened_by_email text;

COMMENT ON COLUMN public.support_conversations.opened_by_name IS
  'Immutable display name of the user who opened the ticket, snapshotted at INSERT from public.users.full_name.';

COMMENT ON COLUMN public.support_conversations.opened_by_email IS
  'Immutable contact email of the user who opened the ticket, snapshotted at INSERT from public.users.email. Not agency_profile.email.';

CREATE OR REPLACE FUNCTION public.support_snapshot_opener_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_email text;
BEGIN
  SELECT
    NULLIF(btrim(u.full_name), ''),
    NULLIF(btrim(u.email), '')
  INTO v_name, v_email
  FROM public.users u
  WHERE u.id = NEW.created_by_user_id;

  -- Always overwrite client-supplied values so identity cannot be forged on INSERT.
  NEW.opened_by_name := v_name;
  NEW.opened_by_email := v_email;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.support_snapshot_opener_identity() IS
  'BEFORE INSERT: copy opener full_name + email from public.users onto the conversation. Immutable after insert (no UPDATE grant).';

REVOKE ALL ON FUNCTION public.support_snapshot_opener_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_snapshot_opener_identity() FROM anon;
REVOKE ALL ON FUNCTION public.support_snapshot_opener_identity() FROM authenticated;

DROP TRIGGER IF EXISTS support_conversations_snapshot_opener_trg
  ON public.support_conversations;
CREATE TRIGGER support_conversations_snapshot_opener_trg
  BEFORE INSERT ON public.support_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.support_snapshot_opener_identity();

-- Historical tickets: fill blanks only from existing user profile data.
UPDATE public.support_conversations c
SET
  opened_by_name = COALESCE(c.opened_by_name, NULLIF(btrim(u.full_name), '')),
  opened_by_email = COALESCE(c.opened_by_email, NULLIF(btrim(u.email), ''))
FROM public.users u
WHERE u.id = c.created_by_user_id
  AND (
    c.opened_by_name IS NULL
    OR c.opened_by_email IS NULL
  );

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260908140000', 'support_opener_identity_snapshot')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
