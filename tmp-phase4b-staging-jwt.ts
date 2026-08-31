/**
 * STAGING ONLY — Phase 4B frontend workflow RPC cutover validation.
 * Target: uzckhxpqnipnovplohpf. Aborts on production.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const TENANT1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const FORGED_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const OWNER_USER = '7c4aaf9a-86f3-4dc3-ab0e-5f794e8c0ae1'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const CREDS = {
  owner: { email: 'owner.payout.v1@example.invalid', password: PASSWORD },
  admin: { email: 'admin.role.payout.v1@example.invalid', password: PASSWORD },
  csr: { email: 'csr.payout.v1@example.invalid', password: PASSWORD },
  producer: { email: 'producer.payout.v1@example.invalid', password: PASSWORD },
  viewer: { email: 'viewer.payout.v1@example.invalid', password: PASSWORD },
  support: { email: 'alza.support.staging@example.invalid', password: 'StagingTest!SupportV1-2026' },
  inactive: { email: 'inactive.phase3.rls@example.invalid', password: PASSWORD },
}

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []
const fixtureTxnIds: string[] = []

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}

function readLinkedRef(): string {
  return readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim()
}

function loadKeys(): { url: string; anon: string } {
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, {
    encoding: 'utf8',
  })
  const raw = JSON.parse(json.replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon')) anon = key
  }
  if (!anon) throw new Error('missing staging anon key')
  const url = `https://${STAGING_REF}.supabase.co`
  if (url.includes(PRODUCTION_REF)) throw new Error('ABORT: production URL')
  return { url, anon }
}

function dbQuery(sql: string): { rows?: Array<Record<string, unknown>> } {
  const file = resolve('tmp-phase4b-staging-query.sql')
  writeFileSync(file, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${file}`, {
    encoding: 'utf8',
  })
  writeFileSync(resolve('tmp-phase4b-staging-query.out'), captured, 'utf8')
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON in db query output: ${captured.slice(0, 300)}`)
  return JSON.parse(captured.slice(start, end + 1)) as { rows?: Array<Record<string, unknown>> }
}

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c: SupabaseClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`signIn ${creds.email}: ${error.message}`)
  return c
}

async function trySignIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c: SupabaseClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await c.auth.signInWithPassword(creds)
  return { client: c, error: error?.message ?? null }
}

function errMsg(e: { message?: string } | null | undefined) {
  return e?.message ?? ''
}

async function seedTxn(client: SupabaseClient, suffix: string) {
  const seed = await client.from('clients').select('id').limit(1).single()
  const pol = await client
    .from('policies')
    .select('id, client_id')
    .eq('client_id', seed.data?.id)
    .limit(1)
    .maybeSingle()
  if (!seed.data?.id || !pol.data?.id) throw new Error('missing seed client/policy')

  const base = {
    client_id: seed.data.id,
    policy_id: pol.data.id,
    producer: `4B-${suffix}`,
    producer_commission_amount: 11,
    agency_commission_confirmed: false,
    review_status: 'expected',
    producer_payment_status: 'not_ready',
    premium_amount: 110,
    agency_commission_amount: 5.5,
    reviewer_user_id: OWNER_USER,
    transaction_type: 'new_policy_premium',
    transaction_date: new Date().toISOString().slice(0, 10),
  }
  const ins = await client.from('transactions').insert(base).select('id').single()
  if (ins.error || !ins.data?.id) throw new Error(`seed ${suffix}: ${errMsg(ins.error)}`)
  fixtureTxnIds.push(ins.data.id as string)
  return ins.data.id as string
}

async function confirmReceipt(client: SupabaseClient, txnId: string, tag: string) {
  return client.rpc('confirm_agency_commission_received', {
    p_transaction_id: txnId,
    p_amount_received: 5.5,
    p_received_date: new Date().toISOString().slice(0, 10),
    p_deposit_reference: `4B-${tag}`,
    p_external_invoice_id: null,
    p_notes: null,
    p_variance_acknowledged: false,
  })
}

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) throw new Error(`ABORT linked ${linked}`)
  const { url, anon } = loadKeys()

  const preRaw = dbQuery(`
SELECT jsonb_build_object(
  'agency_n', (SELECT COUNT(*) FROM public.agency_profile),
  'singleton', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton'),
  'agency_b', (SELECT COUNT(*) FROM public.agency_profile WHERE id = '${FORGED_B}'),
  'rls_n', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'),
  'rls_fp', (
    SELECT md5(coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname, ',' ORDER BY tablename, policyname), ''))
    FROM pg_policies WHERE schemaname = 'public'
  ),
  'finance', jsonb_build_object(
    'txn_prem', (SELECT coalesce(sum(premium_amount),0) FROM public.transactions),
    'txn_prod', (SELECT coalesce(sum(producer_commission_amount),0) FROM public.transactions),
    'txn_agy', (SELECT coalesce(sum(agency_commission_amount),0) FROM public.transactions),
    'rec_amt', (SELECT coalesce(sum(amount),0) FROM public.producer_commission_recoveries),
    'batch_net', (SELECT coalesce(sum(net_payment),0) FROM public.producer_payment_batches)
  )
) AS pre;
`)
  const pre = (preRaw.rows?.[0]?.pre ?? preRaw.rows?.[0]) as Record<string, unknown>
  console.log('PRE', JSON.stringify(pre))

  const owner = await signIn(url, anon, CREDS.owner)
  const admin = await signIn(url, anon, CREDS.admin)
  const csr = await signIn(url, anon, CREDS.csr)
  const producer = await signIn(url, anon, CREDS.producer)
  const viewer = await signIn(url, anon, CREDS.viewer)
  const support = await signIn(url, anon, CREDS.support)

  const inactive = await trySignIn(url, anon, CREDS.inactive)
  assert(
    'inactive_auth_blocked',
    Boolean(inactive.error),
    inactive.error ?? 'unexpected sign-in success',
  )

  // Raw privileged UPDATE blocked
  {
    const rawId = await seedTxn(owner, 'RAW')
    const rawUpd = await owner.from('transactions').update({ review_status: 'matched' }).eq('id', rawId).select('id')
    assert(
      'raw_review_update_blocked',
      Boolean(rawUpd.error) && /workflow RPC/i.test(rawUpd.error?.message ?? ''),
      rawUpd.error?.message ?? `updated n=${rawUpd.data?.length}`,
    )
  }

  // CSR happy path + negatives
  {
    const csrTxn = await seedTxn(csr, 'CSR')
    const draftEdit = await csr.from('transactions').update({ premium_amount: 111 }).eq('id', csrTxn).select('id')
    assert('csr_draft_edit', (draftEdit.data?.length ?? 0) === 1, errMsg(draftEdit.error) || `n=${draftEdit.data?.length}`)

    const confirm = await confirmReceipt(csr, csrTxn, 'CSR')
    const receiptId = (confirm.data as { receipt_id?: string })?.receipt_id
    assert('csr_confirm_receipt', !confirm.error && Boolean(receiptId), errMsg(confirm.error) || JSON.stringify(confirm.data))

    const dup = await confirmReceipt(csr, csrTxn, 'CSR-DUP')
    assert(
      'csr_confirm_duplicate_idempotent',
      !dup.error && (dup.data as { duplicate?: boolean })?.duplicate === true,
      errMsg(dup.error) || JSON.stringify(dup.data),
    )

    const submit = await csr.rpc('submit_transaction_for_review', { p_transaction_id: csrTxn })
    assert(
      'csr_submit',
      !submit.error && (submit.data as { review_status?: string })?.review_status === 'matched',
      errMsg(submit.error) || JSON.stringify(submit.data),
    )

    const csrApprove = await csr.rpc('approve_transaction_review', { p_transaction_id: csrTxn })
    assert(
      'csr_cannot_approve',
      Boolean(csrApprove.error) && /Not authorized to approve/i.test(errMsg(csrApprove.error)),
      errMsg(csrApprove.error) || 'not denied',
    )
    const csrReturn = await csr.rpc('return_transaction_for_correction', {
      p_transaction_id: csrTxn,
      p_reason: 'csr attempt',
    })
    assert(
      'csr_cannot_return',
      Boolean(csrReturn.error) && /Not authorized to return/i.test(errMsg(csrReturn.error)),
      errMsg(csrReturn.error) || 'not denied',
    )
    const csrReady = await csr.rpc('mark_producer_commission_ready', { p_transaction_id: csrTxn })
    assert(
      'csr_cannot_mark_ready',
      Boolean(csrReady.error) && /Not authorized to mark producer commission ready/i.test(errMsg(csrReady.error)),
      errMsg(csrReady.error) || 'not denied',
    )
    const csrVoid = await csr.rpc('void_transaction', { p_transaction_id: csrTxn, p_reason: 'csr void' })
    assert(
      'csr_cannot_void',
      Boolean(csrVoid.error) && /Not authorized to void/i.test(errMsg(csrVoid.error)),
      errMsg(csrVoid.error) || 'not denied',
    )
    const csrBatch = await csr.rpc('create_producer_payment_batch_with_recoveries', {
      p_producer: `4B-CSR`,
      p_transaction_ids: [csrTxn],
      p_notes: null,
    })
    assert(
      'csr_cannot_create_batch',
      Boolean(csrBatch.error),
      errMsg(csrBatch.error) || 'not denied',
    )

    const returned = await owner.rpc('return_transaction_for_correction', {
      p_transaction_id: csrTxn,
      p_reason: '4B correction',
    })
    assert(
      'owner_return_for_csr_txn',
      !returned.error && (returned.data as { review_status?: string })?.review_status === 'expected',
      errMsg(returned.error) || JSON.stringify(returned.data),
    )
    const csrEditReturned = await csr.from('transactions').update({ premium_amount: 112 }).eq('id', csrTxn).select('id')
    assert(
      'csr_edit_returned',
      (csrEditReturned.data?.length ?? 0) === 1,
      errMsg(csrEditReturned.error) || `n=${csrEditReturned.data?.length}`,
    )
    const csrResubmit = await csr.rpc('submit_transaction_for_review', { p_transaction_id: csrTxn })
    assert('csr_resubmit', !csrResubmit.error, errMsg(csrResubmit.error) || JSON.stringify(csrResubmit.data))
  }

  // Owner/Admin full workflow + payment negatives for CSR already covered
  {
    const ownerTxn = await seedTxn(owner, 'OWNER')
    const adminConfirm = await confirmReceipt(admin, ownerTxn, 'ADMIN')
    assert('admin_confirm_receipt', !adminConfirm.error, errMsg(adminConfirm.error) || JSON.stringify(adminConfirm.data))
    const adminSubmit = await admin.rpc('submit_transaction_for_review', { p_transaction_id: ownerTxn })
    assert('admin_submit', !adminSubmit.error, errMsg(adminSubmit.error) || JSON.stringify(adminSubmit.data))
    const ownerApprove = await owner.rpc('approve_transaction_review', { p_transaction_id: ownerTxn })
    assert(
      'owner_approve',
      !ownerApprove.error && (ownerApprove.data as { review_status?: string })?.review_status === 'approved',
      errMsg(ownerApprove.error) || JSON.stringify(ownerApprove.data),
    )
    const ownerReady = await owner.rpc('mark_producer_commission_ready', { p_transaction_id: ownerTxn })
    assert(
      'owner_mark_ready',
      !ownerReady.error && (ownerReady.data as { producer_payment_status?: string })?.producer_payment_status === 'ready',
      errMsg(ownerReady.error) || JSON.stringify(ownerReady.data),
    )

    const voidTxn = await seedTxn(owner, 'VOID')
    await confirmReceipt(owner, voidTxn, 'VOID')
    await owner.rpc('submit_transaction_for_review', { p_transaction_id: voidTxn })
    const voided = await owner.rpc('void_transaction', { p_transaction_id: voidTxn, p_reason: '4B void' })
    assert(
      'owner_void',
      !voided.error && (voided.data as { voided?: boolean })?.voided === true,
      errMsg(voided.error) || JSON.stringify(voided.data),
    )

    const payTxn = await seedTxn(owner, 'PAY')
    const payRow = await owner.from('transactions').select('producer').eq('id', payTxn).single()
    const payProducer = String(payRow.data?.producer ?? '').trim()
    await confirmReceipt(owner, payTxn, 'PAY')
    await owner.rpc('submit_transaction_for_review', { p_transaction_id: payTxn })
    await owner.rpc('approve_transaction_review', { p_transaction_id: payTxn })
    await owner.rpc('mark_producer_commission_ready', { p_transaction_id: payTxn })
    const batch = await owner.rpc('create_producer_payment_batch_with_recoveries', {
      p_producer: payProducer,
      p_transaction_ids: [payTxn],
      p_notes: '4B batch',
    })
    const batchId = (batch.data as { batch_id?: string })?.batch_id
    assert('owner_create_batch', !batch.error && Boolean(batchId), errMsg(batch.error) || JSON.stringify(batch.data))
    if (batchId) {
      const confirmPaid = await owner.rpc('confirm_producer_paid_outside_alza_flow', {
        p_batch_id: batchId,
        p_payment_date: new Date().toISOString().slice(0, 10),
        p_payment_method: 'check',
        p_payment_reference: '4B-REF',
        p_notes: null,
      })
      assert(
        'owner_confirm_paid_outside',
        !confirmPaid.error,
        errMsg(confirmPaid.error) || JSON.stringify(confirmPaid.data),
      )
    }
  }

  // Producer / Viewer / Support cannot execute protected workflow RPCs
  {
    const probe = fixtureTxnIds[0]
    for (const [role, client] of [
      ['producer', producer],
      ['viewer', viewer],
      ['support', support],
    ] as const) {
      const denied = await client.rpc('submit_transaction_for_review', { p_transaction_id: probe })
      assert(
        `${role}_denied_submit`,
        Boolean(denied.error),
        errMsg(denied.error) || 'not denied',
      )
      const deniedApprove = await client.rpc('approve_transaction_review', { p_transaction_id: probe })
      assert(
        `${role}_denied_approve`,
        Boolean(deniedApprove.error),
        errMsg(deniedApprove.error) || 'not denied',
      )
    }
  }

  // Cross-agency foreign transaction ID
  {
    const foreign = await owner.rpc('approve_transaction_review', {
      p_transaction_id: '00000000-0000-4000-8000-000000000099',
    })
    assert(
      'foreign_txn_not_found',
      Boolean(foreign.error) && /Transaction not found/i.test(errMsg(foreign.error)),
      errMsg(foreign.error) || 'not rejected',
    )
    const cross = await owner.rpc('void_transaction', {
      p_transaction_id: FORGED_B,
      p_reason: 'cross agency',
    })
    assert(
      'cross_agency_txn_rejected',
      Boolean(cross.error) && /Transaction not found/i.test(errMsg(cross.error)),
      errMsg(cross.error) || 'not rejected',
    )
  }

  // Cleanup fixtures (receipts + transactions)
  if (fixtureTxnIds.length) {
    writeFileSync(
      resolve('tmp-phase4b-cleanup.sql'),
      `-- Phase 4B fixture cleanup (postgres — clears privileged cols before delete)
DO $$
DECLARE
  v_ids uuid[] := ARRAY[${fixtureTxnIds.map((id) => `'${id}'::uuid`).join(', ')}];
  v_batch_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT payment_batch_id) INTO v_batch_ids
  FROM public.transactions
  WHERE id = ANY(v_ids) AND payment_batch_id IS NOT NULL;

  DELETE FROM public.producer_payment_batch_items WHERE transaction_id = ANY(v_ids);
  DELETE FROM public.producer_recovery_allocations
  WHERE recovery_id IN (
    SELECT id FROM public.producer_commission_recoveries WHERE transaction_id = ANY(v_ids)
  );

  UPDATE public.transactions
  SET
    payment_batch_id = NULL,
    paid_date = NULL,
    paid_amount = NULL,
    payment_method = NULL,
    payment_reference = NULL,
    producer_payment_status = 'not_ready',
    agency_commission_receipt_id = NULL,
    agency_commission_confirmed = false,
    amount_received = NULL,
    received_date = NULL,
    review_status = 'expected',
    reviewed_by = NULL,
    reviewed_date = NULL,
    review_return_reason = NULL,
    review_returned_at = NULL,
    review_returned_by = NULL,
    voided_at = NULL,
    voided_by = NULL,
    void_reason = NULL
  WHERE id = ANY(v_ids);

  DELETE FROM public.agency_commission_receipts WHERE transaction_id = ANY(v_ids);
  DELETE FROM public.producer_commission_recoveries WHERE transaction_id = ANY(v_ids);
  DELETE FROM public.transactions WHERE id = ANY(v_ids);

  IF v_batch_ids IS NOT NULL THEN
    DELETE FROM public.producer_payment_batch_items WHERE batch_id = ANY(v_batch_ids);
    DELETE FROM public.producer_payment_batches WHERE id = ANY(v_batch_ids);
  END IF;
END $$;
`,
      'utf8',
    )
    try {
      execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f tmp-phase4b-cleanup.sql`, {
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      console.warn('cleanup warning', err.stdout ?? err.stderr ?? String(e))
    }
  }

  const postRaw = dbQuery(`
SELECT jsonb_build_object(
  'agency_n', (SELECT COUNT(*) FROM public.agency_profile),
  'singleton', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton'),
  'agency_b', (SELECT COUNT(*) FROM public.agency_profile WHERE id = '${FORGED_B}'),
  'rls_n', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'),
  'rls_fp', (
    SELECT md5(coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname, ',' ORDER BY tablename, policyname), ''))
    FROM pg_policies WHERE schemaname = 'public'
  ),
  'finance', jsonb_build_object(
    'txn_prem', (SELECT coalesce(sum(premium_amount),0) FROM public.transactions),
    'txn_prod', (SELECT coalesce(sum(producer_commission_amount),0) FROM public.transactions),
    'txn_agy', (SELECT coalesce(sum(agency_commission_amount),0) FROM public.transactions),
    'rec_amt', (SELECT coalesce(sum(amount),0) FROM public.producer_commission_recoveries),
    'batch_net', (SELECT coalesce(sum(net_payment),0) FROM public.producer_payment_batches)
  )
) AS post;
`)
  const post = (postRaw.rows?.[0]?.post ?? postRaw.rows?.[0]) as Record<string, unknown>
  console.log('POST', JSON.stringify(post))

  assert('post_singleton', post.singleton === pre.singleton, `singleton=${post.singleton}`)
  assert('post_agency_n', Number(post.agency_n) === Number(pre.agency_n), `agency_n=${post.agency_n}`)
  assert('post_agency_b', Number(post.agency_b) === Number(pre.agency_b), `agency_b=${post.agency_b}`)
  assert('post_rls_n', Number(post.rls_n) === 70, `rls_n=${post.rls_n}`)
  assert(
    'post_rls_fp',
    String(post.rls_fp) === String(pre.rls_fp),
    `pre=${pre.rls_fp} post=${post.rls_fp}`,
  )
  assert(
    'finance_unchanged',
    JSON.stringify(pre.finance) === JSON.stringify(post.finance),
    `pre=${JSON.stringify(pre.finance)} post=${JSON.stringify(post.finance)}`,
  )

  const failed = checks.filter((c) => !c.passed)
  console.log(
    JSON.stringify(
      {
        passed: checks.filter((c) => c.passed).length,
        failed: failed.length,
        failures: failed,
        rls_fp: post.rls_fp,
        finance: post.finance,
      },
      null,
      2,
    ),
  )
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
