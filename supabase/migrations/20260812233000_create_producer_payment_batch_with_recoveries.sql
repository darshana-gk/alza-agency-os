-- Atomic producer payment batch + recovery application
-- Function: public.create_producer_payment_batch_with_recoveries(text, uuid[], text)
--
-- Applies OPEN producer recoveries oldest-first into producer_recovery_allocations
-- inside ONE transaction with batch + items + transaction links.
--
-- Does NOT auto-confirm paid.
-- Does NOT rewrite historical paid transactions.
-- APPLY before frontend payout create can succeed (RPC is required).

CREATE OR REPLACE FUNCTION public.create_producer_payment_batch_with_recoveries(
  p_producer text,
  p_transaction_ids uuid[],
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_producer text := btrim(COALESCE(p_producer, ''));
  v_txn_count integer;
  v_linked_count integer;
  v_gross numeric(14, 2) := 0;
  v_recovery_applied numeric(14, 2) := 0;
  v_net numeric(14, 2) := 0;
  v_available numeric(14, 2);
  v_batch_id uuid;
  v_batch_number text;
  v_rec record;
  v_txn record;
  v_take numeric(14, 2);
  v_item_pool numeric(14, 2);
  v_item_take numeric(14, 2);
  v_item_net numeric(14, 2);
  v_plan jsonb := '[]'::jsonb;
  v_plan_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT u.id
  INTO v_actor
  FROM public.users u
  WHERE u.auth_user_id = v_uid
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.status, 'active')) = 'active'
    AND lower(COALESCE(u.role, '')) IN ('owner', 'admin')
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authorized to create producer payment batches';
  END IF;

  IF v_producer = '' THEN
    RAISE EXCEPTION 'Producer is required';
  END IF;

  IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one transaction';
  END IF;

  IF (
    SELECT COUNT(DISTINCT x)
    FROM unnest(p_transaction_ids) AS x
  ) <> cardinality(p_transaction_ids) THEN
    RAISE EXCEPTION 'Duplicate transaction ids are not allowed';
  END IF;

  -- Lock eligible transactions in stable id order (deadlock-safe)
  PERFORM 1
  FROM public.transactions t
  WHERE t.id = ANY (p_transaction_ids)
  ORDER BY t.id
  FOR UPDATE;

  SELECT COUNT(*)::integer
  INTO v_txn_count
  FROM public.transactions t
  WHERE t.id = ANY (p_transaction_ids);

  IF v_txn_count <> cardinality(p_transaction_ids) THEN
    RAISE EXCEPTION 'One or more selected transactions could not be loaded';
  END IF;

  FOR v_txn IN
    SELECT
      t.id,
      t.transaction_number,
      btrim(COALESCE(t.producer, '')) AS producer,
      ROUND(COALESCE(t.producer_commission_amount, 0)::numeric, 2) AS producer_commission_amount,
      t.agency_commission_confirmed,
      lower(COALESCE(t.review_status, '')) AS review_status,
      lower(COALESCE(t.producer_payment_status, '')) AS producer_payment_status,
      t.payment_batch_id,
      t.archived_at,
      t.paid_date
    FROM public.transactions t
    WHERE t.id = ANY (p_transaction_ids)
    ORDER BY t.id
  LOOP
    IF NOT v_txn.agency_commission_confirmed
       OR v_txn.review_status <> 'approved'
       OR v_txn.producer = ''
       OR v_txn.producer_commission_amount <= 0
       OR v_txn.producer_payment_status <> 'ready'
       OR v_txn.payment_batch_id IS NOT NULL
       OR v_txn.archived_at IS NOT NULL
       OR v_txn.paid_date IS NOT NULL
    THEN
      RAISE EXCEPTION
        'Transaction % is not eligible for a payment batch',
        COALESCE(v_txn.transaction_number, v_txn.id::text);
    END IF;

    IF v_txn.producer <> v_producer THEN
      RAISE EXCEPTION
        'Selected producer does not match transaction % producer',
        COALESCE(v_txn.transaction_number, v_txn.id::text);
    END IF;

    v_gross := v_gross + v_txn.producer_commission_amount;
  END LOOP;

  v_gross := ROUND(v_gross, 2);
  v_available := v_gross;

  -- Lock + plan OPEN recoveries oldest-first (producer-level carry-forward)
  FOR v_rec IN
    SELECT
      r.id,
      ROUND(r.remaining_amount::numeric, 2) AS remaining_amount
    FROM public.producer_commission_recoveries r
    WHERE btrim(COALESCE(r.producer, '')) = v_producer
      AND r.status = 'open'
      AND r.remaining_amount > 0
      AND r.voided_at IS NULL
    ORDER BY r.created_at ASC, r.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_available <= 0;

    v_take := ROUND(LEAST(v_rec.remaining_amount, v_available), 2);
    IF v_take <= 0 THEN
      CONTINUE;
    END IF;

    v_plan := v_plan || jsonb_build_array(
      jsonb_build_object(
        'recovery_id', v_rec.id,
        'amount', v_take
      )
    );

    v_available := ROUND(v_available - v_take, 2);
    v_recovery_applied := ROUND(v_recovery_applied + v_take, 2);
  END LOOP;

  v_net := ROUND(GREATEST(v_available, 0), 2);

  INSERT INTO public.producer_payment_batches (
    producer,
    status,
    gross_commission,
    net_payment,
    notes,
    payment_date,
    payment_method,
    payment_reference
  )
  VALUES (
    v_producer,
    'draft',
    v_gross,
    v_net,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    NULL,
    NULL,
    NULL
  )
  RETURNING id, batch_number
  INTO v_batch_id, v_batch_number;

  -- Item nets: apply this batch's recovery pool FIFO across selected transactions
  v_item_pool := v_recovery_applied;

  FOR v_txn IN
    SELECT
      t.id,
      ROUND(COALESCE(t.producer_commission_amount, 0)::numeric, 2) AS producer_commission_amount
    FROM public.transactions t
    WHERE t.id = ANY (p_transaction_ids)
    ORDER BY t.id
  LOOP
    v_item_take := ROUND(LEAST(v_txn.producer_commission_amount, GREATEST(v_item_pool, 0)), 2);
    v_item_net := ROUND(GREATEST(v_txn.producer_commission_amount - v_item_take, 0), 2);
    v_item_pool := ROUND(v_item_pool - v_item_take, 2);

    INSERT INTO public.producer_payment_batch_items (batch_id, transaction_id, net_amount)
    VALUES (v_batch_id, v_txn.id, v_item_net);
  END LOOP;

  FOR v_plan_item IN
    SELECT value
    FROM jsonb_array_elements(v_plan)
  LOOP
    INSERT INTO public.producer_recovery_allocations (
      recovery_id,
      payment_batch_id,
      amount,
      created_by
    )
    VALUES (
      (v_plan_item ->> 'recovery_id')::uuid,
      v_batch_id,
      ROUND((v_plan_item ->> 'amount')::numeric, 2),
      v_actor
    );

    UPDATE public.producer_commission_recoveries r
    SET
      applied_amount = ROUND(r.applied_amount + ROUND((v_plan_item ->> 'amount')::numeric, 2), 2),
      remaining_amount = ROUND(r.remaining_amount - ROUND((v_plan_item ->> 'amount')::numeric, 2), 2),
      status = CASE
        WHEN ROUND(r.remaining_amount - ROUND((v_plan_item ->> 'amount')::numeric, 2), 2) > 0
          THEN 'open'
        ELSE 'applied'
      END
    WHERE r.id = (v_plan_item ->> 'recovery_id')::uuid;
  END LOOP;

  UPDATE public.transactions t
  SET payment_batch_id = v_batch_id
  WHERE t.id = ANY (p_transaction_ids)
    AND t.producer_payment_status = 'ready'
    AND t.agency_commission_confirmed = true
    AND lower(COALESCE(t.review_status, '')) = 'approved'
    AND t.payment_batch_id IS NULL
    AND t.archived_at IS NULL
    AND t.paid_date IS NULL
    AND COALESCE(t.producer_commission_amount, 0) > 0
    AND btrim(COALESCE(t.producer, '')) = v_producer;

  SELECT COUNT(*)::integer
  INTO v_linked_count
  FROM public.transactions
  WHERE payment_batch_id = v_batch_id;

  IF v_linked_count <> cardinality(p_transaction_ids) THEN
    RAISE EXCEPTION
      'Payment batch link race: one or more transactions are no longer eligible';
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_number', v_batch_number,
    'gross_commission', v_gross,
    'recovery_applied', v_recovery_applied,
    'net_payment', v_net
  );
END;
$$;

COMMENT ON FUNCTION public.create_producer_payment_batch_with_recoveries(text, uuid[], text) IS
  'Atomically creates a producer payment batch, applies OPEN recoveries oldest-first via producer_recovery_allocations, and links transactions. Owner/Admin only.';

REVOKE ALL ON FUNCTION public.create_producer_payment_batch_with_recoveries(text, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_producer_payment_batch_with_recoveries(text, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_producer_payment_batch_with_recoveries(text, uuid[], text) TO service_role;
