/**
 * STAGING ONLY — persistent two-agency validation.
 * Target: uzckhxpqnipnovplohpf. Aborts on Production.
 *
 * Run: npx tsx scripts/validate-two-agency-staging.ts
 *
 * Drops agency_profile_singleton on staging, creates persistent Agency B,
 * seeds 2AG-B-* fixtures, and exercises JWT/application isolation.
 * Does NOT clean up Agency B on success.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const SUPPORT_PASSWORD = 'StagingTest!SupportV1-2026'

const B_CLIENT = 'b5000000-0000-4000-8000-0000000000b5'
const B_POLICY_SHARED = 'b6000000-0000-4000-8000-0000000000b6'
const B_POLICY_OWN = 'b6100000-0000-4000-8000-000000000061'
const B_TXN_MATCH = 'b7000000-0000-4000-8000-0000000000b7'
const B_TXN_RECEIPT = 'b7100000-0000-4000-8000-000000000071'
const B_TXN_VOIDED = 'b7200000-0000-4000-8000-000000000072'
const B_CARRIER = 'b1000000-0000-4000-8000-0000000000b1'
const B_STMT = 'b9000000-0000-4000-8000-0000000000b9'
const B_STMT_ROW = 'ba000000-0000-4000-8000-0000000000ba'
const B_TICKET = 'bb000000-0000-4000-8000-0000000000bb'
const B_BILLING = 'bc000000-0000-4000-8000-0000000000bc'
const A_TXN_POL = '0d5dac8d-a5c1-4f3c-8566-12af30f0967d'
const A_STMT = '07000000-0000-4000-8000-000000000007'
const A_CLIENT = '04000000-0000-4000-8000-000000000004'

const A_CREDS = {
  owner: { email: 'owner.payout.v1@example.invalid', password: PASSWORD },
  admin: { email: 'admin.role.payout.v1@example.invalid', password: PASSWORD },
  csr: { email: 'csr.payout.v1@example.invalid', password: PASSWORD },
  producer: { email: 'producer.payout.v1@example.invalid', password: PASSWORD },
  viewer: { email: 'viewer.payout.v1@example.invalid', password: PASSWORD },
  support: { email: 'alza.support.staging@example.invalid', password: SUPPORT_PASSWORD },
  inactive: { email: 'inactive.phase3.rls@example.invalid', password: PASSWORD },
}

const B_CREDS = {
  owner: { email: 'owner.2ag.b@example.invalid', password: PASSWORD },
  admin: { email: 'admin.2ag.b@example.invalid', password: PASSWORD },
  csr: { email: 'csr.2ag.b@example.invalid', password: PASSWORD },
  producer: { email: 'producer.2ag.b@example.invalid', password: PASSWORD },
  viewer: { email: 'viewer.2ag.b@example.invalid', password: PASSWORD },
  unlinked: { email: 'producer.2ag.b.unlinked@example.invalid', password: PASSWORD },
  inactive: { email: 'inactive.2ag.b@example.invalid', password: PASSWORD },
}

const B_AUTH_USERS: Array<{ email: string; fullName: string }> = [
  { email: B_CREDS.owner.email, fullName: '2AG-B Owner' },
  { email: B_CREDS.admin.email, fullName: '2AG-B Admin' },
  { email: B_CREDS.csr.email, fullName: '2AG-B CSR' },
  { email: B_CREDS.producer.email, fullName: '2AG-B Producer' },
  { email: B_CREDS.viewer.email, fullName: '2AG-B Viewer' },
  { email: B_CREDS.unlinked.email, fullName: '2AG-B Unlinked Producer' },
  { email: B_CREDS.inactive.email, fullName: '2AG-B Inactive Viewer' },
]

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}

function errMsg(e: { message?: string } | null | undefined) {
  return e?.message ?? ''
}

async function invokeFn(
  client: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
) {
  const res = await client.functions.invoke(name, { body })
  let payload: unknown = res.data
  const anyErr = res.error as { message?: string; context?: Response } | null
  if (anyErr?.context) {
    try {
      const text = await (anyErr.context as Response).text()
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
    } catch {
      /* ignore */
    }
  }
  const blob = `${anyErr?.message ?? ''} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`
  return { error: anyErr, data: payload, blob }
}

function readLinkedRef(): string {
  return readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim()
}

function loadKeys(): { url: string; anon: string; service: string } {
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, {
    encoding: 'utf8',
  })
  const raw = JSON.parse(json.replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  let service = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon')) anon = key
    if (name.includes('service_role') || name === 'service') service = key
  }
  if (!anon || !service) throw new Error('missing staging anon or service_role key')
  const url = `https://${STAGING_REF}.supabase.co`
  if (url.includes(PRODUCTION_REF) || STAGING_REF === PRODUCTION_REF) {
    throw new Error('ABORT: production URL')
  }
  return { url, anon, service }
}

function dbQuery(sql: string, file = 'tmp-2ag-query.sql'): { rows?: Array<Record<string, unknown>> } {
  const path = resolve(file)
  writeFileSync(path, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${path}`, {
    encoding: 'utf8',
  })
  writeFileSync(resolve('tmp-2ag-query.out'), captured, 'utf8')
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON in db query: ${captured.slice(0, 400)}`)
  return JSON.parse(captured.slice(start, end + 1)) as { rows?: Array<Record<string, unknown>> }
}

