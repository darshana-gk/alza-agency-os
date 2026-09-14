-- Allow Edge Functions (service_role) to persist Razorpay webhook receipts.
-- billing_webhook_events is insert-before-mirror; missing INSERT blocked all activations.
-- RLS stays on. No customer-facing write policies. authenticated/anon do not gain DML.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_webhook_events TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.billing_webhook_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.billing_webhook_events FROM anon;

DO $$
BEGIN
  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.billing_webhook_events'::regclass
  ) THEN
    RAISE EXCEPTION 'RLS must remain enabled on public.billing_webhook_events';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.billing_webhook_events', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.billing_webhook_events', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.billing_webhook_events', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.billing_webhook_events', 'DELETE')
  THEN
    RAISE EXCEPTION 'service_role must have SELECT/INSERT/UPDATE/DELETE on billing_webhook_events';
  END IF;

  IF has_table_privilege('authenticated', 'public.billing_webhook_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.billing_webhook_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.billing_webhook_events', 'DELETE')
     OR has_table_privilege('anon', 'public.billing_webhook_events', 'INSERT')
     OR has_table_privilege('anon', 'public.billing_webhook_events', 'UPDATE')
     OR has_table_privilege('anon', 'public.billing_webhook_events', 'DELETE')
  THEN
    RAISE EXCEPTION 'authenticated/anon must not have direct write access to billing_webhook_events';
  END IF;
END $$;
