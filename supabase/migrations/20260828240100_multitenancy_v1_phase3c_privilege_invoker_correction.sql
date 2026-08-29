-- ALZA Flow Multi-Tenancy V1 — Phase 3C correction
-- enforce_transaction_privilege must be SECURITY INVOKER, not SECURITY DEFINER.
--
-- Staging uzckhxpqnipnovplohpf already applied 20260828240000 with SECURITY DEFINER
-- (current_user = postgres inside the trigger → JWT direct UPDATE bypassed the guard).
-- This file replaces enforce_transaction_privilege() only. No RLS, no 3D–3E, no grants.
-- Fresh deployments get the same body from 20260828240000 (patched) then this no-op CREATE OR REPLACE.

DO $$
BEGIN
  IF to_regproc('public.enforce_transaction_privilege') IS NULL THEN
    RAISE EXCEPTION 'Phase 3C privilege correction abort: enforce_transaction_privilege missing (apply 3C first)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'Phase 3C privilege correction abort: singleton missing';
  END IF;
  IF (SELECT COUNT(*) FROM public.agency_profile) <> 1 THEN
    RAISE EXCEPTION 'Phase 3C privilege correction abort: expected exactly 1 agency_profile';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_transaction_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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

COMMENT ON FUNCTION public.enforce_transaction_privilege() IS
  'Phase 3C: SECURITY INVOKER trigger. authenticated/service_role direct UPDATE of workflow/payment/void/receipt columns is rejected. SECURITY DEFINER workflow RPCs (current_user postgres) may patch those columns.';

ALTER FUNCTION public.enforce_transaction_privilege() SET search_path TO 'public';
