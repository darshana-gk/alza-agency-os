-- Cap producer recoveries for negative producer-commission transactions.
-- Max recoverable = ABS(producer_commission_amount) − SUM(non-voided recovery amounts).
-- Positive producer-commission transactions are not capped by this trigger.
-- Does not rewrite historical recovery rows.

CREATE OR REPLACE FUNCTION public.enforce_recovery_amount_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_producer_commission numeric(14, 2);
  v_obligation numeric(14, 2);
  v_existing numeric(14, 2);
  v_available numeric(14, 2);
BEGIN
  IF NEW.transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip voided rows (voiding must not fail the amount cap).
  IF NEW.voided_at IS NOT NULL OR lower(COALESCE(NEW.status, '')) = 'voided' THEN
    RETURN NEW;
  END IF;

  SELECT ROUND(COALESCE(t.producer_commission_amount, 0)::numeric, 2)
  INTO v_producer_commission
  FROM public.transactions t
  WHERE t.id = NEW.transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery transaction not found';
  END IF;

  IF v_producer_commission >= 0 THEN
    RETURN NEW;
  END IF;

  v_obligation := ROUND(ABS(v_producer_commission), 2);

  SELECT ROUND(COALESCE(SUM(r.amount), 0)::numeric, 2)
  INTO v_existing
  FROM public.producer_commission_recoveries r
  WHERE r.transaction_id = NEW.transaction_id
    AND r.voided_at IS NULL
    AND lower(COALESCE(r.status, '')) <> 'voided'
    AND (TG_OP = 'INSERT' OR r.id IS DISTINCT FROM NEW.id);

  v_available := ROUND(GREATEST(v_obligation - v_existing, 0), 2);

  IF ROUND(COALESCE(NEW.amount, 0)::numeric, 2) > v_available THEN
    RAISE EXCEPTION
      'Recovery amount (%) exceeds available recoverable amount (%) for this transaction (obligation %, already recovered %)',
      ROUND(COALESCE(NEW.amount, 0)::numeric, 2),
      v_available,
      v_obligation,
      v_existing;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_recovery_amount_cap
  ON public.producer_commission_recoveries;

CREATE TRIGGER trg_enforce_recovery_amount_cap
  BEFORE INSERT OR UPDATE OF amount, transaction_id, status, voided_at
  ON public.producer_commission_recoveries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_recovery_amount_cap();

COMMENT ON FUNCTION public.enforce_recovery_amount_cap() IS
  'Prevents over-recovery on negative producer-commission transactions.';
