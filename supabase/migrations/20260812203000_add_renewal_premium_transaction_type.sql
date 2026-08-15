-- ADD renewal_premium to transactions.transaction_type allowed values
-- Minimum schema change only. Does not modify existing rows.
--
-- REVIEW / APPLY when authorized.
--
-- Before (expected live CHECK, if present):
--   transaction_type IN (
--     'audit_premium',
--     'new_policy_premium',
--     'endorsement_premium',
--     'return_premium'
--   )
--   — OR equivalent four-value CHECK / no CHECK (text free-form)
--
-- After:
--   transaction_type IN (
--     'new_policy_premium',
--     'renewal_premium',
--     'endorsement_premium',
--     'audit_premium',
--     'return_premium'
--   )

DO $$
DECLARE
  con_name text;
  con_def text;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
  INTO con_name, con_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'transactions'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%transaction_type%'
  ORDER BY c.conname
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    RAISE NOTICE 'BEFORE transactions.transaction_type CHECK: % => %', con_name, con_def;

    IF con_def ILIKE '%renewal_premium%' THEN
      RAISE NOTICE 'renewal_premium already allowed — no schema change';
      RETURN;
    END IF;

    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', con_name);
  ELSE
    RAISE NOTICE 'BEFORE: no transaction_type CHECK found on public.transactions';
  END IF;

  -- Drop leftover standard name if present from a prior partial run
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
        'return_premium'
      )
    );

  RAISE NOTICE 'AFTER: transactions_transaction_type_check includes renewal_premium';
END $$;

COMMENT ON CONSTRAINT transactions_transaction_type_check ON public.transactions IS
  'Allowed transaction_type values including renewal_premium.';
