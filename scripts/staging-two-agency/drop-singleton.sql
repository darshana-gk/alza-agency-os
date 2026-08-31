-- STAGING TWO-AGENCY VALIDATION ONLY
-- Target: ALZA Flow Staging uzckhxpqnipnovplohpf
-- NOT a Production migration. Do NOT add to supabase/migrations/.
-- Applied only by scripts/validate-two-agency-staging.ts after a live project-ref check.
--
-- Drops agency_profile_singleton so a second agency_profile row can exist.
-- Does not create Agency B. Does not touch Production.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agency_profile
    WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) THEN
    RAISE EXCEPTION 'two-agency abort: Agency A (tenant-1) missing — refusing singleton drop';
  END IF;

  ALTER TABLE public.agency_profile DROP CONSTRAINT IF EXISTS agency_profile_singleton;
END $$;

SELECT jsonb_build_object(
  'singleton', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton'),
  'agency_n', (SELECT COUNT(*) FROM public.agency_profile),
  'agency_a', EXISTS (
    SELECT 1 FROM public.agency_profile WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  )
) AS staging_singleton_drop;
