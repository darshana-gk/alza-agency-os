-- ALZA Flow Multi-Tenancy V1 — Phase 3C
-- Transaction workflow privilege trigger + SECURITY DEFINER RPCs.
-- Hardens producer-payment RPCs with same-agency assertions.
--
-- AUTHORING ONLY. Do NOT apply to Production. Do NOT drop singleton.
-- Crafted PostgREST UPDATEs of privileged columns are rejected (current_user authenticated).
-- RPCs run as postgres (SECURITY DEFINER) and therefore may change those columns.

DO $$
BEGIN
  IF to_regproc('public.same_agency') IS NULL THEN
    RAISE EXCEPTION 'Phase 3C abort: Phase 3B same_agency() missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Privilege trigger — JWT/service_role cannot patch workflow columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_transaction_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     OR NEW.review_return_reason IS DISTINCT FROM OLD.review_return_reason
     OR NEW.review_returned_at IS DISTINCT FROM OLD.review_returned_at
     OR NEW.review_returned_by IS DISTINCT FROM OLD.review_returned_by
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_date IS DISTINCT FROM OLD.reviewed_date
     OR NEW.producer_payment_status IS DISTINCT FROM OLD.producer_payment_status
     OR NEW.paid_date IS DISTINCT FROM OLD.paid_date
     OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.payment_batch_id IS DISTINCT FROM OLD.payment_batch_id
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
     OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
     OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
     OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
     OR NEW.agency_commission_confirmed IS DISTINCT FROM OLD.agency_commission_confirmed
     OR NEW.agency_commission_receipt_id IS DISTINCT FROM OLD.agency_commission_receipt_id
     OR NEW.amount_received IS DISTINCT FROM OLD.amount_received
     OR NEW.received_date IS DISTINCT FROM OLD.received_date
  THEN
    RAISE EXCEPTION
      'privileged transaction fields require workflow RPC (submit/approve/return/ready/void/receipt/payment)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aac_enforce_transaction_privilege ON public.transactions;
CREATE TRIGGER aac_enforce_transaction_privilege
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_transaction_privilege();

COMMENT ON FUNCTION public.enforce_transaction_privilege() IS
  'Phase 3C: authenticated/service_role cannot UPDATE workflow/payment/void/receipt columns. SECURITY DEFINER RPCs (owner postgres) may.';

