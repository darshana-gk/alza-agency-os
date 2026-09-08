-- Support Ticket # (matches live Staging schema).
-- Global ALZA-###### identity for the cross-agency ALZA inbox.
-- Does not change tenant RLS, opener snapshots, messages, statuses, or money.
-- Do NOT apply to Production in Fix 1B. Apply later via the Production runbook only.
--
-- Staging already has this object graph. This file is idempotent:
-- ADD COLUMN / CREATE INDEX / CREATE SEQUENCE IF NOT EXISTS, backfill NULLs only.

-- ---------------------------------------------------------------------------
-- 1) Sequence (trigger is SECURITY DEFINER; do not grant to JWT roles)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_number_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO CYCLE;

REVOKE ALL ON SEQUENCE public.support_ticket_number_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.support_ticket_number_seq FROM anon;
REVOKE ALL ON SEQUENCE public.support_ticket_number_seq FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2) ticket_seq + generated ticket_number
--    Drop the assign trigger first so a NULL backfill UPDATE cannot hit
--    "support ticket number cannot be changed".
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS support_conversations_assign_ticket_number_trg
  ON public.support_conversations;

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS ticket_seq bigint;

COMMENT ON COLUMN public.support_conversations.ticket_seq IS
  'Immutable global Ticket # sequence value. Display form is generated ticket_number.';

UPDATE public.support_conversations c
SET ticket_seq = s.rn
FROM (
  SELECT
    id,
    (
      COALESCE((SELECT MAX(ticket_seq) FROM public.support_conversations), 0)
      + ROW_NUMBER() OVER (ORDER BY created_at, id)
    )::bigint AS rn
  FROM public.support_conversations
  WHERE ticket_seq IS NULL
) s
WHERE c.id = s.id
  AND c.ticket_seq IS NULL;

ALTER TABLE public.support_conversations
  ALTER COLUMN ticket_seq SET NOT NULL;

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS ticket_number text
  GENERATED ALWAYS AS ('ALZA-'::text || lpad((ticket_seq)::text, 6, '0'::text)) STORED;

COMMENT ON COLUMN public.support_conversations.ticket_number IS
  'Stable Ticket # display value (ALZA-######). Generated from ticket_seq. Globally unique.';

CREATE UNIQUE INDEX IF NOT EXISTS support_conversations_ticket_seq_uidx
  ON public.support_conversations (ticket_seq);

CREATE UNIQUE INDEX IF NOT EXISTS support_conversations_ticket_number_uidx
  ON public.support_conversations (ticket_number);

-- ---------------------------------------------------------------------------
-- 3) Assign on INSERT; reject ticket_seq mutation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_support_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ticket_seq := nextval('public.support_ticket_number_seq');
    RETURN NEW;
  END IF;

  IF NEW.ticket_seq IS DISTINCT FROM OLD.ticket_seq THEN
    RAISE EXCEPTION 'support ticket number cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assign_support_ticket_number() IS
  'BEFORE INSERT: assign next global ticket_seq. BEFORE UPDATE: reject ticket_seq changes.';

REVOKE ALL ON FUNCTION public.assign_support_ticket_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_support_ticket_number() FROM anon;
REVOKE ALL ON FUNCTION public.assign_support_ticket_number() FROM authenticated;

CREATE TRIGGER support_conversations_assign_ticket_number_trg
  BEFORE INSERT OR UPDATE OF ticket_seq ON public.support_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_support_ticket_number();

-- Keep the sequence at or above existing suffixes. Never rewind (deleted numbers stay unused).
DO $$
DECLARE
  v_max bigint;
  v_seq bigint;
BEGIN
  SELECT COALESCE(MAX(ticket_seq), 0) INTO v_max
  FROM public.support_conversations;

  SELECT last_value INTO v_seq
  FROM pg_sequences
  WHERE schemaname = 'public'
    AND sequencename = 'support_ticket_number_seq';

  IF v_max = 0 THEN
    PERFORM setval('public.support_ticket_number_seq', 1, false);
  ELSE
    PERFORM setval(
      'public.support_ticket_number_seq',
      GREATEST(COALESCE(v_seq, 0), v_max),
      true
    );
  END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260908150000', 'support_ticket_number')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
