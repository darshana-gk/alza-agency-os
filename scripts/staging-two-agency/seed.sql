-- STAGING TWO-AGENCY VALIDATION ONLY
-- Seeds persistent Agency B (2AG-B-*) after auth users exist.
-- NOT a Production migration. Idempotent. Does not delete Agency A.

DO $$
DECLARE
  v_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  v_today date := CURRENT_DATE;
  v_owner uuid;
  v_admin uuid;
  v_csr uuid;
  v_producer uuid;
  v_viewer uuid;
  v_unlinked uuid;
  v_inactive uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') THEN
    RAISE EXCEPTION 'two-agency seed abort: agency_profile_singleton still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_profile WHERE id = v_a) THEN
    RAISE EXCEPTION 'two-agency seed abort: Agency A missing';
  END IF;

  SELECT au.id INTO v_owner FROM auth.users au WHERE lower(au.email) = 'owner.2ag.b@example.invalid';
  SELECT au.id INTO v_admin FROM auth.users au WHERE lower(au.email) = 'admin.2ag.b@example.invalid';
  SELECT au.id INTO v_csr FROM auth.users au WHERE lower(au.email) = 'csr.2ag.b@example.invalid';
  SELECT au.id INTO v_producer FROM auth.users au WHERE lower(au.email) = 'producer.2ag.b@example.invalid';
  SELECT au.id INTO v_viewer FROM auth.users au WHERE lower(au.email) = 'viewer.2ag.b@example.invalid';
  SELECT au.id INTO v_unlinked FROM auth.users au WHERE lower(au.email) = 'producer.2ag.b.unlinked@example.invalid';
  SELECT au.id INTO v_inactive FROM auth.users au WHERE lower(au.email) = 'inactive.2ag.b@example.invalid';

  IF v_owner IS NULL OR v_admin IS NULL OR v_csr IS NULL OR v_producer IS NULL
     OR v_viewer IS NULL OR v_unlinked IS NULL OR v_inactive IS NULL THEN
    RAISE EXCEPTION 'two-agency seed abort: missing Agency B auth users';
  END IF;

  INSERT INTO public.agency_profile (id, agency_name, email, singleton_key)
  VALUES (v_b, '2AG-B Staging Agency', 'owner.2ag.b@example.invalid', true)
  ON CONFLICT (id) DO UPDATE
    SET agency_name = EXCLUDED.agency_name,
        email = EXCLUDED.email;

  INSERT INTO public.carriers (id, carrier_name, status, agency_profile_id)
  VALUES ('b1000000-0000-4000-8000-0000000000b1', 'DUMMY Tenant1 Carrier', 'active', v_b)
  ON CONFLICT (id) DO UPDATE SET carrier_name = EXCLUDED.carrier_name, agency_profile_id = v_b;

  INSERT INTO public.mgas (id, mga_name, status, agency_profile_id)
  VALUES ('b2000000-0000-4000-8000-0000000000b2', 'DUMMY Tenant1 MGA', 'active', v_b)
  ON CONFLICT (id) DO UPDATE SET mga_name = EXCLUDED.mga_name, agency_profile_id = v_b;

  INSERT INTO public.producers (id, producer_name, email, agency_profile_id)
  VALUES (
    'b3000000-0000-4000-8000-0000000000b3',
    'DUMMY Payout V1 Producer',
    'producer.2ag.b@example.invalid',
    v_b
  )
  ON CONFLICT (id) DO UPDATE SET producer_name = EXCLUDED.producer_name, agency_profile_id = v_b;

  INSERT INTO public.csrs (id, csr_name, email, status, agency_profile_id)
  VALUES (
    'b4000000-0000-4000-8000-0000000000b4',
    'DUMMY Tenant1 CSR',
    'csr.2ag.b@example.invalid',
    'active',
    v_b
  )
  ON CONFLICT (id) DO UPDATE SET csr_name = EXCLUDED.csr_name, agency_profile_id = v_b;

  -- public.users: id = auth uid (auth_user_id unique)
  INSERT INTO public.users (
    id, auth_user_id, email, full_name, role, status, agency_profile_id, producer_id, invite_status
  )
  VALUES
    (v_owner, v_owner, 'owner.2ag.b@example.invalid', '2AG-B Owner', 'owner', 'active', v_b, NULL, 'accepted'),
    (v_admin, v_admin, 'admin.2ag.b@example.invalid', '2AG-B Admin', 'admin', 'active', v_b, NULL, 'accepted'),
    (v_csr, v_csr, 'csr.2ag.b@example.invalid', '2AG-B CSR', 'csr', 'active', v_b, NULL, 'accepted'),
    (v_producer, v_producer, 'producer.2ag.b@example.invalid', '2AG-B Producer', 'producer', 'active', v_b, 'b3000000-0000-4000-8000-0000000000b3', 'accepted'),
    (v_viewer, v_viewer, 'viewer.2ag.b@example.invalid', '2AG-B Viewer', 'viewer', 'active', v_b, NULL, 'accepted'),
    (v_unlinked, v_unlinked, 'producer.2ag.b.unlinked@example.invalid', '2AG-B Unlinked Producer', 'producer', 'active', v_b, NULL, 'accepted'),
    (v_inactive, v_inactive, 'inactive.2ag.b@example.invalid', '2AG-B Inactive Viewer', 'viewer', 'inactive', v_b, NULL, 'accepted')
  ON CONFLICT (id) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        agency_profile_id = EXCLUDED.agency_profile_id,
        producer_id = EXCLUDED.producer_id,
        invite_status = EXCLUDED.invite_status,
        archived_at = NULL;

  INSERT INTO public.user_roles (user_id, role)
  SELECT x.user_id, x.role
  FROM (VALUES
    (v_owner, 'owner'),
    (v_admin, 'admin'),
    (v_csr, 'csr'),
    (v_producer, 'producer'),
    (v_viewer, 'viewer'),
    (v_unlinked, 'producer'),
    (v_inactive, 'viewer')
  ) AS x(user_id, role)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = x.user_id AND lower(ur.role) = x.role
  );

  INSERT INTO public.clients (
    id, business_name, producer, csr, status, client_number, agency_profile_id
  )
  VALUES (
    'b5000000-0000-4000-8000-0000000000b5',
    '2AG-B Client LLC',
    'DUMMY Payout V1 Producer',
    'DUMMY Tenant1 CSR',
    'active',
    '2AG-B-CLT-0001',
    v_b
  )
  ON CONFLICT (id) DO UPDATE
    SET business_name = EXCLUDED.business_name, agency_profile_id = v_b;

  INSERT INTO public.policies (
    id, client_id, policy_type, policy_number, carrier, mga, producer, csr,
    status, commission_type, broker_fee, agency_commission_percentage,
    agency_commission_amount, producer_split_percentage, producer_commission_amount,
    agency_net_commission, premium, agency_profile_id
  )
  VALUES
    (
      'b6000000-0000-4000-8000-0000000000b6',
      'b5000000-0000-4000-8000-0000000000b5',
      'general', 'POL-STAGING-0001', 'DUMMY Tenant1 Carrier', 'DUMMY Tenant1 MGA',
      'DUMMY Payout V1 Producer', 'DUMMY Tenant1 CSR', 'Active', 'percentage', 0,
      10, 12.34, 50, 6.17, 6.17, 100, v_b
    ),
    (
      'b6100000-0000-4000-8000-000000000061',
      'b5000000-0000-4000-8000-0000000000b5',
      'general', '2AG-B-POL-0001', 'DUMMY Tenant1 Carrier', 'DUMMY Tenant1 MGA',
      'DUMMY Payout V1 Producer', 'DUMMY Tenant1 CSR', 'Active', 'percentage', 0,
      10, 20, 50, 10, 10, 200, v_b
    )
  ON CONFLICT (id) DO UPDATE
    SET policy_number = EXCLUDED.policy_number, agency_profile_id = v_b;

  INSERT INTO public.transactions (
    id, transaction_number, transaction_type, transaction_date, producer,
    producer_commission_amount, agency_commission_confirmed, review_status,
    producer_payment_status, client_id, policy_id, premium_amount,
    agency_commission_amount, agency_profile_id, csr_user_id
  )
  VALUES
    (
      'b7000000-0000-4000-8000-0000000000b7',
      '2AG-B-TRX-MATCH', 'new_policy_premium', v_today, 'DUMMY Payout V1 Producer',
      6.17, false, 'expected', 'not_ready',
      'b5000000-0000-4000-8000-0000000000b5', 'b6000000-0000-4000-8000-0000000000b6',
      100, 12.34, v_b, v_csr
    ),
    (
      'b7100000-0000-4000-8000-000000000071',
      '2AG-B-TRX-RECEIPT', 'new_policy_premium', v_today, 'DUMMY Payout V1 Producer',
      10, true, 'expected', 'not_ready',
      'b5000000-0000-4000-8000-0000000000b5', 'b6100000-0000-4000-8000-000000000061',
      200, 20, v_b, v_csr
    ),
    (
      'b7200000-0000-4000-8000-000000000072',
      '2AG-B-TRX-VOIDED', 'new_policy_premium', v_today, 'DUMMY Payout V1 Producer',
      1, false, 'expected', 'not_ready',
      'b5000000-0000-4000-8000-0000000000b5', 'b6100000-0000-4000-8000-000000000061',
      99999, 1, v_b, NULL
    ),
    (
      'b7300000-0000-4000-8000-000000000073',
      'DUMMY-PAYOUT-V1-G1', 'new_policy_premium', v_today, 'DUMMY Payout V1 Producer',
      5, false, 'expected', 'not_ready',
      'b5000000-0000-4000-8000-0000000000b5', 'b6100000-0000-4000-8000-000000000061',
      50, 5, v_b, NULL
    )
  ON CONFLICT (id) DO UPDATE
    SET agency_profile_id = v_b,
        producer = EXCLUDED.producer,
        premium_amount = EXCLUDED.premium_amount;

  UPDATE public.transactions
  SET voided_at = COALESCE(voided_at, now()),
      void_reason = COALESCE(void_reason, '2AG-B voided KPI fixture')
  WHERE id = 'b7200000-0000-4000-8000-000000000072';

  INSERT INTO public.agency_commission_receipts (
    id, source, client_id, policy_id, transaction_id, matched_transaction_id,
    producer, settlement_date, imported_at, reconciliation_status, match_confidence,
    agency_profile_id
  )
  VALUES (
    'b8000000-0000-4000-8000-0000000000b8',
    'manual',
    'b5000000-0000-4000-8000-0000000000b5',
    'b6100000-0000-4000-8000-000000000061',
    'b7100000-0000-4000-8000-000000000071',
    'b7100000-0000-4000-8000-000000000071',
    'DUMMY Payout V1 Producer',
    v_today, now(), 'matched', 'none', v_b
  )
  ON CONFLICT (id) DO UPDATE SET agency_profile_id = v_b;

  UPDATE public.transactions
  SET agency_commission_receipt_id = 'b8000000-0000-4000-8000-0000000000b8',
      agency_commission_confirmed = true,
      amount_received = 20,
      received_date = v_today
  WHERE id = 'b7100000-0000-4000-8000-000000000071';

  INSERT INTO public.producer_commission_recoveries (
    id, recovery_number, transaction_id, producer, amount, applied_amount,
    remaining_amount, status, recovery_date, agency_profile_id, client_id, policy_id
  )
  VALUES (
    'b8100000-0000-4000-8000-000000000081',
    'RCV-2026-000001',
    'b7100000-0000-4000-8000-000000000071',
    'DUMMY Payout V1 Producer',
    1, 0, 1, 'open', v_today, v_b,
    'b5000000-0000-4000-8000-0000000000b5',
    'b6100000-0000-4000-8000-000000000061'
  )
  ON CONFLICT (id) DO UPDATE SET agency_profile_id = v_b;

  INSERT INTO public.reconciliation_statements (
    id, agency_profile_id, carrier, mga, statement_date, period_start, period_end,
    file_name, file_hash, row_count, status, detect_missing
  )
  VALUES (
    'b9000000-0000-4000-8000-0000000000b9',
    v_b,
    'DUMMY Tenant1 Carrier',
    'DUMMY Tenant1 MGA',
    v_today, v_today, v_today,
    '2AG-B-statement.csv',
    '2ag-b-stmt-hash-v1',
    1, 'staged', true
  )
  ON CONFLICT (id) DO UPDATE SET agency_profile_id = v_b, status = 'staged';

  INSERT INTO public.reconciliation_statement_rows (
    id, statement_id, row_source, row_index, policy_number, client_name,
    commission_amount, premium_amount, transaction_date, transaction_type,
    carrier_name, mga_name, match_status, agency_profile_id
  )
  VALUES (
    'ba000000-0000-4000-8000-0000000000ba',
    'b9000000-0000-4000-8000-0000000000b9',
    'import', 1, 'POL-STAGING-0001', '2AG-B Client LLC',
    12.34, 100, v_today, 'new_policy_premium',
    'DUMMY Tenant1 Carrier', 'DUMMY Tenant1 MGA', 'pending', v_b
  )
  ON CONFLICT (id) DO UPDATE
    SET match_status = 'pending',
        matched_transaction_id = NULL,
        agency_profile_id = v_b;

  INSERT INTO public.support_conversations (
    id, agency_profile_id, created_by_user_id, category, subject, status, priority
  )
  VALUES (
    'bb000000-0000-4000-8000-0000000000bb',
    v_b, v_owner, 'other', '2AG-B-support-seed', 'waiting_on_alza', 'normal'
  )
  ON CONFLICT (id) DO UPDATE SET agency_profile_id = v_b, subject = EXCLUDED.subject;

  -- support_messages require an authenticated app user (JWT trigger). Seeded via the
  -- two-agency JWT harness after Agency B Owner signs in.

  INSERT INTO public.billing_subscriptions (
    id, agency_profile_id, status, plan_key, cancel_at_period_end
  )
  VALUES (
    'bc000000-0000-4000-8000-0000000000bc',
    v_b, 'created', 'essential', false
  )
  ON CONFLICT (id) DO UPDATE SET agency_profile_id = v_b;
END $$;

SELECT jsonb_build_object(
  'agency_n', (SELECT COUNT(*) FROM public.agency_profile),
  'singleton', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton'),
  'b_users', (SELECT COUNT(*) FROM public.users WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_clients', (SELECT COUNT(*) FROM public.clients WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_policies', (SELECT COUNT(*) FROM public.policies WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_txns', (SELECT COUNT(*) FROM public.transactions WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_receipts', (SELECT COUNT(*) FROM public.agency_commission_receipts WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_recon', (SELECT COUNT(*) FROM public.reconciliation_statements WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_tickets', (SELECT COUNT(*) FROM public.support_conversations WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'b_billing', (SELECT COUNT(*) FROM public.billing_subscriptions WHERE agency_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  'a_txns', (SELECT COUNT(*) FROM public.transactions WHERE agency_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'a_clients', (SELECT COUNT(*) FROM public.clients WHERE agency_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
) AS two_agency_seed;