-- ---------------------------------------------------------------------------
-- 2) Shared actor + agency
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.multitenancy_require_active_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT u.id INTO v_actor
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.status, 'active')) = 'active';
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF public.current_user_agency_profile_id() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.multitenancy_assert_assigned_reviewer(p_reviewer uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF public.current_user_has_role('owner') THEN
    RETURN;
  END IF;
  IF public.current_user_has_role('admin') THEN
    IF p_reviewer IS NULL OR p_reviewer = v_actor THEN
      RETURN;
    END IF;
    RAISE EXCEPTION
      'Only the assigned reviewer may perform this action (Owner may override)';
  END IF;
  RAISE EXCEPTION 'Not authorized';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Workflow RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_transaction_for_review(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_row public.transactions%ROWTYPE;
  v_n integer;
BEGIN
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF NOT public.is_ops_staff() THEN
    RAISE EXCEPTION 'Not authorized to submit transactions for review';
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_row.archived_at IS NOT NULL OR v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction cannot be submitted';
  END IF;
  IF v_row.agency_commission_confirmed IS NOT TRUE
     OR lower(COALESCE(v_row.review_status, '')) <> 'expected'
     OR lower(COALESCE(v_row.producer_payment_status, '')) <> 'not_ready'
     OR v_row.payment_batch_id IS NOT NULL
     OR v_row.paid_date IS NOT NULL
     OR v_row.reviewer_user_id IS NULL THEN
    RAISE EXCEPTION 'Transaction is not eligible for submit for review';
  END IF;

  UPDATE public.transactions
  SET
    review_status = 'matched',
    review_return_reason = NULL,
    review_returned_at = NULL,
    review_returned_by = NULL,
    csr_user_id = CASE
      WHEN public.current_user_has_role('csr') THEN v_actor
      ELSE csr_user_id
    END
  WHERE id = p_transaction_id
    AND agency_profile_id = v_agency
    AND review_status = 'expected'
    AND agency_commission_confirmed = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Submit for review did not update any row';
  END IF;
  RETURN jsonb_build_object('id', p_transaction_id, 'review_status', 'matched');
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_agency_commission_received(
  p_transaction_id uuid,
  p_amount_received numeric,
  p_received_date date,
  p_deposit_reference text DEFAULT NULL,
  p_external_invoice_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_variance_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_row public.transactions%ROWTYPE;
  v_expected numeric;
  v_receipt uuid;
  v_reset boolean;
BEGIN
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF NOT public.is_ops_staff() THEN
    RAISE EXCEPTION 'Not authorized to confirm agency commission receipts';
  END IF;
  IF p_amount_received IS NULL OR p_received_date IS NULL THEN
    RAISE EXCEPTION 'Amount received and received date are required';
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_row.agency_commission_confirmed IS TRUE THEN
    RETURN jsonb_build_object('id', p_transaction_id, 'duplicate', true, 'receipt_id', v_row.agency_commission_receipt_id);
  END IF;

  v_expected := ROUND(COALESCE(v_row.agency_commission_amount, 0)::numeric, 2);
  IF abs(p_amount_received - v_expected) > 0.009 AND p_variance_acknowledged IS NOT TRUE THEN
    RAISE EXCEPTION 'Amount received differs from expected. Acknowledge the variance before confirming.';
  END IF;

  INSERT INTO public.agency_commission_receipts (
    client_id, policy_id, transaction_id, matched_transaction_id, producer,
    source, external_invoice_id, deposit_reference, notes, settlement_date,
    imported_at, reconciliation_status, match_confidence, agency_profile_id
  ) VALUES (
    v_row.client_id, v_row.policy_id, v_row.id, v_row.id, NULLIF(btrim(COALESCE(v_row.producer, '')), ''),
    'manual', NULLIF(btrim(COALESCE(p_external_invoice_id, '')), ''),
    NULLIF(btrim(COALESCE(p_deposit_reference, '')), ''),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_received_date, now(), 'matched', 'none', v_agency
  )
  RETURNING id INTO v_receipt;

  v_reset := lower(COALESCE(v_row.producer_payment_status, '')) NOT IN ('ready', 'paid')
    AND v_row.paid_date IS NULL
    AND v_row.payment_batch_id IS NULL
    AND lower(COALESCE(v_row.review_status, '')) NOT IN ('matched', 'approved');

  UPDATE public.transactions
  SET
    amount_received = p_amount_received,
    received_date = p_received_date,
    agency_commission_confirmed = true,
    agency_commission_receipt_id = v_receipt,
    review_status = CASE WHEN v_reset THEN 'expected' ELSE review_status END
  WHERE id = p_transaction_id
    AND agency_profile_id = v_agency
    AND agency_commission_confirmed = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', p_transaction_id, 'duplicate', true, 'receipt_id', v_receipt);
  END IF;
  RETURN jsonb_build_object('id', p_transaction_id, 'receipt_id', v_receipt);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_transaction_review(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_row public.transactions%ROWTYPE;
BEGIN
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF NOT public.is_admin_directory_role() THEN
    RAISE EXCEPTION 'Not authorized to approve transactions';
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  PERFORM public.multitenancy_assert_assigned_reviewer(v_row.reviewer_user_id);
  IF v_row.archived_at IS NOT NULL
     OR lower(COALESCE(v_row.producer_payment_status, '')) = 'paid'
     OR v_row.paid_date IS NOT NULL
     OR v_row.payment_batch_id IS NOT NULL
     OR v_row.agency_commission_confirmed IS NOT TRUE
     OR lower(COALESCE(v_row.review_status, '')) <> 'matched' THEN
    RAISE EXCEPTION 'Transaction cannot be approved';
  END IF;

  UPDATE public.transactions
  SET review_status = 'approved', reviewed_by = v_actor, reviewed_date = now()
  WHERE id = p_transaction_id AND agency_profile_id = v_agency AND review_status = 'matched';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approve did not update any row';
  END IF;
  RETURN jsonb_build_object('id', p_transaction_id, 'review_status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.return_transaction_for_correction(
  p_transaction_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_row public.transactions%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF NOT public.is_admin_directory_role() THEN
    RAISE EXCEPTION 'Not authorized to return transactions for correction';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Reason for correction is required';
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  PERFORM public.multitenancy_assert_assigned_reviewer(v_row.reviewer_user_id);
  IF v_row.archived_at IS NOT NULL
     OR lower(COALESCE(v_row.producer_payment_status, '')) <> 'not_ready'
     OR v_row.paid_date IS NOT NULL
     OR v_row.payment_batch_id IS NOT NULL
     OR v_row.agency_commission_confirmed IS NOT TRUE
     OR lower(COALESCE(v_row.review_status, '')) NOT IN ('matched', 'approved') THEN
    RAISE EXCEPTION 'Transaction cannot be returned';
  END IF;

  UPDATE public.transactions
  SET
    review_status = 'expected',
    review_return_reason = v_reason,
    review_returned_at = now(),
    review_returned_by = v_actor
  WHERE id = p_transaction_id AND agency_profile_id = v_agency;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return for correction did not update any row';
  END IF;
  RETURN jsonb_build_object('id', p_transaction_id, 'review_status', 'expected');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_producer_commission_ready(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_row public.transactions%ROWTYPE;
BEGIN
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF NOT public.is_admin_directory_role() THEN
    RAISE EXCEPTION 'Not authorized to mark producer commission ready';
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  PERFORM public.multitenancy_assert_assigned_reviewer(v_row.reviewer_user_id);
  IF v_row.agency_commission_confirmed IS NOT TRUE
     OR lower(COALESCE(v_row.review_status, '')) <> 'approved'
     OR btrim(COALESCE(v_row.producer, '')) IN ('', '—')
     OR COALESCE(v_row.producer_commission_amount, 0) <= 0
     OR lower(COALESCE(v_row.producer_payment_status, '')) <> 'not_ready'
     OR v_row.payment_batch_id IS NOT NULL
     OR v_row.archived_at IS NOT NULL
     OR v_row.paid_date IS NOT NULL
     OR v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction does not meet Mark Ready requirements';
  END IF;

  UPDATE public.transactions
  SET producer_payment_status = 'ready'
  WHERE id = p_transaction_id
    AND agency_profile_id = v_agency
    AND producer_payment_status = 'not_ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mark Ready did not update any row';
  END IF;
  RETURN jsonb_build_object('id', p_transaction_id, 'producer_payment_status', 'ready');
END;
$$;

CREATE OR REPLACE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  v_agency uuid;
  v_row public.transactions%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_rec integer;
BEGIN
  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF NOT public.is_admin_directory_role() THEN
    RAISE EXCEPTION 'Not authorized to void transactions';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Void reason is required';
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_row.archived_at IS NOT NULL OR v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction not found or already archived/voided';
  END IF;
  IF v_row.payment_batch_id IS NOT NULL
     OR v_row.paid_date IS NOT NULL
     OR lower(COALESCE(v_row.producer_payment_status, '')) = 'paid' THEN
    RAISE EXCEPTION 'Cannot void a paid or batched transaction';
  END IF;
  SELECT COUNT(*)::integer INTO v_rec
  FROM public.producer_commission_recoveries r
  WHERE r.transaction_id = p_transaction_id AND r.voided_at IS NULL;
  IF v_rec > 0 THEN
    RAISE EXCEPTION 'Cannot void a transaction linked to recoveries';
  END IF;

  UPDATE public.transactions
  SET
    voided_at = now(),
    voided_by = v_actor,
    void_reason = v_reason,
    producer_payment_status = 'not_ready'
  WHERE id = p_transaction_id AND agency_profile_id = v_agency AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Void did not update any row';
  END IF;
  RETURN jsonb_build_object('id', p_transaction_id, 'voided', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_transaction_for_review(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_agency_commission_received(uuid, numeric, date, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_transaction_review(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_transaction_for_correction(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_producer_commission_ready(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_transaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_transaction_for_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_agency_commission_received(uuid, numeric, date, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_transaction_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_transaction_for_correction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_producer_commission_ready(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_transaction(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Harden existing producer-payment RPCs with agency assertions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_producer_payment_batch_with_recoveries(
  p_producer text,
  p_transaction_ids uuid[],
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
  IF NOT (public.current_user_has_role('owner') OR public.current_user_has_role('admin')) THEN
    RAISE EXCEPTION 'Not authorized to create producer payment batches';
  END IF;

  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF v_agency IS NULL THEN
    RAISE EXCEPTION 'Not authorized to create producer payment batches';
  END IF;

  IF v_producer = '' THEN
    RAISE EXCEPTION 'Producer is required';
  END IF;
  IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one transaction';
  END IF;
  IF (SELECT COUNT(DISTINCT x) FROM unnest(p_transaction_ids) AS x) <> cardinality(p_transaction_ids) THEN
    RAISE EXCEPTION 'Duplicate transaction ids are not allowed';
  END IF;

  PERFORM 1 FROM public.transactions t
  WHERE t.id = ANY (p_transaction_ids) AND t.agency_profile_id = v_agency
  ORDER BY t.id FOR UPDATE;

  SELECT COUNT(*)::integer INTO v_txn_count
  FROM public.transactions t
  WHERE t.id = ANY (p_transaction_ids) AND t.agency_profile_id = v_agency;
  IF v_txn_count <> cardinality(p_transaction_ids) THEN
    RAISE EXCEPTION 'One or more selected transactions could not be loaded';
  END IF;

  FOR v_txn IN
    SELECT t.id, t.transaction_number, btrim(COALESCE(t.producer, '')) AS producer,
      ROUND(COALESCE(t.producer_commission_amount, 0)::numeric, 2) AS producer_commission_amount,
      t.agency_commission_confirmed, lower(COALESCE(t.review_status, '')) AS review_status,
      lower(COALESCE(t.producer_payment_status, '')) AS producer_payment_status,
      t.payment_batch_id, t.archived_at, t.paid_date, t.agency_profile_id
    FROM public.transactions t
    WHERE t.id = ANY (p_transaction_ids)
    ORDER BY t.id
  LOOP
    IF v_txn.agency_profile_id IS DISTINCT FROM v_agency THEN
      RAISE EXCEPTION 'Transaction % is not in the caller agency', COALESCE(v_txn.transaction_number, v_txn.id::text);
    END IF;
    IF NOT v_txn.agency_commission_confirmed
       OR v_txn.review_status <> 'approved'
       OR v_txn.producer = ''
       OR v_txn.producer_commission_amount <= 0
       OR v_txn.producer_payment_status <> 'ready'
       OR v_txn.payment_batch_id IS NOT NULL
       OR v_txn.archived_at IS NOT NULL
       OR v_txn.paid_date IS NOT NULL THEN
      RAISE EXCEPTION 'Transaction % is not eligible for a payment batch', COALESCE(v_txn.transaction_number, v_txn.id::text);
    END IF;
    IF v_txn.producer <> v_producer THEN
      RAISE EXCEPTION 'Selected producer does not match transaction % producer', COALESCE(v_txn.transaction_number, v_txn.id::text);
    END IF;
    v_gross := v_gross + v_txn.producer_commission_amount;
  END LOOP;

  v_gross := ROUND(v_gross, 2);
  v_available := v_gross;

  FOR v_rec IN
    SELECT r.id, ROUND(r.remaining_amount::numeric, 2) AS remaining_amount
    FROM public.producer_commission_recoveries r
    WHERE btrim(COALESCE(r.producer, '')) = v_producer
      AND r.agency_profile_id = v_agency
      AND r.status = 'open'
      AND r.remaining_amount > 0
      AND r.voided_at IS NULL
      AND COALESCE(r.settlement_method, 'next_payout') = 'next_payout'
    ORDER BY r.created_at ASC, r.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_available <= 0;
    v_take := ROUND(LEAST(v_rec.remaining_amount, v_available), 2);
    IF v_take <= 0 THEN CONTINUE; END IF;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object('recovery_id', v_rec.id, 'amount', v_take));
    v_available := ROUND(v_available - v_take, 2);
    v_recovery_applied := ROUND(v_recovery_applied + v_take, 2);
  END LOOP;

  v_net := ROUND(GREATEST(v_available, 0), 2);

  INSERT INTO public.producer_payment_batches (
    producer, status, gross_commission, net_payment, notes,
    payment_date, payment_method, payment_reference, agency_profile_id
  ) VALUES (
    v_producer, 'draft', v_gross, v_net, NULLIF(btrim(COALESCE(p_notes, '')), ''),
    NULL, NULL, NULL, v_agency
  )
  RETURNING id, batch_number INTO v_batch_id, v_batch_number;

  v_item_pool := v_recovery_applied;
  FOR v_txn IN
    SELECT t.id, ROUND(COALESCE(t.producer_commission_amount, 0)::numeric, 2) AS producer_commission_amount
    FROM public.transactions t
    WHERE t.id = ANY (p_transaction_ids)
    ORDER BY t.id
  LOOP
    v_item_take := ROUND(LEAST(v_txn.producer_commission_amount, GREATEST(v_item_pool, 0)), 2);
    v_item_net := ROUND(GREATEST(v_txn.producer_commission_amount - v_item_take, 0), 2);
    v_item_pool := ROUND(v_item_pool - v_item_take, 2);
    INSERT INTO public.producer_payment_batch_items (batch_id, transaction_id, net_amount, agency_profile_id)
    VALUES (v_batch_id, v_txn.id, v_item_net, v_agency);
  END LOOP;

  FOR v_plan_item IN SELECT value FROM jsonb_array_elements(v_plan)
  LOOP
    INSERT INTO public.producer_recovery_allocations (
      recovery_id, payment_batch_id, amount, created_by, agency_profile_id
    ) VALUES (
      (v_plan_item ->> 'recovery_id')::uuid, v_batch_id,
      ROUND((v_plan_item ->> 'amount')::numeric, 2), v_actor, v_agency
    );
    UPDATE public.producer_commission_recoveries r
    SET
      applied_amount = ROUND(r.applied_amount + ROUND((v_plan_item ->> 'amount')::numeric, 2), 2),
      remaining_amount = ROUND(r.remaining_amount - ROUND((v_plan_item ->> 'amount')::numeric, 2), 2),
      status = CASE
        WHEN ROUND(r.remaining_amount - ROUND((v_plan_item ->> 'amount')::numeric, 2), 2) > 0 THEN 'open'
        ELSE 'applied'
      END
    WHERE r.id = (v_plan_item ->> 'recovery_id')::uuid
      AND r.agency_profile_id = v_agency;
  END LOOP;

  UPDATE public.transactions t
  SET payment_batch_id = v_batch_id
  WHERE t.id = ANY (p_transaction_ids)
    AND t.agency_profile_id = v_agency
    AND t.producer_payment_status = 'ready'
    AND t.agency_commission_confirmed = true
    AND lower(COALESCE(t.review_status, '')) = 'approved'
    AND t.payment_batch_id IS NULL
    AND t.archived_at IS NULL
    AND t.paid_date IS NULL
    AND COALESCE(t.producer_commission_amount, 0) > 0
    AND btrim(COALESCE(t.producer, '')) = v_producer;

  SELECT COUNT(*)::integer INTO v_linked_count
  FROM public.transactions WHERE payment_batch_id = v_batch_id;
  IF v_linked_count <> cardinality(p_transaction_ids) THEN
    RAISE EXCEPTION 'Payment batch link race: one or more transactions are no longer eligible';
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id, 'batch_number', v_batch_number,
    'gross_commission', v_gross, 'recovery_applied', v_recovery_applied, 'net_payment', v_net
  );
END;
$$;

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

COMMENT ON FUNCTION public.create_producer_payment_batch_with_recoveries(text, uuid[], text) IS
  'Phase 3C: Owner/Admin, same-agency only. Does not mark paid.';
COMMENT ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) IS
  'Phase 3C: Owner/Admin, same-agency only. Does not move money.';