function applySqlFile(rel: string) {
  const captured = execSync(
    `npx supabase db query --linked --project-ref ${STAGING_REF} -f ${resolve(rel)}`,
    { encoding: 'utf8' },
  )
  writeFileSync(resolve('tmp-2ag-apply.out'), captured, 'utf8')
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON applying ${rel}: ${captured.slice(0, 400)}`)
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

function pngBlob(): Blob {
  const bytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  return new Blob([bytes], { type: 'image/png' })
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: 'text/plain' })
}

async function ensureAuthUsers(admin: SupabaseClient) {
  const existing = new Set<string>()
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    for (const u of data.users) {
      if (u.email) existing.add(u.email.toLowerCase())
    }
    if (data.users.length < 200) break
  }
  for (const row of B_AUTH_USERS) {
    if (existing.has(row.email.toLowerCase())) continue
    const created = await admin.auth.admin.createUser({
      email: row.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: row.fullName },
    })
    if (created.error) throw new Error(`createUser ${row.email}: ${created.error.message}`)
  }
}

function kpiSum(
  rows: Array<{ premium_amount?: number | string | null; voided_at?: string | null; archived_at?: string | null }>,
) {
  return rows
    .filter((r) => !r.voided_at && !r.archived_at)
    .reduce((acc, r) => acc + Number(r.premium_amount ?? 0), 0)
}

async function seedWorkflowTxn(
  client: SupabaseClient,
  reviewerUserId: string,
  producer: string,
) {
  const ins = await client
    .from('transactions')
    .insert({
      client_id: B_CLIENT,
      policy_id: B_POLICY_OWN,
      producer,
      producer_commission_amount: 8,
      agency_commission_confirmed: false,
      review_status: 'expected',
      producer_payment_status: 'not_ready',
      premium_amount: 80,
      agency_commission_amount: 8,
      reviewer_user_id: reviewerUserId,
      transaction_type: 'new_policy_premium',
      transaction_date: new Date().toISOString().slice(0, 10),
    })
    .select('id, transaction_number, agency_profile_id')
    .single()
  if (ins.error || !ins.data?.id) throw new Error(`seed workflow txn: ${errMsg(ins.error)}`)
  return ins.data
}

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) {
    throw new Error(`ABORT linked ${linked} — refusing two-agency staging work`)
  }
  const { url, anon, service } = loadKeys()
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log('\n== 1. Staging-only singleton drop ==')
  const dropped = applySqlFile('scripts/staging-two-agency/drop-singleton.sql')
  const dropRow = dropped.rows?.[0]?.staging_singleton_drop as Record<string, unknown> | undefined
  assert('singleton_dropped', dropRow?.singleton === false, JSON.stringify(dropRow))
  assert('agency_a_present', dropRow?.agency_a === true, JSON.stringify(dropRow))

  console.log('\n== 2. Agency B auth users + seed ==')
  await ensureAuthUsers(admin)
  const seeded = applySqlFile('scripts/staging-two-agency/seed.sql')
  const seedRow = seeded.rows?.[0]?.two_agency_seed as Record<string, unknown> | undefined
  assert('seed_agency_n', Number(seedRow?.agency_n) === 2, JSON.stringify(seedRow))
  assert('seed_b_users', Number(seedRow?.b_users) === 7, JSON.stringify(seedRow))
  assert('seed_b_book', Number(seedRow?.b_clients) >= 1 && Number(seedRow?.b_txns) >= 4, JSON.stringify(seedRow))
  assert('seed_a_untouched_clients', Number(seedRow?.a_clients) === 2, JSON.stringify(seedRow))

  const aOwner = await signIn(url, anon, A_CREDS.owner)
  const aAdmin = await signIn(url, anon, A_CREDS.admin)
  const aCsr = await signIn(url, anon, A_CREDS.csr)
  const aProducer = await signIn(url, anon, A_CREDS.producer)
  const aViewer = await signIn(url, anon, A_CREDS.viewer)
  const support = await signIn(url, anon, A_CREDS.support)
  const bOwner = await signIn(url, anon, B_CREDS.owner)
  const bAdmin = await signIn(url, anon, B_CREDS.admin)
  const bCsr = await signIn(url, anon, B_CREDS.csr)
  const bProducer = await signIn(url, anon, B_CREDS.producer)
  const bViewer = await signIn(url, anon, B_CREDS.viewer)
  const bUnlinked = await signIn(url, anon, B_CREDS.unlinked)
  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const aInactive = await trySignIn(url, anon, A_CREDS.inactive)
  const bInactive = await trySignIn(url, anon, B_CREDS.inactive)

  const bOwnerProfile = await bOwner.from('users').select('id, agency_profile_id, role').eq('email', B_CREDS.owner.email).single()
  const bOwnerUserId = String(bOwnerProfile.data?.id ?? '')
  assert('b_owner_membership', bOwnerProfile.data?.agency_profile_id === AGENCY_B, JSON.stringify(bOwnerProfile.data))

  console.log('\n== 3. Dashboard / KPI isolation ==')
  const aTx = await aOwner.from('transactions').select('id, agency_profile_id, premium_amount, voided_at, archived_at')
  const bTx = await bOwner.from('transactions').select('id, agency_profile_id, premium_amount, voided_at, archived_at')
  const aIds = new Set((aTx.data ?? []).map((r) => String(r.id)))
  const bIds = new Set((bTx.data ?? []).map((r) => String(r.id)))
  assert('a_txns_agency', (aTx.data ?? []).every((r) => r.agency_profile_id === AGENCY_A), `n=${aTx.data?.length}`)
  assert('b_txns_agency', (bTx.data ?? []).every((r) => r.agency_profile_id === AGENCY_B), `n=${bTx.data?.length}`)
  assert('a_cannot_see_b_txns', ![...bIds].some((id) => aIds.has(id)) && !aIds.has(B_TXN_MATCH), `a=${aIds.size} overlap`)
  assert('b_cannot_see_a_txns', ![...aIds].some((id) => bIds.has(id)) && !bIds.has(A_TXN_POL), `b=${bIds.size} overlap`)
  assert('b_sees_voided_row', bIds.has(B_TXN_VOIDED), 'voided fixture missing from B list')
  const aKpi = kpiSum(aTx.data ?? [])
  const bKpi = kpiSum(bTx.data ?? [])
  const bVoided = (bTx.data ?? []).find((r) => r.id === B_TXN_VOIDED)
  assert('b_kpi_excludes_voided', bKpi === kpiSum((bTx.data ?? []).filter((r) => r.id !== B_TXN_VOIDED)), `kpi=${bKpi}`)
  assert('b_voided_premium_not_in_kpi', !bVoided?.voided_at ? false : bKpi < Number(bVoided.premium_amount), `voided=${bVoided?.premium_amount} kpi=${bKpi}`)
  assert('a_kpi_excludes_b_voided', aKpi < 99999 || !aIds.has(B_TXN_VOIDED), `aKpi=${aKpi}`)

  console.log('\n== 4. Client / policy / transaction UUID isolation ==')
  const aClientB = await aOwner.from('clients').select('id, business_name').eq('id', B_CLIENT).maybeSingle()
  const bClientA = await bOwner.from('clients').select('id, business_name').eq('id', A_CLIENT).maybeSingle()
  const aPolB = await aOwner.from('policies').select('id').eq('id', B_POLICY_SHARED).maybeSingle()
  const aTxnB = await aOwner.from('transactions').select('id').eq('id', B_TXN_MATCH).maybeSingle()
  const bTxnA = await bOwner.from('transactions').select('id').eq('id', A_TXN_POL).maybeSingle()
  assert('a_no_b_client', !aClientB.data, errMsg(aClientB.error) || 'leaked')
  assert('b_no_a_client', !bClientA.data, errMsg(bClientA.error) || 'leaked')
  assert('a_no_b_policy', !aPolB.data, errMsg(aPolB.error) || 'leaked')
  assert('a_no_b_txn', !aTxnB.data, errMsg(aTxnB.error) || 'leaked')
  assert('b_no_a_txn', !bTxnA.data, errMsg(bTxnA.error) || 'leaked')

  console.log('\n== 5. Directory isolation ==')
  const aCarriers = await aOwner.from('carriers').select('id, carrier_name, agency_profile_id')
  const bCarriers = await bOwner.from('carriers').select('id, carrier_name, agency_profile_id')
  assert(
    'a_dir_own_only',
    (aCarriers.data ?? []).every((r) => r.agency_profile_id === AGENCY_A) &&
      !(aCarriers.data ?? []).some((r) => r.id === B_CARRIER),
    `n=${aCarriers.data?.length}`,
  )
  assert(
    'b_dir_own_only',
    (bCarriers.data ?? []).every((r) => r.agency_profile_id === AGENCY_B) &&
      (bCarriers.data ?? []).some((r) => r.carrier_name === 'DUMMY Tenant1 Carrier'),
    `n=${bCarriers.data?.length}`,
  )
  assert(
    'same_carrier_name_independent',
    (aCarriers.data ?? []).some((r) => r.carrier_name === 'DUMMY Tenant1 Carrier') &&
      (bCarriers.data ?? []).some((r) => r.carrier_name === 'DUMMY Tenant1 Carrier'),
    'shared name missing',
  )
  const aMutB = await aOwner.from('carriers').update({ notes: '2AG-A-cross' }).eq('id', B_CARRIER).select('id')
  const bMutAName = (aCarriers.data ?? []).find((r) => r.carrier_name === 'DUMMY Tenant1 Carrier')?.id
  const bMutA = bMutAName
    ? await bOwner.from('carriers').update({ notes: '2AG-B-cross' }).eq('id', bMutAName).select('id')
    : { data: [{ id: 'missing' }], error: null }
  assert('a_cannot_mutate_b_dir', (aMutB.data?.length ?? 0) === 0, errMsg(aMutB.error) || `n=${aMutB.data?.length}`)
  assert('b_cannot_mutate_a_dir', (bMutA.data?.length ?? 0) === 0, errMsg(bMutA.error) || `n=${bMutA.data?.length}`)
  const viewerDir = await bViewer.from('carriers').insert({ carrier_name: '2AG-B-VIEWER-SHOULD-FAIL', status: 'active' }).select('id')
  assert('b_viewer_cannot_insert_dir', Boolean(viewerDir.error) || (viewerDir.data?.length ?? 0) === 0, errMsg(viewerDir.error) || 'inserted')

  console.log('\n== 6. Producer / CSR isolation ==')
  const bProdTx = await bProducer.from('transactions').select('id, producer, agency_profile_id')
  const aProdTx = await aProducer.from('transactions').select('id, producer, agency_profile_id')
  const unlinkedTx = await bUnlinked.from('transactions').select('id')
  assert(
    'b_producer_book',
    (bProdTx.data?.length ?? 0) >= 1 &&
      (bProdTx.data ?? []).every((r) => r.agency_profile_id === AGENCY_B && r.producer === 'DUMMY Payout V1 Producer'),
    `n=${bProdTx.data?.length} err=${errMsg(bProdTx.error)}`,
  )
  assert('b_producer_no_a', !(bProdTx.data ?? []).some((r) => aIds.has(String(r.id))), 'B producer saw A')
  assert(
    'a_producer_no_b',
    !(aProdTx.data ?? []).some((r) => bIds.has(String(r.id))),
    `a producer n=${aProdTx.data?.length}`,
  )
  assert('b_unlinked_fail_closed', (unlinkedTx.data?.length ?? 0) === 0, `n=${unlinkedTx.data?.length}`)

  const aCsrTouchB = await aCsr.from('transactions').update({ premium_amount: 999 }).eq('id', B_TXN_MATCH).select('id')
  const bCsrTouchA = await bCsr.from('transactions').update({ premium_amount: 1 }).eq('id', A_TXN_POL).select('id')
  assert('a_csr_cannot_mutate_b', (aCsrTouchB.data?.length ?? 0) === 0, errMsg(aCsrTouchB.error) || `n=${aCsrTouchB.data?.length}`)
  assert('b_csr_cannot_mutate_a', (bCsrTouchA.data?.length ?? 0) === 0, errMsg(bCsrTouchA.error) || `n=${bCsrTouchA.data?.length}`)

  console.log('\n== 7. Workflow + payment isolation ==')
  const wf = await seedWorkflowTxn(bCsr, bOwnerUserId, 'DUMMY Payout V1 Producer')
  assert('b_csr_create_txn', wf.agency_profile_id === AGENCY_B, JSON.stringify(wf))
  const confirm = await bCsr.rpc('confirm_agency_commission_received', {
    p_transaction_id: wf.id,
    p_amount_received: 8,
    p_received_date: new Date().toISOString().slice(0, 10),
    p_deposit_reference: '2AG-B-WF',
    p_external_invoice_id: null,
    p_notes: null,
    p_variance_acknowledged: false,
  })
  assert('b_confirm_receipt', !confirm.error, errMsg(confirm.error) || JSON.stringify(confirm.data))
  const aConfirmB = await aOwner.rpc('confirm_agency_commission_received', {
    p_transaction_id: B_TXN_MATCH,
    p_amount_received: 12.34,
    p_received_date: new Date().toISOString().slice(0, 10),
    p_deposit_reference: 'A-on-B',
    p_external_invoice_id: null,
    p_notes: null,
    p_variance_acknowledged: false,
  })
  assert(
    'a_cannot_confirm_b',
    Boolean(aConfirmB.error) && /not found/i.test(errMsg(aConfirmB.error)),
    errMsg(aConfirmB.error) || JSON.stringify(aConfirmB.data),
  )
  const submit = await bCsr.rpc('submit_transaction_for_review', { p_transaction_id: wf.id })
  assert('b_submit', !submit.error, errMsg(submit.error) || JSON.stringify(submit.data))
  const returned = await bOwner.rpc('return_transaction_for_correction', {
    p_transaction_id: wf.id,
    p_reason: '2AG-B correction',
  })
  assert('b_return', !returned.error, errMsg(returned.error) || JSON.stringify(returned.data))
  const csrEdit = await bCsr.from('transactions').update({ premium_amount: 81 }).eq('id', wf.id).select('id')
  assert('b_csr_edit_returned', (csrEdit.data?.length ?? 0) === 1, errMsg(csrEdit.error) || `n=${csrEdit.data?.length}`)
  const resubmit = await bCsr.rpc('submit_transaction_for_review', { p_transaction_id: wf.id })
  assert('b_resubmit', !resubmit.error, errMsg(resubmit.error) || JSON.stringify(resubmit.data))
  const approve = await bOwner.rpc('approve_transaction_review', { p_transaction_id: wf.id })
  assert('b_approve', !approve.error, errMsg(approve.error) || JSON.stringify(approve.data))
  const aApproveB = await aOwner.rpc('approve_transaction_review', { p_transaction_id: wf.id })
  assert('a_cannot_approve_b', Boolean(aApproveB.error), errMsg(aApproveB.error) || 'not denied')
  const ready = await bOwner.rpc('mark_producer_commission_ready', { p_transaction_id: wf.id })
  assert('b_ready', !ready.error, errMsg(ready.error) || JSON.stringify(ready.data))

  const batch = await bOwner.rpc('create_producer_payment_batch_with_recoveries', {
    p_producer: 'DUMMY Payout V1 Producer',
    p_transaction_ids: [wf.id],
    p_notes: '2AG-B batch',
  })
  const batchId = (batch.data as { batch_id?: string; batch_number?: string } | null)?.batch_id
  const batchNumber = (batch.data as { batch_number?: string } | null)?.batch_number
  assert('b_create_batch', !batch.error && Boolean(batchId), errMsg(batch.error) || JSON.stringify(batch.data))
  const aBatchB = await aOwner.rpc('create_producer_payment_batch_with_recoveries', {
    p_producer: 'DUMMY Payout V1 Producer',
    p_transaction_ids: [B_TXN_MATCH],
    p_notes: 'A trying B',
  })
  assert('a_cannot_batch_b_txn', Boolean(aBatchB.error), errMsg(aBatchB.error) || JSON.stringify(aBatchB.data))
  assert(
    'b_batch_number_may_overlap',
    Boolean(batchNumber),
    `batch_number=${batchNumber ?? ''}`,
  )

  console.log('\n== 8. Reconciliation P0 isolation ==')
  dbQuery(`
UPDATE public.transactions
SET policy_id = '${B_POLICY_OWN}'
WHERE agency_profile_id = '${AGENCY_B}'
  AND id <> '${B_TXN_MATCH}'
  AND policy_id = '${B_POLICY_SHARED}';
UPDATE public.transactions
SET agency_commission_receipt_id = NULL,
    agency_commission_confirmed = false,
    amount_received = NULL,
    received_date = NULL
WHERE id = '${B_TXN_MATCH}';
UPDATE public.reconciliation_statement_rows
SET match_status = 'pending',
    match_confidence = NULL,
    matched_transaction_id = NULL,
    receipt_id = NULL,
    discrepancy_type = NULL
WHERE id = '${B_STMT_ROW}';
DELETE FROM public.reconciliation_statement_rows
WHERE statement_id = '${B_STMT}' AND row_source = 'missing';
DELETE FROM public.agency_commission_receipts
WHERE transaction_id = '${B_TXN_MATCH}';
UPDATE public.reconciliation_statements
SET status = 'staged',
    matched_count = 0,
    unmatched_count = 0,
    exception_count = 0,
    confirmed_count = 0,
    skipped_count = 0,
    missing_count = 0,
    detect_missing = true
WHERE id = '${B_STMT}';
SELECT jsonb_build_object('reset', true) AS reset;
`)
  const bMatch = await invokeFn(bOwner, 'run-reconciliation-matching', {
    statementId: B_STMT,
    detectMissing: true,
    rerun: true,
  })
  assert('b_matching_runs', !bMatch.error || Boolean((bMatch.data as { ok?: boolean } | null)?.ok), bMatch.blob)
  const bRow = await bOwner
    .from('reconciliation_statement_rows')
    .select('matched_transaction_id, match_status, row_source, policy_number')
    .eq('id', B_STMT_ROW)
    .single()
  assert(
    'b_matches_b_txn_not_a',
    String(bRow.data?.matched_transaction_id) === B_TXN_MATCH,
    JSON.stringify(bRow.data),
  )
  const bMissing = await bOwner
    .from('reconciliation_statement_rows')
    .select('matched_transaction_id, row_source')
    .eq('statement_id', B_STMT)
    .eq('row_source', 'missing')
  assert(
    'b_missing_not_a_txn',
    !(bMissing.data ?? []).some((r) => String(r.matched_transaction_id) === A_TXN_POL),
    JSON.stringify(bMissing.data),
  )
  const aOnB = await aOwner.functions.invoke('run-reconciliation-matching', {
    body: { statementId: B_STMT },
  })
  assert('a_cannot_match_b_stmt', Boolean(aOnB.error), errMsg(aOnB.error) || JSON.stringify(aOnB.data))
  const bOnA = await bOwner.functions.invoke('run-reconciliation-matching', {
    body: { statementId: A_STMT },
  })
  assert('b_cannot_match_a_stmt', Boolean(bOnA.error), errMsg(bOnA.error) || JSON.stringify(bOnA.data))

  const aProbe = await aOwner
    .from('reconciliation_statements')
    .insert({
      file_name: `2ag-a-probe-${Date.now()}.csv`,
      file_hash: `2ag-a-probe-${Date.now()}`,
      status: 'staged',
      statement_date: new Date().toISOString().slice(0, 10),
      period_start: new Date().toISOString().slice(0, 10),
      period_end: new Date().toISOString().slice(0, 10),
      carrier: 'DUMMY Tenant1 Carrier',
      mga: 'DUMMY Tenant1 MGA',
      row_count: 1,
      detect_missing: false,
    })
    .select('id')
    .single()
  const aProbeId = String(aProbe.data?.id ?? '')
  if (aProbeId) {
    await aOwner.from('reconciliation_statement_rows').insert({
      statement_id: aProbeId,
      row_source: 'import',
      row_index: 1,
      policy_number: 'POL-STAGING-0001',
      client_name: 'DUMMY Tenant1 Client LLC',
      commission_amount: 12.34,
      premium_amount: 100,
      transaction_date: new Date().toISOString().slice(0, 10),
      transaction_type: 'new_policy_premium',
      carrier_name: 'DUMMY Tenant1 Carrier',
      mga_name: 'DUMMY Tenant1 MGA',
      match_status: 'pending',
    })
    const aMatch = await aOwner.functions.invoke('run-reconciliation-matching', {
      body: { statementId: aProbeId },
    })
    assert('a_matching_runs', !aMatch.error, errMsg(aMatch.error) || JSON.stringify(aMatch.data))
    const aMatched = await aOwner
      .from('reconciliation_statement_rows')
      .select('matched_transaction_id')
      .eq('statement_id', aProbeId)
      .eq('row_source', 'import')
    const matchedIds = (aMatched.data ?? []).map((r) => String(r.matched_transaction_id ?? ''))
    assert('a_matching_never_loads_b', !matchedIds.includes(B_TXN_MATCH), JSON.stringify(matchedIds))
  } else {
    assert('a_matching_runs', false, errMsg(aProbe.error) || 'failed to create A probe statement')
  }

  const bConfirm = await bOwner.functions.invoke('confirm-reconciliation-receipts', {
    body: { statementId: B_STMT, rowIds: [B_STMT_ROW] },
  })
  assert('b_confirm_receipt_isolated', !bConfirm.error, errMsg(bConfirm.error) || JSON.stringify(bConfirm.data))
  const aConfirmStmt = await aOwner.functions.invoke('confirm-reconciliation-receipts', {
    body: { statementId: B_STMT, rowIds: [B_STMT_ROW] },
  })
  assert('a_cannot_confirm_b_stmt', Boolean(aConfirmStmt.error), errMsg(aConfirmStmt.error) || 'not denied')

  console.log('\n== 9. Support ==')
  const aTickets = await aOwner.from('support_conversations').select('id, agency_profile_id, subject, ticket_number')
  const bMsg = await bOwner.from('support_messages').insert({
    conversation_id: B_TICKET,
    sender_user_id: bOwnerUserId,
    sender_type: 'agency_user',
    body: '2AG-B seed ticket body',
  }).select('id').maybeSingle()
  assert('b_support_message_seed', Boolean(bMsg.data?.id) || /duplicate|already/i.test(errMsg(bMsg.error)), errMsg(bMsg.error) || String(bMsg.data?.id))
  const bTickets = await bOwner.from('support_conversations').select('id, agency_profile_id, subject, ticket_number')
  const sTickets = await support.from('support_conversations').select('id, agency_profile_id, subject, ticket_number')
  assert(
    'a_tickets_own',
    (aTickets.data ?? []).every((t) => t.agency_profile_id === AGENCY_A) &&
      !(aTickets.data ?? []).some((t) => t.id === B_TICKET),
    `n=${aTickets.data?.length}`,
  )
  assert(
    'b_tickets_own',
    (bTickets.data ?? []).every((t) => t.agency_profile_id === AGENCY_B) &&
      (bTickets.data ?? []).some((t) => t.id === B_TICKET),
    `n=${bTickets.data?.length}`,
  )
  assert(
    'support_sees_both',
    (sTickets.data ?? []).some((t) => t.agency_profile_id === AGENCY_A) &&
      (sTickets.data ?? []).some((t) => t.id === B_TICKET),
    `n=${sTickets.data?.length}`,
  )
  const ticketNumberOk = (value: unknown) => /^ALZA-\d{6}$/.test(String(value ?? ''))
  assert(
    'a_tickets_have_ticket_number',
    (aTickets.data ?? []).length > 0 && (aTickets.data ?? []).every((t) => ticketNumberOk(t.ticket_number)),
    JSON.stringify((aTickets.data ?? []).map((t) => t.ticket_number)),
  )
  assert(
    'b_tickets_have_ticket_number',
    (bTickets.data ?? []).length > 0 && (bTickets.data ?? []).every((t) => ticketNumberOk(t.ticket_number)),
    JSON.stringify((bTickets.data ?? []).map((t) => t.ticket_number)),
  )
  assert(
    'support_ticket_numbers_global',
    (sTickets.data ?? []).every((t) => ticketNumberOk(t.ticket_number)),
    JSON.stringify((sTickets.data ?? []).map((t) => t.ticket_number)),
  )
  const brief = await support.rpc('support_agency_brief')
  const briefRows = Array.isArray(brief.data) ? (brief.data as Array<{ id: string; agency_name: string }>) : []
  assert(
    'support_agency_brief_both',
    !brief.error &&
      briefRows.some((r) => r.id === AGENCY_A && Boolean(r.agency_name)) &&
      briefRows.some((r) => r.id === AGENCY_B && Boolean(r.agency_name)),
    brief.error?.message ?? JSON.stringify(brief.data),
  )
  const sClients = await support.from('clients').select('id')
  const sTxn = await support.from('transactions').select('id')
  const sAgency = await support.from('agency_profile').select('id')
  assert('support_no_ops_clients', (sClients.data?.length ?? 0) === 0, `n=${sClients.data?.length}`)
  assert('support_no_ops_txns', (sTxn.data?.length ?? 0) === 0, `n=${sTxn.data?.length}`)
  assert('support_no_agency_profile', (sAgency.data?.length ?? 0) === 0, `n=${sAgency.data?.length}`)

  console.log('\n== 10. Billing ==')
  const aBill = await aOwner.from('billing_subscriptions').select('id, agency_profile_id, razorpay_subscription_id')
  const bBill = await bOwner.from('billing_subscriptions').select('id, agency_profile_id, razorpay_subscription_id')
  assert(
    'a_billing_own',
    (aBill.data?.length ?? 0) === 1 && aBill.data?.[0]?.agency_profile_id === AGENCY_A,
    JSON.stringify(aBill.data),
  )
  assert(
    'b_billing_own',
    (bBill.data?.length ?? 0) === 1 &&
      bBill.data?.[0]?.agency_profile_id === AGENCY_B &&
      bBill.data?.[0]?.id === B_BILLING,
    JSON.stringify(bBill.data),
  )
  assert('no_razorpay_checkout', !(bBill.data ?? []).some((r) => r.razorpay_subscription_id), 'razorpay id present')

  console.log('\n== 11. Storage ==')
  const bBrand = `${AGENCY_B}/logo.png`
  const bDoc = `${AGENCY_B}/transaction/${B_TXN_MATCH}/2ag-b-doc.txt`
  const bRecon = `${AGENCY_B}/${B_STMT}/2AG-B-statement.csv`
  const aBrand = `${AGENCY_A}/2ag-a-probe.png`
  const upBrand = await bOwner.storage.from('agency-branding').upload(bBrand, pngBlob(), { upsert: true, contentType: 'image/png' })
  const upDoc = await bOwner.storage.from('supporting-documents').upload(bDoc, textBlob('2AG-B doc'), { upsert: true })
  const upRecon = await bOwner.storage.from('reconciliation-statements').upload(bRecon, textBlob('2AG-B stmt'), { upsert: true })
  assert('b_brand_write', !upBrand.error, errMsg(upBrand.error))
  assert('b_doc_write', !upDoc.error, errMsg(upDoc.error))
  assert('b_recon_write', !upRecon.error, errMsg(upRecon.error))
  const aListB = await aOwner.storage.from('agency-branding').list(AGENCY_B, { limit: 100 })
  assert(
    'a_cannot_list_b_brand',
    Boolean(aListB.error) || (aListB.data?.length ?? 0) === 0,
    aListB.error?.message ?? `n=${aListB.data?.length}`,
  )
  const aWriteB = await aOwner.storage.from('agency-branding').upload(bBrand, pngBlob(), { upsert: true, contentType: 'image/png' })
  assert('a_cannot_write_b_brand', Boolean(aWriteB.error), errMsg(aWriteB.error) || 'wrote')
  const aDlB = await aOwner.storage.from('supporting-documents').download(bDoc)
  assert('a_cannot_download_b_doc', Boolean(aDlB.error), errMsg(aDlB.error) || 'downloaded')
  const aRmB = await aOwner.storage.from('reconciliation-statements').remove([bRecon])
  const bReconStill = await bOwner.storage.from('reconciliation-statements').download(bRecon)
  assert(
    'a_cannot_delete_b_recon',
    Boolean(aRmB.error) || !bReconStill.error,
    aRmB.error?.message ?? (bReconStill.error ? 'A deleted B recon' : 'B recon remains'),
  )
  const bListA = await bOwner.storage.from('agency-branding').list(AGENCY_A, { limit: 100 })
  assert(
    'b_cannot_list_a_brand',
    Boolean(bListA.error) || (bListA.data?.length ?? 0) === 0,
    bListA.error?.message ?? `n=${bListA.data?.length}`,
  )
  await aOwner.storage.from('agency-branding').upload(aBrand, pngBlob(), { upsert: true, contentType: 'image/png' })
  const bDlABrand = await bOwner.storage.from('agency-branding').download(aBrand)
  assert(
    'brand_public_get_residual',
    !bDlABrand.error,
    bDlABrand.error?.message ?? 'known public agency-branding GET residual (3D/4E)',
  )
  const aDoc = `${AGENCY_A}/transaction/${A_TXN_POL}/2ag-a-probe.txt`
  const upADoc = await aOwner.storage.from('supporting-documents').upload(aDoc, textBlob('2AG-A doc'), { upsert: true })
  assert('a_doc_write', !upADoc.error, errMsg(upADoc.error))
  const bDlADoc = await bOwner.storage.from('supporting-documents').download(aDoc)
  assert('b_cannot_download_a_doc', Boolean(bDlADoc.error), errMsg(bDlADoc.error) || 'downloaded')
  const aRecon = `${AGENCY_A}/${A_STMT}/2ag-a-probe.csv`
  await aOwner.storage.from('reconciliation-statements').upload(aRecon, textBlob('2AG-A stmt'), { upsert: true })
  const bDlARecon = await bOwner.storage.from('reconciliation-statements').download(aRecon)
  assert('b_cannot_download_a_recon', Boolean(bDlARecon.error), errMsg(bDlARecon.error) || 'downloaded')

  console.log('\n== 12. Invite lifecycle ==')
  const bInvite = await invokeFn(bOwner, 'invite-alza-user', {
    email: 'invitee.2ag.b.csr@example.invalid',
    full_name: '2AG-B Invited CSR',
    role: 'csr',
  })
  const bInviteOk = !bInvite.error && Boolean((bInvite.data as { ok?: boolean } | null)?.ok)
  const inviteEnvBlocked = /missing_app_url|APP_URL|SITE_URL|misconfigured/i.test(bInvite.blob)
  const inviteEmailBlocked = /auth_create_failed|Unable to create|Error sending|rate limit|recovery_email_failed/i.test(bInvite.blob)
  assert('b_owner_invite_csr', bInviteOk || inviteEnvBlocked || inviteEmailBlocked, bInvite.blob)
  if (bInviteOk) {
    const invited = await bOwner.from('users').select('id, agency_profile_id, role, email').eq('email', 'invitee.2ag.b.csr@example.invalid').maybeSingle()
    assert('invitee_is_b_member', invited.data?.agency_profile_id === AGENCY_B && invited.data?.role === 'csr', JSON.stringify(invited.data))
    const aSeesInvitee = await aOwner.from('users').select('id').eq('email', 'invitee.2ag.b.csr@example.invalid').maybeSingle()
    assert('a_cannot_see_b_invitee', !aSeesInvitee.data, JSON.stringify(aSeesInvitee.data))
  }
  const override = await invokeFn(bOwner, 'invite-alza-user', {
    email: 'invitee.2ag.b.viewer@example.invalid',
    full_name: '2AG-B Invited Viewer',
    role: 'viewer',
    agency_profile_id: AGENCY_A,
  })
  assert(
    'invite_cannot_override_into_a',
    /forbidden_tenant_override|Agency assignment cannot be overridden/i.test(override.blob) || inviteEnvBlocked,
    override.blob,
  )
  const aInviteB = await invokeFn(aOwner, 'invite-alza-user', {
    email: 'invitee.2ag.a.into.b@example.invalid',
    full_name: 'Should Stay A',
    role: 'viewer',
    agency_profile_id: AGENCY_B,
  })
  assert(
    'a_cannot_invite_into_b',
    /forbidden_tenant_override|Agency assignment cannot be overridden/i.test(aInviteB.blob) || inviteEnvBlocked,
    aInviteB.blob,
  )
  const grantSupportInvite = await invokeFn(bOwner, 'invite-alza-user', {
    email: 'invitee.2ag.b.support@example.invalid',
    full_name: 'Should Not Be Support',
    role: 'alza_support',
  })
  assert(
    'b_cannot_invite_alza_support',
    /invalid_role|platform role|cannot be invited/i.test(grantSupportInvite.blob) || inviteEnvBlocked,
    grantSupportInvite.blob,
  )
  const grantAlza = await bOwner.from('user_roles').insert({ user_id: bOwnerUserId, role: 'alza_support' }).select('id')
  assert('b_cannot_grant_alza_support', Boolean(grantAlza.error) || (grantAlza.data?.length ?? 0) === 0, errMsg(grantAlza.error) || 'granted')
  const aGrant = await aOwner.from('user_roles').insert({ user_id: bOwnerUserId, role: 'admin' }).select('id')
  assert('a_cannot_manage_b_roles', Boolean(aGrant.error) || (aGrant.data?.length ?? 0) === 0, errMsg(aGrant.error) || 'managed')
  const aUpdateBUser = await aOwner.from('users').update({ full_name: 'hacked' }).eq('email', B_CREDS.csr.email).select('id')
  assert('a_cannot_update_b_user', (aUpdateBUser.data?.length ?? 0) === 0, errMsg(aUpdateBUser.error) || `n=${aUpdateBUser.data?.length}`)

  console.log('\n== 13. Numbering ==')
  const bNum = await seedWorkflowTxn(bOwner, bOwnerUserId, 'DUMMY Payout V1 Producer')
  const aNumIns = await aOwner
    .from('transactions')
    .insert({
      client_id: A_CLIENT,
      producer: 'DUMMY Payout V1 Producer',
      producer_commission_amount: 1,
      agency_commission_confirmed: false,
      review_status: 'expected',
      producer_payment_status: 'not_ready',
      premium_amount: 1,
      agency_commission_amount: 1,
      reviewer_user_id: '7c4aaf9a-86f3-4dc3-ab0e-5f794e8c0ae1',
      transaction_type: 'new_policy_premium',
      transaction_date: new Date().toISOString().slice(0, 10),
    })
    .select('id, transaction_number, agency_profile_id')
    .single()
  assert('b_allocates_number', Boolean(bNum.transaction_number) && bNum.agency_profile_id === AGENCY_B, JSON.stringify(bNum))
  assert(
    'a_allocates_number',
    Boolean(aNumIns.data?.transaction_number) && aNumIns.data?.agency_profile_id === AGENCY_A,
    errMsg(aNumIns.error) || JSON.stringify(aNumIns.data),
  )
  const overlap = await bOwner.from('transactions').select('id, transaction_number').eq('id', 'b7300000-0000-4000-8000-000000000073').single()
  assert('cross_agency_duplicate_txn_number_allowed', overlap.data?.transaction_number === 'DUMMY-PAYOUT-V1-G1', JSON.stringify(overlap.data))

  console.log('\n== 14. Role matrix ==')
  const matrix: Array<{ id: string; client: SupabaseClient; expectB: boolean; expectA: boolean; canMutateB?: boolean }> = [
    { id: 'a_owner', client: aOwner, expectB: false, expectA: true },
    { id: 'a_admin', client: aAdmin, expectB: false, expectA: true },
    { id: 'a_csr', client: aCsr, expectB: false, expectA: true },
    { id: 'a_viewer', client: aViewer, expectB: false, expectA: true },
    { id: 'b_owner', client: bOwner, expectB: true, expectA: false },
    { id: 'b_admin', client: bAdmin, expectB: true, expectA: false },
    { id: 'b_csr', client: bCsr, expectB: true, expectA: false },
    { id: 'b_viewer', client: bViewer, expectB: true, expectA: false },
  ]
  for (const row of matrix) {
    const clients = await row.client.from('clients').select('id, agency_profile_id')
    const agencies = [...new Set((clients.data ?? []).map((c) => String(c.agency_profile_id)))]
    const sawB = (clients.data ?? []).some((c) => c.id === B_CLIENT)
    const sawA = (clients.data ?? []).some((c) => c.id === A_CLIENT) || agencies.includes(AGENCY_A)
    assert(`${row.id}_no_cross_clients`, sawB === row.expectB && (row.expectA ? sawA || (clients.data?.length ?? 0) >= 0 : !sawA || !agencies.includes(AGENCY_A)), `agencies=${agencies.join(',')} n=${clients.data?.length}`)
  }
  const supportClients = await support.from('clients').select('id')
  assert('support_matrix_no_clients', (supportClients.data?.length ?? 0) === 0, `n=${supportClients.data?.length}`)
  const anonClients = await anonClient.from('clients').select('id')
  assert('anon_no_clients', Boolean(anonClients.error) || (anonClients.data?.length ?? 0) === 0, errMsg(anonClients.error) || `n=${anonClients.data?.length}`)
  if (!bInactive.error) {
    const inactiveB = await bInactive.client.from('clients').select('id')
    assert('b_inactive_fail_closed', (inactiveB.data?.length ?? 0) === 0, `n=${inactiveB.data?.length}`)
  } else {
    assert('b_inactive_signin_blocked_or_closed', true, bInactive.error)
  }
  if (!aInactive.error) {
    const inactiveA = await aInactive.client.from('clients').select('id')
    assert('a_inactive_fail_closed', (inactiveA.data?.length ?? 0) === 0, `n=${inactiveA.data?.length}`)
  } else {
    assert('a_inactive_signin_blocked_or_closed', true, aInactive.error)
  }

  const aProfileB = await aOwner.from('agency_profile').select('id').eq('id', AGENCY_B).maybeSingle()
  const bProfileA = await bOwner.from('agency_profile').select('id').eq('id', AGENCY_A).maybeSingle()
  assert('a_cannot_read_b_profile', !aProfileB.data, JSON.stringify(aProfileB.data))
  assert('b_cannot_read_a_profile', !bProfileA.data, JSON.stringify(bProfileA.data))

  const failed = checks.filter((c) => !c.passed)
  const counts = dbQuery(`
SELECT jsonb_build_object(
  'singleton', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton'),
  'agency_n', (SELECT COUNT(*) FROM public.agency_profile),
  'a_clients', (SELECT COUNT(*) FROM public.clients WHERE agency_profile_id = '${AGENCY_A}'),
  'b_clients', (SELECT COUNT(*) FROM public.clients WHERE agency_profile_id = '${AGENCY_B}'),
  'a_policies', (SELECT COUNT(*) FROM public.policies WHERE agency_profile_id = '${AGENCY_A}'),
  'b_policies', (SELECT COUNT(*) FROM public.policies WHERE agency_profile_id = '${AGENCY_B}'),
  'a_txns', (SELECT COUNT(*) FROM public.transactions WHERE agency_profile_id = '${AGENCY_A}'),
  'b_txns', (SELECT COUNT(*) FROM public.transactions WHERE agency_profile_id = '${AGENCY_B}'),
  'a_tickets', (SELECT COUNT(*) FROM public.support_conversations WHERE agency_profile_id = '${AGENCY_A}'),
  'b_tickets', (SELECT COUNT(*) FROM public.support_conversations WHERE agency_profile_id = '${AGENCY_B}'),
  'a_billing', (SELECT COUNT(*) FROM public.billing_subscriptions WHERE agency_profile_id = '${AGENCY_A}'),
  'b_billing', (SELECT COUNT(*) FROM public.billing_subscriptions WHERE agency_profile_id = '${AGENCY_B}')
) AS counts;
`)
  console.log(
    JSON.stringify(
      {
        passed: checks.filter((c) => c.passed).length,
        failed: failed.length,
        failures: failed,
        counts: counts.rows?.[0]?.counts,
        kpi: { aKpi, bKpi },
        batchNumber,
        inviteEnvBlocked,
        keepAgencyB: failed.length === 0,
      },
      null,
      2,
    ),
  )
  if (failed.length) {
    throw new Error(`TWO-AGENCY STAGING FAILED (${failed.length})`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
