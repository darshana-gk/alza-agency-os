-- Require Payment Reference / Confirmation # on NEW Confirm Paid Outside ALZA Flow
-- confirmations. Does not change payment/recovery/batch math.
--
-- Legacy paid batches/transactions may have NULL payment_reference and remain valid:
-- this migration does NOT ALTER those columns to NOT NULL.
--
-- Replaces Phase 3C confirm_producer_paid_outside_alza_flow with the same tenant,
-- draft-only, item/net-match, and transaction-update behavior, plus a trim + reject
-- of blank / whitespace-only p_payment_reference.

CREATE OR REPLACE FUNCTION public.confirm_producer_paid_outside_alza_flow(
  p_batch_id uuid,
  p_payment_date date,
  p_payment_method text,
  p_payment_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_agency uuid;
  v_batch record;
  v_item_count integer;
  v_updated_count integer;
  v_method text;
  v_ref text;
  v_notes text;
  v_items_net numeric(14, 2);
  v_confirmed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT (public.current_user_has_role('owner') OR public.current_user_has_role('admin')) THEN
    RAISE EXCEPTION 'Not authorized to confirm producer payments';
  END IF;
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF v_agency IS NULL THEN
    RAISE EXCEPTION 'Not authorized to confirm producer payments';
  END IF;
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'Payment batch is required'; END IF;
  IF p_payment_date IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
  v_method := lower(btrim(COALESCE(p_payment_method, '')));
  IF v_method NOT IN ('ach', 'check', 'zelle', 'wire', 'cash', 'other') THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;
  v_ref := NULLIF(btrim(COALESCE(p_payment_reference, '')), '');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Payment reference / confirmation number is required.';
  END IF;
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  SELECT b.id, b.batch_number, b.producer, b.status, b.gross_commission, b.net_payment, b.notes, b.voided_at, b.agency_profile_id
  INTO v_batch
  FROM public.producer_payment_batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment batch not found'; END IF;
  IF v_batch.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Payment batch not found';
  END IF;
  IF lower(COALESCE(v_batch.status, '')) <> 'draft' OR v_batch.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment batch is not confirmable or has already been confirmed';
  END IF;
  IF COALESCE(v_batch.net_payment, 0) < 0 THEN
    RAISE EXCEPTION 'Payment batch net_payment must be >= 0';
  END IF;

  SELECT COUNT(*)::integer INTO v_item_count
  FROM public.producer_payment_batch_items i WHERE i.batch_id = p_batch_id;
  IF v_item_count < 1 THEN RAISE EXCEPTION 'Payment batch has no linked transactions'; END IF;

  PERFORM 1 FROM public.transactions t
  JOIN public.producer_payment_batch_items i ON i.transaction_id = t.id
  WHERE i.batch_id = p_batch_id AND t.agency_profile_id = v_agency
  ORDER BY t.id FOR UPDATE OF t;

  IF EXISTS (
    SELECT 1 FROM public.producer_payment_batch_items i
    JOIN public.transactions t ON t.id = i.transaction_id
    WHERE i.batch_id = p_batch_id
      AND (
        t.agency_profile_id IS DISTINCT FROM v_agency
        OR t.payment_batch_id IS DISTINCT FROM p_batch_id
        OR lower(COALESCE(t.producer_payment_status, '')) <> 'ready'
        OR t.paid_date IS NOT NULL
        OR t.archived_at IS NOT NULL
        OR btrim(COALESCE(t.producer, '')) IS DISTINCT FROM btrim(COALESCE(v_batch.producer, ''))
        OR COALESCE(i.net_amount, -1) < 0
      )
  ) THEN
    RAISE EXCEPTION 'One or more linked transactions are not eligible for payment confirmation';
  END IF;

  SELECT ROUND(COALESCE(SUM(i.net_amount), 0)::numeric, 2) INTO v_items_net
  FROM public.producer_payment_batch_items i WHERE i.batch_id = p_batch_id;
  IF abs(v_items_net - ROUND(COALESCE(v_batch.net_payment, 0)::numeric, 2)) > 0.009 THEN
    RAISE EXCEPTION 'Batch item net totals do not match batch net_payment';
  END IF;

  -- Confirm does NOT touch producer_commission_recoveries or producer_recovery_allocations.
  v_confirmed_at := now();
  UPDATE public.producer_payment_batches b
  SET status = 'paid', payment_date = p_payment_date, payment_method = v_method,
      payment_reference = v_ref, notes = COALESCE(v_notes, b.notes),
      confirmed_by = v_actor, confirmed_at = v_confirmed_at, payment_channel = 'outside_alza_flow'
  WHERE b.id = p_batch_id AND b.agency_profile_id = v_agency
    AND lower(COALESCE(b.status, '')) = 'draft' AND b.voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch was not updated. It may no longer be draft, or it may have been voided concurrently.';
  END IF;

  UPDATE public.transactions t
  SET producer_payment_status = 'paid',
      paid_amount = ROUND(COALESCE(i.net_amount, 0)::numeric, 2),
      paid_date = p_payment_date, payment_method = v_method, payment_reference = v_ref
  FROM public.producer_payment_batch_items i
  WHERE i.batch_id = p_batch_id AND t.id = i.transaction_id
    AND t.payment_batch_id = p_batch_id AND t.agency_profile_id = v_agency
    AND lower(COALESCE(t.producer_payment_status, '')) = 'ready' AND t.paid_date IS NULL;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_item_count THEN
    RAISE EXCEPTION 'Linked transaction update mismatch (% of %). Rolling back to prevent a partial-paid batch.',
      v_updated_count, v_item_count;
  END IF;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id, 'batch_number', v_batch.batch_number, 'producer', v_batch.producer,
    'status', 'paid', 'payment_date', p_payment_date, 'payment_method', v_method,
    'payment_reference', v_ref, 'notes', COALESCE(v_notes, v_batch.notes),
    'gross_commission', v_batch.gross_commission, 'net_payment', v_batch.net_payment,
    'recovery_applied', ROUND(GREATEST(COALESCE(v_batch.gross_commission, 0) - COALESCE(v_batch.net_payment, 0), 0), 2),
    'transaction_count', v_updated_count, 'confirmed_by', v_actor,
    'confirmed_at', v_confirmed_at, 'payment_channel', 'outside_alza_flow'
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) IS
  'Owner/Admin, same-agency only. New confirms require a trimmed payment reference. Does not move money. Does not mutate recoveries.';

REVOKE ALL ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260831200000', 'confirm_paid_require_payment_reference')
ON CONFLICT (version) DO NOTHING;
