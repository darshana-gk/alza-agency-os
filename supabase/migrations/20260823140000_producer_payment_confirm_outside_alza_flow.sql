-- Producer Payment Batch V1 — additive confirm RPC, audit fields, planning-only payout schedule.
-- NOT applied by this change. Do not backfill historical confirmers.
--
-- Live-schema safety: producer_payment_batches / transactions payout DDL predates this repo.
-- This migration is ADDITIVE only:
--   * ADD COLUMN IF NOT EXISTS
--   * ADD CONSTRAINT IF NOT EXISTS
--   * CREATE OR REPLACE FUNCTION for a NEW RPC
-- It does NOT drop tables, rewrite historical payment_method values, change stored batch/tx
-- status enums, or fabricate confirmed_by / confirmed_at / payment_channel on legacy paid rows.
--
-- CRITICAL CREATE-BATCH RULE (unchanged; this file does not replace create RPC):
-- create_producer_payment_batch_with_recoveries MUST continue to:
--   create batch as draft
--   link eligible transactions
--   leave transactions ready
--   leave paid_date NULL
--   NEVER mark producer commissions paid
--
-- Confirm paid is the ONLY path that marks paid, and it runs in ONE Postgres transaction.

-- ---------------------------------------------------------------------------
-- 1) Planning-only producer payout schedule on agency_profile
--    Informational only. MUST NEVER create batches, mark ready/paid, confirm, or move money.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agency_profile
  ADD COLUMN IF NOT EXISTS producer_payout_schedule text;

ALTER TABLE public.agency_profile
  ADD COLUMN IF NOT EXISTS producer_payout_schedule_notes text;

