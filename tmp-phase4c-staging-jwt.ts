/**
 * STAGING ONLY — Phase 4C Edge tenant isolation validation.
 * Target: uzckhxpqnipnovplohpf. Production untouched.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const TENANT1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const FORGED_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const CREDS = {
  owner: { email: 'owner.payout.v1@example.invalid', password: PASSWORD },
  csr: { email: 'csr.payout.v1@example.invalid', password: PASSWORD },
  support: { email: 'alza.support.staging@example.invalid', password: 'StagingTest!SupportV1-2026' },
}

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []
const fixtureIds: { statementId?: string; rowId?: string; txnId?: string; policyId?: string } = {}

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

function dbQuery(sql: string): unknown {
  const file = resolve('tmp-phase4c-staging-query.sql')
  writeFileSync(file, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${file}`, {
    encoding: 'utf8',
  })
  writeFileSync(resolve('tmp-phase4c-staging-query.out'), captured, 'utf8')
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON in db query output: ${captured.slice(0, 300)}`)
  return JSON.parse(captured.slice(start, end + 1))
}

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c: SupabaseClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`signIn ${creds.email}: ${error.message}`)
  return c
}

function errMsg(e: { message?: string } | null | undefined) {
  return e?.message ?? ''
}

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) throw new Error(`ABORT linked ${linked}`)
  const { url, anon } = loadKeys()

  try {
    execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f tmp-phase4c-precleanup.sql`, {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch {
    // best-effort cleanup of prior debug fixtures
  }

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
`) as { rows?: Array<{ pre: Record<string, unknown> }> }
  const pre = preRaw.rows?.[0]?.pre
  if (!pre) throw new Error('pre-fingerprint failed')
  console.log('PRE', JSON.stringify(pre))

  const owner = await signIn(url, anon, CREDS.owner)
  const csr = await signIn(url, anon, CREDS.csr)
  const support = await signIn(url, anon, CREDS.support)

  const seed = await owner.from('clients').select('id').limit(1).single()
  if (!seed.data?.id) throw new Error('missing seed client')

  const policyNumber = `4C-${Date.now()}`
  const pol = await owner
    .from('policies')
    .insert({
      client_id: seed.data.id,
      policy_number: policyNumber,
      policy_type: 'general',
      carrier: '4C Carrier',
      mga: '4C MGA',
      status: 'Active',
      commission_type: 'percentage',
      agency_commission_amount: 0,
      broker_fee: 0,
      producer_split_percentage: 0,
      producer_commission_amount: 0,
      agency_net_commission: 0,
    })
    .select('id')
    .single()
  if (!pol.data?.id) throw new Error('failed to create isolated test policy')
  fixtureIds.policyId = pol.data.id as string

  const txn = await owner
    .from('transactions')
    .insert({
      client_id: seed.data.id,
      policy_id: pol.data.id,
      producer: '4C-MATCH',
      producer_commission_amount: 10,
      agency_commission_confirmed: false,
      review_status: 'expected',
      producer_payment_status: 'not_ready',
      premium_amount: 100,
      agency_commission_amount: 12.34,
      transaction_type: 'new_policy_premium',
      transaction_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  fixtureIds.txnId = txn.data?.id as string
  if (!fixtureIds.txnId) throw new Error(`failed to create test transaction: ${txn.error?.message ?? 'unknown'}`)

  const stmt = await owner
    .from('reconciliation_statements')
    .insert({
      file_name: `phase4c-${Date.now()}.csv`,
      file_hash: `phase4c-${Date.now()}`,
      status: 'staged',
      statement_date: new Date().toISOString().slice(0, 10),
      period_start: new Date().toISOString().slice(0, 10),
      period_end: new Date().toISOString().slice(0, 10),
      carrier: '4C Carrier',
      mga: '4C MGA',
      row_count: 1,
      detect_missing: false,
    })
    .select('id, agency_profile_id')
    .single()
  fixtureIds.statementId = stmt.data?.id as string
  assert(
    'stmt_agency_a',
    String(stmt.data?.agency_profile_id) === TENANT1,
    `agency=${stmt.data?.agency_profile_id}`,
  )

  const row = await owner
    .from('reconciliation_statement_rows')
    .insert({
      statement_id: fixtureIds.statementId,
      row_source: 'import',
      row_index: 1,
      policy_number: policyNumber,
      client_name: '4C Client',
      commission_amount: 12.34,
      premium_amount: 100,
      transaction_date: new Date().toISOString().slice(0, 10),
      transaction_type: 'new_policy_premium',
      carrier_name: '4C Carrier',
      mga_name: '4C MGA',
      match_status: 'pending',
    })
    .select('id')
    .single()
  fixtureIds.rowId = row.data?.id as string

  const match = await owner.functions.invoke('run-reconciliation-matching', {
    body: { statementId: fixtureIds.statementId },
  })
  assert(
    'matching_owner_a',
    !match.error && Boolean((match.data as { statementId?: string })?.statementId),
    errMsg(match.error) || JSON.stringify(match.data),
  )

  const matchedRow = await owner
    .from('reconciliation_statement_rows')
    .select('matched_transaction_id, match_status')
    .eq('id', fixtureIds.rowId)
    .single()
  assert(
    'matching_links_a_txn',
    String(matchedRow.data?.matched_transaction_id) === fixtureIds.txnId &&
      matchedRow.data?.match_status === 'auto_matched',
    JSON.stringify(matchedRow.data),
  )

  const foreignStmt = await owner.functions.invoke('run-reconciliation-matching', {
    body: { statementId: FORGED_B },
  })
  assert(
    'matching_foreign_statement_denied',
    Boolean(foreignStmt.error),
    errMsg(foreignStmt.error) || JSON.stringify(foreignStmt.data),
  )

  const csrMatch = await csr.functions.invoke('run-reconciliation-matching', {
    body: { statementId: fixtureIds.statementId },
  })
  assert('csr_matching_allowed', !csrMatch.error, errMsg(csrMatch.error) || 'ok')

  const supportMatch = await support.functions.invoke('run-reconciliation-matching', {
    body: { statementId: fixtureIds.statementId },
  })
  assert(
    'support_matching_denied',
    Boolean(supportMatch.error),
    errMsg(supportMatch.error) || 'not denied',
  )

  await owner
    .from('reconciliation_statement_rows')
    .update({ match_status: 'manual_matched', matched_transaction_id: fixtureIds.txnId })
    .eq('id', fixtureIds.rowId)

  const confirm = await owner.functions.invoke('confirm-reconciliation-receipts', {
    body: { statementId: fixtureIds.statementId, rowIds: [fixtureIds.rowId] },
  })
  assert(
    'confirm_receipt_a',
    !confirm.error,
    errMsg(confirm.error) || JSON.stringify(confirm.data),
  )

  const forgedConfirm = await owner.functions.invoke('confirm-reconciliation-receipts', {
    body: { statementId: FORGED_B, rowIds: [fixtureIds.rowId] },
  })
  assert(
    'confirm_foreign_statement_denied',
    Boolean(forgedConfirm.error),
    errMsg(forgedConfirm.error) || 'not denied',
  )

  const notifyB = await owner.functions.invoke('notify-transaction-review', {
    body: { transactionId: FORGED_B, action: 'submitted' },
  })
  assert(
    'notify_foreign_txn_denied',
    Boolean(notifyB.error),
    errMsg(notifyB.error) || JSON.stringify(notifyB.data),
  )

  const inviteForged = await owner.functions.invoke('invite-alza-user', {
    body: {
      action: 'invite',
      email: `phase4c-forged-${Date.now()}@example.invalid`,
      full_name: 'Forged Agency',
      role: 'viewer',
      agency_profile_id: FORGED_B,
    },
  })
  assert(
    'invite_forged_agency_rejected',
    Boolean(inviteForged.error) ||
      (inviteForged.data as { code?: string })?.code === 'forbidden_tenant_override',
    errMsg(inviteForged.error) || JSON.stringify(inviteForged.data),
  )

  const csrInvite = await csr.functions.invoke('invite-alza-user', {
    body: {
      action: 'invite',
      email: `phase4c-csr-${Date.now()}@example.invalid`,
      full_name: 'CSR Invite',
      role: 'viewer',
    },
  })
  assert('csr_invite_denied', Boolean(csrInvite.error), errMsg(csrInvite.error) || 'not denied')

  const supportInvite = await support.functions.invoke('invite-alza-user', {
    body: {
      action: 'invite',
      email: `phase4c-sup-${Date.now()}@example.invalid`,
      full_name: 'Support Invite',
      role: 'viewer',
    },
  })
  assert(
    'support_invite_denied',
    Boolean(supportInvite.error),
    errMsg(supportInvite.error) || 'not denied',
  )

  if (fixtureIds.statementId && fixtureIds.txnId) {
    writeFileSync(
      resolve('tmp-phase4c-cleanup.sql'),
      `DELETE FROM public.reconciliation_statement_rows WHERE statement_id = '${fixtureIds.statementId}';
DELETE FROM public.reconciliation_statements WHERE id = '${fixtureIds.statementId}';
UPDATE public.transactions
SET agency_commission_receipt_id = NULL, agency_commission_confirmed = false,
    amount_received = NULL, received_date = NULL, review_status = 'expected'
WHERE id = '${fixtureIds.txnId}';
DELETE FROM public.agency_commission_receipts WHERE transaction_id = '${fixtureIds.txnId}';
DELETE FROM public.transactions WHERE id = '${fixtureIds.txnId}';
DELETE FROM public.policies WHERE id = '${fixtureIds.policyId ?? ''}';
`,
      'utf8',
    )
    try {
      execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f tmp-phase4c-cleanup.sql`, {
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (e) {
      console.warn('cleanup warning', e)
    }
  }

  const postRaw = dbQuery(`
SELECT jsonb_build_object(
  'agency_n', (SELECT COUNT(*) FROM public.agency_profile),
  'singleton', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton'),
  'agency_b', (SELECT COUNT(*) FROM public.agency_profile WHERE id = '${FORGED_B}'),
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
`) as { rows?: Array<{ post: Record<string, unknown> }> }
  const post = postRaw.rows?.[0]?.post
  console.log('POST', JSON.stringify(post))

  assert('post_singleton', post?.singleton === true, `singleton=${post?.singleton}`)
  assert('post_agency_n', Number(post?.agency_n) === 1, `agency_n=${post?.agency_n}`)
  assert('post_agency_b', Number(post?.agency_b) === 0, `agency_b=${post?.agency_b}`)
  assert(
    'post_rls_fp',
    String(post?.rls_fp) === String(pre.rls_fp),
    `pre=${pre.rls_fp} post=${post?.rls_fp}`,
  )
  assert(
    'finance_unchanged',
    JSON.stringify(pre.finance) === JSON.stringify(post?.finance),
    `pre=${JSON.stringify(pre.finance)} post=${JSON.stringify(post?.finance)}`,
  )

  const failed = checks.filter((c) => !c.passed)
  console.log(
    JSON.stringify(
      {
        passed: checks.filter((c) => c.passed).length,
        failed: failed.length,
        failures: failed,
        rls_fp: post?.rls_fp,
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
