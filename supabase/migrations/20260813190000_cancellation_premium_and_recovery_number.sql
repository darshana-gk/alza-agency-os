-- ALZA Flow — Workflow corrections: cancellation_premium + recovery_number
-- Does not drop return_premium (historical). Does not rewrite financial amounts.

-- ---------------------------------------------------------------------------
-- 1) Allow cancellation_premium on transactions.transaction_type
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_transaction_type_check
  CHECK (
    transaction_type IN (
      'new_policy_premium',
      'renewal_premium',
      'endorsement_premium',
      'audit_premium',
      'cancellation_premium',
      'return_premium'
    )
  );

COMMENT ON CONSTRAINT transactions_transaction_type_check ON public.transactions IS
  'Active types include cancellation_premium. return_premium retained for historical rows.';

-- ---------------------------------------------------------------------------
-- 2) Recovery / Chargeback user-facing number: RCV-YYYY-######
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recovery_number_counters (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_recovery_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  next_val INTEGER;
BEGIN
  INSERT INTO public.recovery_number_counters AS c (year, last_value)
  VALUES (yr, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_value = c.last_value + 1
  RETURNING last_value INTO next_val;

  RETURN 'RCV-' || yr::TEXT || '-' || lpad(next_val::TEXT, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_recovery_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_recovery_number() TO authenticated, service_role;

ALTER TABLE public.producer_commission_recoveries
  ADD COLUMN IF NOT EXISTS recovery_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producer_commission_recoveries_recovery_number_key'
  ) THEN
    ALTER TABLE public.producer_commission_recoveries
      ADD CONSTRAINT producer_commission_recoveries_recovery_number_key UNIQUE (recovery_number);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_recovery_number_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.recovery_number IS NULL OR btrim(NEW.recovery_number) = '' THEN
    NEW.recovery_number := public.next_recovery_number();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_recovery_number ON public.producer_commission_recoveries;
CREATE TRIGGER trg_set_recovery_number
  BEFORE INSERT ON public.producer_commission_recoveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_recovery_number_if_missing();

-- Backfill existing recoveries safely (idempotent).
DO $$
DECLARE
  r RECORD;
  yr INTEGER;
  next_val INTEGER;
BEGIN
  FOR r IN
    SELECT id, created_at
    FROM public.producer_commission_recoveries
    WHERE recovery_number IS NULL OR btrim(recovery_number) = ''
    ORDER BY created_at ASC NULLS LAST, id ASC
  LOOP
    yr := EXTRACT(YEAR FROM COALESCE(r.created_at, now()))::INTEGER;
    INSERT INTO public.recovery_number_counters AS c (year, last_value)
    VALUES (yr, 1)
    ON CONFLICT (year) DO UPDATE
      SET last_value = c.last_value + 1
    RETURNING last_value INTO next_val;

    UPDATE public.producer_commission_recoveries
    SET recovery_number = 'RCV-' || yr::TEXT || '-' || lpad(next_val::TEXT, 6, '0')
    WHERE id = r.id
      AND (recovery_number IS NULL OR btrim(recovery_number) = '');
  END LOOP;
END $$;
