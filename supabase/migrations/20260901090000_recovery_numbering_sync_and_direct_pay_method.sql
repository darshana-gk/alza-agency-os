-- Agency-scoped recovery numbers: catch up counters to existing RCV-YYYY-######
-- suffixes, then issue the next value atomically. Does not rewrite stored
-- recovery_number values. Does not drop producer_commission_recoveries_agency_recovery_number_uidx.
--
-- Deleted high numbers are not reused: last_value only moves forward.
-- Seeded/hardcoded numbers that skipped the counter cannot collide: the next
-- value is GREATEST(counter + 1, max existing suffix + 1).
--
-- Also adds direct_paid_payment_method for Confirm Recovery Payment (nullable;
-- legacy rows stay valid).

ALTER TABLE public.producer_commission_recoveries
  ADD COLUMN IF NOT EXISTS direct_paid_amount numeric,
  ADD COLUMN IF NOT EXISTS direct_paid_date date,
  ADD COLUMN IF NOT EXISTS direct_payment_reference text,
  ADD COLUMN IF NOT EXISTS direct_paid_notes text,
  ADD COLUMN IF NOT EXISTS direct_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS direct_paid_by uuid,
  ADD COLUMN IF NOT EXISTS direct_paid_payment_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'producer_commission_recoveries_direct_paid_by_fkey'
  ) THEN
    ALTER TABLE public.producer_commission_recoveries
      ADD CONSTRAINT producer_commission_recoveries_direct_paid_by_fkey
      FOREIGN KEY (direct_paid_by) REFERENCES public.users (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'producer_commission_recoveries_direct_paid_payment_method_check'
  ) THEN
    ALTER TABLE public.producer_commission_recoveries
      ADD CONSTRAINT producer_commission_recoveries_direct_paid_payment_method_check
      CHECK (
        direct_paid_payment_method IS NULL
        OR direct_paid_payment_method IN ('ach', 'check', 'zelle', 'wire', 'cash', 'other')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.producer_commission_recoveries.direct_paid_payment_method IS
  'Payment method captured on Confirm Recovery Payment (direct_payment). NULL on legacy rows.';

INSERT INTO public.recovery_number_counters (agency_profile_id, year, last_value)
SELECT s.agency_profile_id, s.yr, s.max_suffix
FROM (
  SELECT
    r.agency_profile_id,
    substring(r.recovery_number from 5 for 4)::integer AS yr,
    MAX(substring(r.recovery_number from 10)::integer) AS max_suffix
  FROM public.producer_commission_recoveries r
  WHERE r.agency_profile_id IS NOT NULL
    AND r.recovery_number ~ '^RCV-[0-9]{4}-[0-9]{6}$'
  GROUP BY r.agency_profile_id, substring(r.recovery_number from 5 for 4)::integer
) s
ON CONFLICT (agency_profile_id, year) DO UPDATE
  SET last_value = GREATEST(public.recovery_number_counters.last_value, EXCLUDED.last_value);

CREATE OR REPLACE FUNCTION public.next_recovery_number(p_agency uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  agency uuid;
  yr integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  next_val integer;
  max_existing integer := 0;
BEGIN
  agency := public.multitenancy_numbering_agency(p_agency);

  SELECT COALESCE(MAX(
    CASE
      WHEN r.recovery_number ~ ('^RCV-' || yr::text || '-[0-9]{6}$')
        THEN substring(r.recovery_number from 10)::integer
      ELSE 0
    END
  ), 0)
  INTO max_existing
  FROM public.producer_commission_recoveries r
  WHERE r.agency_profile_id IS NOT DISTINCT FROM agency;

  INSERT INTO public.recovery_number_counters AS c (agency_profile_id, year, last_value)
  VALUES (agency, yr, GREATEST(1, max_existing + 1))
  ON CONFLICT (agency_profile_id, year) DO UPDATE
    SET last_value = GREATEST(c.last_value + 1, EXCLUDED.last_value)
  RETURNING last_value INTO next_val;
  -- Concurrent same-(agency, year) inserts serialize on this unique row.
  -- last_value never decreases, so deleted recoveries are not reused.

  RETURN 'RCV-' || yr::text || '-' || lpad(next_val::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION public.next_recovery_number(uuid) IS
  'Tenant-scoped RCV-YYYY-######. Atomic counter; floors to max existing suffix; never reuses deleted numbers.';

REVOKE ALL ON FUNCTION public.next_recovery_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_recovery_number(uuid) TO authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901090000', 'recovery_numbering_sync_and_direct_pay_method')
ON CONFLICT (version) DO NOTHING;
