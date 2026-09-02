-- V1 policy Rewrite lineage. Additive only.
-- Does not change transaction math, RLS policies, or numbering.

ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS rewritten_from_policy_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'policies_rewritten_from_policy_id_fkey'
  ) THEN
    ALTER TABLE public.policies
      ADD CONSTRAINT policies_rewritten_from_policy_id_fkey
      FOREIGN KEY (rewritten_from_policy_id)
      REFERENCES public.policies (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS policies_rewritten_from_policy_id_idx
  ON public.policies (rewritten_from_policy_id)
  WHERE rewritten_from_policy_id IS NOT NULL;

COMMENT ON COLUMN public.policies.rewritten_from_policy_id IS
  'Predecessor policy when this row was created by Rewrite. Inverse (Rewritten to) is queried by this FK.';

CREATE OR REPLACE FUNCTION public.enforce_policy_rewrite_same_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.rewritten_from_policy_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.rewritten_from_policy_id = NEW.id THEN
    RAISE EXCEPTION 'A policy cannot rewrite itself.';
  END IF;
  IF NEW.agency_profile_id IS NULL THEN
    RAISE EXCEPTION 'Rewrite requires a stamped agency_profile_id.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.policies p
    WHERE p.id = NEW.rewritten_from_policy_id
      AND p.agency_profile_id = NEW.agency_profile_id
  ) THEN
    RAISE EXCEPTION 'Rewrite source policy must belong to the same agency.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS policies_rewrite_same_agency ON public.policies;
CREATE TRIGGER policies_rewrite_same_agency
  BEFORE INSERT OR UPDATE OF rewritten_from_policy_id, agency_profile_id
  ON public.policies
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_policy_rewrite_same_agency();

COMMENT ON FUNCTION public.enforce_policy_rewrite_same_agency() IS
  'Rejects cross-tenant or self rewrite links. Runs after tenant stamp (aaa_*).';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260902120000', 'policy_rewrite_lineage')
ON CONFLICT (version) DO NOTHING;
