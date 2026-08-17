-- Expand producer payment method CHECK to the full Confirm Producer Paid list.
-- Additive only: does not rewrite historical payment_method values.
-- Also widen transactions.payment_method so Confirm Paid can persist the same value
-- on linked transactions (keeps legacy 'manual').

ALTER TABLE public.producer_payment_batches
  DROP CONSTRAINT IF EXISTS producer_payment_batches_payment_method_check;

ALTER TABLE public.producer_payment_batches
  ADD CONSTRAINT producer_payment_batches_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method = ANY (
      ARRAY[
        'ach'::text,
        'check'::text,
        'wire'::text,
        'zelle'::text,
        'venmo'::text,
        'paypal'::text,
        'cash'::text,
        'other'::text
      ]
    )
  );

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_payment_method_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method = ANY (
      ARRAY[
        'ach'::text,
        'check'::text,
        'wire'::text,
        'manual'::text,
        'cash'::text,
        'other'::text,
        'zelle'::text,
        'venmo'::text,
        'paypal'::text
      ]
    )
  );
