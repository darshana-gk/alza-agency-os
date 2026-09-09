-- Transaction policy snapshot immutability.
-- Does not UPDATE historical rows. Does not backfill. Does not change money, RLS, or matching.
--
-- Ordinary authenticated/anon/service_role UPDATE cannot change:
--   transactions.policy_number
--   transactions.policy_effective_date
--   transactions.policy_expiration_date
-- INSERT is unchanged. Unrelated transaction columns are unchanged.
--
-- Owner/Admin may fill NULL snapshot fields only through
-- public.apply_null_transaction_policy_snapshot (SECURITY DEFINER, owner postgres).

CREATE OR REPLACE FUNCTION public.enforce_transaction_policy_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.policy_number IS NOT DISTINCT FROM OLD.policy_number
     AND NEW.policy_effective_date IS NOT DISTINCT FROM OLD.policy_effective_date
     AND NEW.policy_expiration_date IS NOT DISTINCT FROM OLD.policy_expiration_date
  THEN
    RETURN NEW;
  END IF;

  -- postgres (SECURITY DEFINER repair/freeze) may write. Clients may not.
  IF current_user IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION
      'transaction policy snapshots are immutable after insert';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_transaction_policy_snapshot_immutable() IS
  'Rejects client UPDATE of create-time policy snapshot columns. SECURITY DEFINER repair runs as postgres and is allowed.';

ALTER FUNCTION public.enforce_transaction_policy_snapshot_immutable() SET search_path TO 'public';

DROP TRIGGER IF EXISTS aad_enforce_transaction_policy_snapshot ON public.transactions;
CREATE TRIGGER aad_enforce_transaction_policy_snapshot
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_transaction_policy_snapshot_immutable();

CREATE OR REPLACE FUNCTION public.apply_null_transaction_policy_snapshot(
  p_transaction_id uuid,
  p_policy_number text DEFAULT NULL,
  p_policy_effective_date date DEFAULT NULL,
  p_policy_expiration_date date DEFAULT NULL
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
  v_row public.transactions%ROWTYPE;
  v_number text;
  v_eff date;
  v_exp date;
  v_next_number text;
  v_next_eff date;
  v_next_exp date;
  v_changed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT (
    public.current_user_has_role('owner')
    OR public.current_user_has_role('admin')
  ) THEN
    RAISE EXCEPTION 'Only Owner/Admin can repair historical policy snapshots';
  END IF;

  v_actor := public.multitenancy_require_active_actor();
  v_agency := public.current_user_agency_profile_id();
  IF v_actor IS NULL OR v_agency IS NULL THEN
    RAISE EXCEPTION 'Only Owner/Admin can repair historical policy snapshots';
  END IF;

  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'Transaction is required';
  END IF;

  SELECT * INTO v_row
  FROM public.transactions t
  WHERE t.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_row.agency_profile_id IS DISTINCT FROM v_agency THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived transactions cannot be repaired';
  END IF;

  v_number := NULLIF(btrim(COALESCE(p_policy_number, '')), '');
  v_eff := p_policy_effective_date;
  v_exp := p_policy_expiration_date;

  v_next_number := v_row.policy_number;
  v_next_eff := v_row.policy_effective_date;
  v_next_exp := v_row.policy_expiration_date;

  IF v_number IS NOT NULL THEN
    IF v_row.policy_number IS NULL OR btrim(v_row.policy_number) = '' THEN
      v_next_number := v_number;
      v_changed := true;
    ELSIF btrim(v_row.policy_number) IS DISTINCT FROM v_number THEN
      RAISE EXCEPTION 'Stored policy number snapshot cannot be overwritten';
    END IF;
  END IF;

  IF v_eff IS NOT NULL THEN
    IF v_row.policy_effective_date IS NULL THEN
      v_next_eff := v_eff;
      v_changed := true;
    ELSIF v_row.policy_effective_date IS DISTINCT FROM v_eff THEN
      RAISE EXCEPTION 'Stored policy effective date snapshot cannot be overwritten';
    END IF;
  END IF;

  IF v_exp IS NOT NULL THEN
    IF v_row.policy_expiration_date IS NULL THEN
      v_next_exp := v_exp;
      v_changed := true;
    ELSIF v_row.policy_expiration_date IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION 'Stored policy expiration date snapshot cannot be overwritten';
    END IF;
  END IF;

  IF v_changed THEN
    UPDATE public.transactions
    SET
      policy_number = v_next_number,
      policy_effective_date = v_next_eff,
      policy_expiration_date = v_next_exp
    WHERE id = v_row.id
      AND agency_profile_id = v_agency;
  END IF;

  RETURN jsonb_build_object(
    'transaction_id', v_row.id,
    'changed', v_changed,
    'policy_number', v_next_number,
    'policy_effective_date', v_next_eff,
    'policy_expiration_date', v_next_exp
  );
END;
$$;

COMMENT ON FUNCTION public.apply_null_transaction_policy_snapshot(uuid, text, date, date) IS
  'Owner/Admin fill of NULL create-time policy snapshots only. Same value is idempotent. Never overwrites a stored snapshot. Does not change money or payment state.';

REVOKE ALL ON FUNCTION public.apply_null_transaction_policy_snapshot(uuid, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_null_transaction_policy_snapshot(uuid, text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.apply_null_transaction_policy_snapshot(uuid, text, date, date) FROM service_role;
GRANT EXECUTE ON FUNCTION public.apply_null_transaction_policy_snapshot(uuid, text, date, date) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260909130000', 'transaction_policy_snapshot_immutability')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