ALTER TABLE public.agency_profile
  ADD COLUMN IF NOT EXISTS producer_payout_anchor_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agency_profile_producer_payout_schedule_check'
  ) THEN
    ALTER TABLE public.agency_profile
      ADD CONSTRAINT agency_profile_producer_payout_schedule_check
      CHECK (
        producer_payout_schedule IS NULL
        OR producer_payout_schedule = ANY (
          ARRAY[
            'weekly'::text,
            'biweekly'::text,
            'semi_monthly'::text,
            'monthly'::text,
            'custom'::text
          ]
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.agency_profile.producer_payout_schedule IS
  'Planning-only producer payout cadence. Never creates batches or marks transactions ready/paid.';
COMMENT ON COLUMN public.agency_profile.producer_payout_schedule_notes IS
  'Human-readable custom schedule / rule / notes. Planning only.';
COMMENT ON COLUMN public.agency_profile.producer_payout_anchor_date IS
  'Anchor date for weekly/biweekly/monthly next-planned-payout calculation. Planning only.';

-- ---------------------------------------------------------------------------
-- 2) Durable confirmation audit fields on producer_payment_batches
--    Nullable: historical paid batches are NOT backfilled with an unknown confirmer.
--
-- confirmed_by compatibility (production may already have a legacy TEXT column):
--   A. missing        → ADD COLUMN confirmed_by uuid
--   B. already uuid   → leave unchanged (do not ALTER TYPE)
--   C. legacy text    → validate, then ALTER TYPE uuid
-- FK to public.users(id) is added only after the column is uuid, and only if a
-- matching FK is not already present. Unrelated constraints are never dropped.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_typname text;
  v_bad record;
BEGIN
  SELECT t.typname
  INTO v_typname
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  WHERE n.nspname = 'public'
    AND c.relname = 'producer_payment_batches'
    AND c.relkind = 'r'
    AND a.attname = 'confirmed_by'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_typname IS NULL THEN
    ALTER TABLE public.producer_payment_batches
      ADD COLUMN confirmed_by uuid;
  ELSIF v_typname = 'uuid' THEN
    NULL;
  ELSIF v_typname IN ('text', 'varchar', 'bpchar', 'citext') THEN
    FOR v_bad IN
      SELECT b.id, b.confirmed_by::text AS raw_value
      FROM public.producer_payment_batches b
      WHERE b.confirmed_by IS NOT NULL
        AND NULLIF(btrim(b.confirmed_by::text), '') IS NOT NULL
    LOOP
      BEGIN
        PERFORM btrim(v_bad.raw_value)::uuid;
      EXCEPTION
        WHEN invalid_text_representation OR data_exception THEN
          RAISE EXCEPTION
            'producer_payment_batches.confirmed_by contains a non-null value that is not a valid UUID (id=%). Conversion aborted; the value was not discarded or rewritten.',
            v_bad.id;
      END;
    END LOOP;

    ALTER TABLE public.producer_payment_batches
      ALTER COLUMN confirmed_by TYPE uuid
      USING NULLIF(btrim(confirmed_by::text), '')::uuid;
  ELSE
    RAISE EXCEPTION
      'producer_payment_batches.confirmed_by has unsupported type %. Expected uuid or text.',
      v_typname;
  END IF;
END $$;

ALTER TABLE public.producer_payment_batches
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.producer_payment_batches
  ADD COLUMN IF NOT EXISTS payment_channel text;

DO $$
DECLARE
  v_is_uuid boolean;
  v_named_fk boolean;
  v_matching_fk boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = 'public'
      AND c.relname = 'producer_payment_batches'
      AND c.relkind = 'r'
      AND a.attname = 'confirmed_by'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND t.typname = 'uuid'
  ) INTO v_is_uuid;

  IF NOT v_is_uuid THEN
    RAISE EXCEPTION
      'producer_payment_batches.confirmed_by must be uuid before adding FK to public.users(id)';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class rel ON rel.oid = c.conrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'producer_payment_batches'
      AND c.conname = 'producer_payment_batches_confirmed_by_fkey'
  ) INTO v_named_fk;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class rel ON rel.oid = c.conrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_catalog.pg_attribute src
      ON src.attrelid = c.conrelid AND src.attnum = ANY (c.conkey)
    JOIN pg_catalog.pg_attribute dst
      ON dst.attrelid = c.confrelid AND dst.attnum = ANY (c.confkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'producer_payment_batches'
      AND c.contype = 'f'
      AND src.attname = 'confirmed_by'
      AND c.confrelid = 'public.users'::regclass
      AND dst.attname = 'id'
  ) INTO v_matching_fk;

  IF NOT v_named_fk AND NOT v_matching_fk THEN
    ALTER TABLE public.producer_payment_batches
      ADD CONSTRAINT producer_payment_batches_confirmed_by_fkey
      FOREIGN KEY (confirmed_by) REFERENCES public.users (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'producer_payment_batches_payment_channel_check'
  ) THEN
    ALTER TABLE public.producer_payment_batches
      ADD CONSTRAINT producer_payment_batches_payment_channel_check
      CHECK (
        payment_channel IS NULL
        OR payment_channel = ANY (
          ARRAY[
            'outside_alza_flow'::text,
            'alza_flow_pay'::text
          ]
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.producer_payment_batches.confirmed_by IS
  'App user (public.users.id) who confirmed payment. Set by RPC from auth.uid(); never from the browser.';
COMMENT ON COLUMN public.producer_payment_batches.confirmed_at IS
  'Server/database timestamp when confirmation committed. Never from browser time.';
COMMENT ON COLUMN public.producer_payment_batches.payment_channel IS
  'outside_alza_flow = recorded after an external payment. alza_flow_pay reserved for future money movement (not implemented). NULL = legacy paid batch.';

-- ---------------------------------------------------------------------------
-- 3) Atomic Confirm Paid Outside ALZA Flow
-- ---------------------------------------------------------------------------
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
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_batch record;
  v_item_count integer;
  v_updated_count integer;
  v_method text;
  v_ref text;
  v_notes text;
  v_items_net numeric(14, 2);
  v_confirmed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Owner/Admin via primary users.role OR additive user_roles
  IF NOT (
    public.current_user_has_role('owner')
    OR public.current_user_has_role('admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized to confirm producer payments';
  END IF;

  SELECT u.id
  INTO v_actor
  FROM public.users u
  WHERE u.auth_user_id = v_uid
    AND u.archived_at IS NULL
    AND lower(COALESCE(u.status, 'active')) = 'active'
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authorized to confirm producer payments';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Payment batch is required';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  v_method := lower(btrim(COALESCE(p_payment_method, '')));
  IF v_method NOT IN ('ach', 'check', 'zelle', 'wire', 'cash', 'other') THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  v_ref := NULLIF(btrim(COALESCE(p_payment_reference, '')), '');
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  -- Serialize concurrent confirmation of the same batch
  SELECT
    b.id,
    b.batch_number,
    b.producer,
    b.status,
    b.gross_commission,
    b.net_payment,
    b.notes,
    b.voided_at
  INTO v_batch
  FROM public.producer_payment_batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch not found';
  END IF;

  IF lower(COALESCE(v_batch.status, '')) <> 'draft' OR v_batch.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment batch is not confirmable or has already been confirmed';
  END IF;

  IF COALESCE(v_batch.net_payment, 0) < 0 THEN
    RAISE EXCEPTION 'Payment batch net_payment must be >= 0';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_item_count
  FROM public.producer_payment_batch_items i
  WHERE i.batch_id = p_batch_id;

  IF v_item_count < 1 THEN
    RAISE EXCEPTION 'Payment batch has no linked transactions';
  END IF;

  -- Lock linked transactions in stable id order (deadlock-safe)
  PERFORM 1
  FROM public.transactions t
  JOIN public.producer_payment_batch_items i ON i.transaction_id = t.id
  WHERE i.batch_id = p_batch_id
  ORDER BY t.id
  FOR UPDATE OF t;

  IF EXISTS (
    SELECT 1
    FROM public.producer_payment_batch_items i
    WHERE i.batch_id = p_batch_id
      AND (
        i.transaction_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = i.transaction_id)
      )
  ) THEN
    RAISE EXCEPTION 'One or more batch items are missing a linked transaction';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.producer_payment_batch_items i
    JOIN public.transactions t ON t.id = i.transaction_id
    WHERE i.batch_id = p_batch_id
      AND (
        t.payment_batch_id IS DISTINCT FROM p_batch_id
        OR lower(COALESCE(t.producer_payment_status, '')) <> 'ready'
        OR t.paid_date IS NOT NULL
        OR t.archived_at IS NOT NULL
        OR btrim(COALESCE(t.producer, '')) IS DISTINCT FROM btrim(COALESCE(v_batch.producer, ''))
        OR COALESCE(i.net_amount, -1) < 0
      )
  ) THEN
    RAISE EXCEPTION
      'One or more linked transactions are not eligible for payment confirmation (must be ready, linked to this batch, unpaid, and match batch producer)';
  END IF;

  SELECT ROUND(COALESCE(SUM(i.net_amount), 0)::numeric, 2)
  INTO v_items_net
  FROM public.producer_payment_batch_items i
  WHERE i.batch_id = p_batch_id;

  IF abs(v_items_net - ROUND(COALESCE(v_batch.net_payment, 0)::numeric, 2)) > 0.009 THEN
    RAISE EXCEPTION 'Batch item net totals do not match batch net_payment';
  END IF;

  v_confirmed_at := now();

  -- Duplicate/concurrent confirmation: only a still-draft unvoided row updates.
  UPDATE public.producer_payment_batches b
  SET
    status = 'paid',
    payment_date = p_payment_date,
    payment_method = v_method,
    payment_reference = v_ref,
    notes = COALESCE(v_notes, b.notes),
    confirmed_by = v_actor,
    confirmed_at = v_confirmed_at,
    payment_channel = 'outside_alza_flow'
  WHERE b.id = p_batch_id
    AND lower(COALESCE(b.status, '')) = 'draft'
    AND b.voided_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Payment batch was not updated. It may no longer be draft, or it may have been voided concurrently.';
  END IF;

  UPDATE public.transactions t
  SET
    producer_payment_status = 'paid',
    paid_amount = ROUND(COALESCE(i.net_amount, 0)::numeric, 2),
    paid_date = p_payment_date,
    payment_method = v_method,
    payment_reference = v_ref
  FROM public.producer_payment_batch_items i
  WHERE i.batch_id = p_batch_id
    AND t.id = i.transaction_id
    AND t.payment_batch_id = p_batch_id
    AND lower(COALESCE(t.producer_payment_status, '')) = 'ready'
    AND t.paid_date IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_item_count THEN
    RAISE EXCEPTION
      'Linked transaction update mismatch (% of %). Rolling back to prevent a partial-paid batch.',
      v_updated_count,
      v_item_count;
  END IF;

  -- Confirm does NOT touch producer_commission_recoveries (consumed at batch create).

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'batch_number', v_batch.batch_number,
    'producer', v_batch.producer,
    'status', 'paid',
    'payment_date', p_payment_date,
    'payment_method', v_method,
    'payment_reference', v_ref,
    'notes', COALESCE(v_notes, v_batch.notes),
    'gross_commission', v_batch.gross_commission,
    'net_payment', v_batch.net_payment,
    'recovery_applied', ROUND(
      GREATEST(COALESCE(v_batch.gross_commission, 0) - COALESCE(v_batch.net_payment, 0), 0),
      2
    ),
    'transaction_count', v_updated_count,
    'confirmed_by', v_actor,
    'confirmed_at', v_confirmed_at,
    'payment_channel', 'outside_alza_flow'
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) IS
  'Atomically confirms a draft producer payment batch as paid outside ALZA Flow. Owner/Admin only. Rolls back entirely on any failure. Does not move money. Does not touch recoveries.';

REVOKE ALL ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_producer_paid_outside_alza_flow(uuid, date, text, text, text) TO service_role;
