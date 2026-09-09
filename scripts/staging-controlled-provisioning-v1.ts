/**
 * STAGING ONLY — controlled customer provisioning V1.
 * Target: uzckhxpqnipnovplohpf. Aborts on Production.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const SUPPORT_EMAIL = 'alza.support.staging@example.invalid'
const SUPPORT_PASSWORD = 'StagingTest!SupportV1-2026'
const OWNER_A = { email: 'owner.payout.v1@example.invalid', password: 'StagingTest!PayoutV1-2026' }
const CSR_A = { email: 'csr.payout.v1@example.invalid', password: 'StagingTest!PayoutV1-2026' }
const PRODUCER_A = { email: 'producer.payout.v1@example.invalid', password: 'StagingTest!PayoutV1-2026' }
const STAMP = Date.now()
const NEW_AGENCY_EMAIL = `agency.provision.v1.${STAMP}@example.com`
const NEW_OWNER_EMAIL = `owner.provision.v1.${STAMP}@example.com`
const NEW_AGENCY_NAME = `ALZA Provision V1 Disposable ${STAMP}`
const TEST_PASSWORD = 'StagingTest!ProvisionV1-2026'

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []
const report: Record<string, unknown> = {}

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}

function dbQuery(sql: string, file = 'tmp-provision-query.sql') {
  const path = resolve(file)
  writeFileSync(path, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${path}`, {
    encoding: 'utf8',
  })
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON in db query: ${captured.slice(0, 500)}`)
  return JSON.parse(captured.slice(start, end + 1)) as { rows?: Array<Record<string, unknown>> }
}

function loadKeys() {
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
  if (url.includes(PRODUCTION_REF)) throw new Error('ABORT: production URL')
  return { url, anon, service }
}

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`signIn ${creds.email}: ${error.message}`)
  return c
}

async function invokeFn(client: SupabaseClient, body: Record<string, unknown>) {
  const res = await client.functions.invoke('provision-alza-customer', { body })
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

function denied(blob: string) {
  return /forbidden|unauthorized|401|403|Only platform|permission|not allowed|denied/i.test(blob)
}

async function countEq(client: SupabaseClient, table: string, agencyId: string) {
  const { data, error } = await client.from(table).select('id').eq('agency_profile_id', agencyId)
  if (error) return { n: -1, error: error.message }
  return { n: data?.length ?? 0, error: null as string | null }
}

async function main() {
  const refPath = [
    resolve('supabase/.temp/project-ref'),
    resolve('../alza-agency-os/supabase/.temp/project-ref'),
  ].find((p) => {
    try {
      return readFileSync(p, 'utf8').trim().length > 0
    } catch {
      return false
    }
  })
  if (!refPath) throw new Error('ABORT: missing linked project-ref')
  const linked = readFileSync(refPath, 'utf8').trim()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) {
    throw new Error(`ABORT: linked project is ${linked}`)
  }

  const before = dbQuery(`
    SELECT
      (SELECT count(*) FROM public.agency_profile) AS agencies,
      (SELECT count(*) FROM public.agency_profile WHERE id = '${AGENCY_A}') AS agency_a,
      (SELECT singleton_key FROM public.agency_profile WHERE id = '${AGENCY_A}') AS a_singleton,
      (SELECT agency_name FROM public.agency_profile WHERE id = '${AGENCY_A}') AS a_name,
      (SELECT count(*) FROM public.clients WHERE agency_profile_id = '${AGENCY_A}') AS a_clients,
      (SELECT count(*) FROM public.policies WHERE agency_profile_id = '${AGENCY_A}') AS a_policies,
      (SELECT count(*) FROM public.transactions WHERE agency_profile_id = '${AGENCY_A}') AS a_txns,
      (SELECT count(*) FROM public.billing_subscriptions WHERE agency_profile_id = '${AGENCY_A}') AS a_billing,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_profile_singleton') AS singleton;
  `)
  const snap = before.rows?.[0] ?? {}
  report.tenant1_before = snap
  assert('singleton_absent', snap.singleton === false, `singleton_present=${snap.singleton}`)
  assert('tenant1_present', Number(snap.agency_a) === 1, JSON.stringify(snap))

  const { url, anon, service } = loadKeys()
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const support = await signIn(url, anon, { email: SUPPORT_EMAIL, password: SUPPORT_PASSWORD })
  const ownerA = await signIn(url, anon, OWNER_A)
  const csrA = await signIn(url, anon, CSR_A)
  const producerA = await signIn(url, anon, PRODUCER_A)
  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })

  const anonCall = await invokeFn(anonClient, { action: 'list' })
  assert('anon_denied', denied(anonCall.blob), anonCall.blob.slice(0, 240))

  const ownerCall = await invokeFn(ownerA, { action: 'list' })
  assert('owner_denied', denied(ownerCall.blob), ownerCall.blob.slice(0, 240))

  const csrCall = await invokeFn(csrA, { action: 'list' })
  assert('csr_denied', denied(csrCall.blob), csrCall.blob.slice(0, 240))

  const producerCall = await invokeFn(producerA, { action: 'list' })
  assert('producer_denied', denied(producerCall.blob), producerCall.blob.slice(0, 240))

  const missing = await invokeFn(support, {
    action: 'create',
    agency_name: '',
    agency_email: NEW_AGENCY_EMAIL,
    owner_first_name: 'Prov',
    owner_last_name: 'Owner',
    owner_email: NEW_OWNER_EMAIL,
  })
  assert('missing_field', /missing_field|required/i.test(missing.blob), missing.blob.slice(0, 240))

  const badEmail = await invokeFn(support, {
    action: 'create',
    agency_name: 'Bad Email Agency',
    agency_email: 'not-an-email',
    owner_first_name: 'Prov',
    owner_last_name: 'Owner',
    owner_email: NEW_OWNER_EMAIL,
  })
  assert('malformed_email', /invalid_email|valid/i.test(badEmail.blob), badEmail.blob.slice(0, 240))

  const created = await invokeFn(support, {
    action: 'create',
    agency_name: NEW_AGENCY_NAME,
    agency_email: NEW_AGENCY_EMAIL,
    agency_phone: '555-0100',
    website: 'https://example.invalid',
    owner_first_name: 'Provision',
    owner_last_name: 'Owner',
    owner_email: NEW_OWNER_EMAIL,
    intended_plan: 'users_1_3',
    billing_interval: 'monthly',
  })
  const createdObj = (created.data ?? {}) as Record<string, unknown>
  const result = (createdObj.result ?? {}) as Record<string, unknown>
  const agencyId = String(result.agency_id ?? '')
  const ownerUserId = String(result.owner_user_id ?? '')
  report.create = { blob: created.blob.slice(0, 800), agencyId, ownerUserId, redirect: createdObj.redirect_to }
  assert('agency_created', createdObj.agency_created === true && Boolean(agencyId), created.blob.slice(0, 400))
  if (!agencyId) {
    writeFileSync(resolve('tmp-provision-v1-report.json'), JSON.stringify({ ...report, checks }, null, 2), 'utf8')
    throw new Error('create failed; stopping before further invites')
  }
  assert('owner_invited', createdObj.owner_invited === true && createdObj.invite_status === 'pending', created.blob.slice(0, 240))
  assert(
    'redirect_set_password',
    String(createdObj.redirect_to ?? '').endsWith('/auth/set-password'),
    String(createdObj.redirect_to ?? ''),
  )

  const listed = await invokeFn(support, { action: 'list' })
  const agencies = ((listed.data as { agencies?: Array<Record<string, unknown>> })?.agencies ?? []) as Array<Record<string, unknown>>
  const listedNew = agencies.find((row) => String(row.id) === agencyId)
  assert('directory_lists_new', Boolean(listedNew?.owner_email), JSON.stringify(listedNew ?? listed.blob.slice(0, 200)))
  assert(
    'directory_no_financials',
    listed.blob.includes('agency_name') && !/premium_amount|commission|receipt_amount/i.test(listed.blob),
    'directory payload has no financial columns',
  )

  const dupOwner = await invokeFn(support, {
    action: 'create',
    agency_name: `${NEW_AGENCY_NAME} retry`,
    agency_email: `agency.retry.${STAMP}@example.com`,
    owner_first_name: 'Provision',
    owner_last_name: 'Owner',
    owner_email: NEW_OWNER_EMAIL,
    intended_plan: 'users_1_3',
    billing_interval: 'monthly',
  })
  assert('duplicate_owner', /duplicate_owner_email|already exists/i.test(dupOwner.blob), dupOwner.blob.slice(0, 240))

  const dupAgency = await invokeFn(support, {
    action: 'create',
    agency_name: `${NEW_AGENCY_NAME} other`,
    agency_email: NEW_AGENCY_EMAIL,
    owner_first_name: 'Other',
    owner_last_name: 'Owner',
    owner_email: `owner.retry.agency.${STAMP}@example.com`,
    intended_plan: 'users_1_3',
    billing_interval: 'monthly',
  })
  assert('duplicate_agency_email', /duplicate_agency_email|already exists/i.test(dupAgency.blob), dupAgency.blob.slice(0, 240))

  const dupAuth = await invokeFn(support, {
    action: 'create',
    agency_name: `${NEW_AGENCY_NAME} auth`,
    agency_email: `agency.auth.${STAMP}@example.com`,
    owner_first_name: 'Auth',
    owner_last_name: 'Dup',
    owner_email: NEW_OWNER_EMAIL,
    intended_plan: 'users_1_3',
    billing_interval: 'monthly',
  })
  assert('existing_auth_or_owner_blocked', /duplicate_owner_email|duplicate_auth_email|already/i.test(dupAuth.blob), dupAuth.blob.slice(0, 240))

  const orphanAuthEmail = `orphan.provision.v1.${STAMP}@example.com`
  const invitedOrphan = await admin.auth.admin.generateLink({
    type: 'invite',
    email: orphanAuthEmail,
    options: { redirectTo: 'https://example.com/auth/set-password' },
  })
  let rpcBlob = ''
  try {
    const rpcFail = dbQuery(`
      SELECT public.provision_alza_customer(
        '6f85d300-8ef3-48b3-9da3-4b27c35caacf'::uuid,
        '${invitedOrphan.data.user?.id ?? '00000000-0000-4000-8000-000000000000'}'::uuid,
        'Orphan Should Fail',
        '${NEW_AGENCY_EMAIL}',
        NULL, NULL,
        'Orphan', 'Fail',
        '${orphanAuthEmail}',
        'users_1_3',
        'monthly'
      );
    `)
    rpcBlob = JSON.stringify(rpcFail)
  } catch (err) {
    rpcBlob = err instanceof Error ? err.message : String(err)
  }
  const deleted = invitedOrphan.data.user?.id
    ? await admin.auth.admin.deleteUser(invitedOrphan.data.user.id)
    : { error: { message: 'no auth user' } }
  const leftoverUsers = dbQuery(`
    SELECT count(*)::int AS n FROM public.users WHERE lower(email) = '${orphanAuthEmail}';
  `)
  const leftoverAgency = dbQuery(`
    SELECT count(*)::int AS n FROM public.agency_profile WHERE lower(agency_name) = 'orphan should fail';
  `)
  assert(
    'compensation_no_orphan',
    /already exists|Agency email/i.test(rpcBlob) && !deleted.error && Number(leftoverUsers.rows?.[0]?.n) === 0 && Number(leftoverAgency.rows?.[0]?.n) === 0,
    `rpc=${rpcBlob.slice(0, 180)} delete=${deleted.error?.message ?? 'ok'} users=${leftoverUsers.rows?.[0]?.n}`,
  )

  const retry = await invokeFn(support, {
    action: 'create',
    agency_name: NEW_AGENCY_NAME,
    agency_email: NEW_AGENCY_EMAIL,
    owner_first_name: 'Provision',
    owner_last_name: 'Owner',
    owner_email: NEW_OWNER_EMAIL,
    intended_plan: 'users_1_3',
    billing_interval: 'monthly',
  })
  const agencyCount = dbQuery(`
    SELECT count(*)::int AS n FROM public.agency_profile WHERE lower(email) = '${NEW_AGENCY_EMAIL}';
  `)
  assert('retry_no_duplicate_agency', /already exists/i.test(retry.blob) && Number(agencyCount.rows?.[0]?.n) === 1, retry.blob.slice(0, 200))

  const row = dbQuery(`
    SELECT
      ap.id::text,
      ap.agency_name,
      ap.email,
      ap.singleton_key,
      u.id::text AS owner_id,
      u.email AS owner_email,
      u.role,
      u.status,
      u.invite_status,
      u.agency_profile_id::text,
      (SELECT count(*)::int FROM public.user_roles ur WHERE ur.user_id = u.id AND lower(ur.role) = 'owner') AS owner_roles,
      (SELECT count(*)::int FROM public.user_roles ur WHERE ur.user_id = u.id AND lower(ur.role) <> 'owner') AS other_roles,
      (SELECT count(*)::int FROM public.clients c WHERE c.agency_profile_id = ap.id) AS clients,
      (SELECT count(*)::int FROM public.policies p WHERE p.agency_profile_id = ap.id) AS policies,
      (SELECT count(*)::int FROM public.transactions t WHERE t.agency_profile_id = ap.id) AS txns,
      (SELECT count(*)::int FROM public.billing_subscriptions b WHERE b.agency_profile_id = ap.id) AS billing
    FROM public.agency_profile ap
    JOIN public.users u ON u.agency_profile_id = ap.id
    WHERE ap.id = '${agencyId}'::uuid;
  `)
  const createdRow = row.rows?.[0] ?? {}
  report.created_row = createdRow
  assert('owner_role', createdRow.role === 'owner' && Number(createdRow.owner_roles) === 1 && Number(createdRow.other_roles) === 0, JSON.stringify(createdRow))
  assert('invite_pending', createdRow.invite_status === 'pending' && createdRow.status === 'active', JSON.stringify(createdRow))
  assert('empty_tenant', Number(createdRow.clients) === 0 && Number(createdRow.policies) === 0 && Number(createdRow.txns) === 0 && Number(createdRow.billing) === 0, JSON.stringify(createdRow))
  assert('singleton_key_false_new', createdRow.singleton_key === false, JSON.stringify(createdRow))

  const authUser = await admin.auth.admin.getUserById(String((await admin.from('users').select('auth_user_id').eq('id', ownerUserId).single()).data?.auth_user_id ?? ''))
  report.auth_user = {
    id: authUser.data.user?.id ?? null,
    email: authUser.data.user?.email ?? null,
    invited_at: authUser.data.user?.invited_at ?? null,
    confirmed: authUser.data.user?.email_confirmed_at ?? null,
  }
  assert('auth_invitation_created', Boolean(authUser.data.user?.id) && Boolean(authUser.data.user?.invited_at || authUser.data.user?.confirmation_sent_at), JSON.stringify(report.auth_user))

  const resend = await invokeFn(support, { action: 'resend', owner_user_id: ownerUserId })
  const userCount = dbQuery(`SELECT count(*)::int AS n FROM public.users WHERE lower(email) = '${NEW_OWNER_EMAIL}';`)
  const authCount = dbQuery(`SELECT count(*)::int AS n FROM auth.users WHERE lower(email) = '${NEW_OWNER_EMAIL}';`)
  assert(
    'resend_no_duplicate',
    /pending|resend|redirect_to/i.test(resend.blob) && Number(userCount.rows?.[0]?.n) === 1 && Number(authCount.rows?.[0]?.n) === 1,
    resend.blob.slice(0, 240),
  )

  const link = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: NEW_OWNER_EMAIL,
    options: { redirectTo: 'https://example.invalid/auth/set-password' },
  })
  let acceptance = 'not_tested'
  if (link.data.properties?.hashed_token) {
    const ownerNew = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const verified = await ownerNew.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'recovery',
    })
    if (!verified.error) {
      const updated = await ownerNew.auth.updateUser({ password: TEST_PASSWORD })
      const accepted = await ownerNew.rpc('mark_current_user_invite_accepted')
      acceptance = !updated.error && !accepted.error ? 'pass' : `fail ${updated.error?.message ?? ''} ${accepted.error?.message ?? ''}`
    } else {
      acceptance = `verify_fail ${verified.error.message}`
    }
  } else {
    acceptance = `link_fail ${link.error?.message ?? 'no token'}`
  }
  report.invite_acceptance = acceptance
  const afterAccept = dbQuery(`SELECT invite_status FROM public.users WHERE id = '${ownerUserId}'::uuid;`)
  assert('invite_acceptance_rpc', acceptance === 'pass' && afterAccept.rows?.[0]?.invite_status === 'accepted', acceptance)

  const ownerNew = await signIn(url, anon, { email: NEW_OWNER_EMAIL, password: TEST_PASSWORD })

  const tables = [
    'agency_profile',
    'users',
    'user_roles',
    'clients',
    'policies',
    'transactions',
    'receipts',
    'reconciliation_statements',
    'reconciliation_statement_rows',
    'producer_payment_batches',
    'recoveries',
    'billing_subscriptions',
    'support_conversations',
    'support_messages',
    'activity_history',
  ]

  async function idsOf(client: SupabaseClient, table: string) {
    const col = table === 'agency_profile' ? 'id' : 'agency_profile_id'
    const { data, error } = await client.from(table).select(table === 'agency_profile' ? 'id' : 'id, agency_profile_id')
    if (error) return { error: error.message, ids: [] as string[] }
    const ids = (data ?? []).map((row) => String((row as { id?: string; agency_profile_id?: string }).agency_profile_id ?? (row as { id?: string }).id))
    return { error: null as string | null, ids, raw: data ?? [], col }
  }

  const aAgency = await ownerA.from('agency_profile').select('id')
  const nAgency = await ownerNew.from('agency_profile').select('id')
  assert('a_sees_only_a', (aAgency.data ?? []).every((r) => r.id === AGENCY_A) && (aAgency.data ?? []).length >= 1, `n=${aAgency.data?.length} err=${aAgency.error?.message ?? ''}`)
  assert('n_sees_only_n', (nAgency.data ?? []).length === 1 && nAgency.data?.[0]?.id === agencyId, JSON.stringify(nAgency.data))

  const aUsers = await ownerA.from('users').select('id, agency_profile_id')
  const nUsers = await ownerNew.from('users').select('id, agency_profile_id')
  assert('users_a_not_n', !(aUsers.data ?? []).some((r) => r.agency_profile_id === agencyId), `n=${aUsers.data?.length}`)
  assert('users_n_not_a', !(nUsers.data ?? []).some((r) => r.agency_profile_id === AGENCY_A), `n=${nUsers.data?.length}`)

  const aRoles = await ownerA.from('user_roles').select('user_id, role')
  const nRoles = await ownerNew.from('user_roles').select('user_id, role')
  const aUserIds = new Set((aUsers.data ?? []).map((r) => r.id))
  const nUserIds = new Set((nUsers.data ?? []).map((r) => r.id))
  assert('roles_a_not_n', !(aRoles.data ?? []).some((r) => nUserIds.has(r.user_id)), `n=${aRoles.data?.length}`)
  assert('roles_n_not_a', !(nRoles.data ?? []).some((r) => aUserIds.has(r.user_id)), `n=${nRoles.data?.length}`)

  for (const table of ['clients', 'policies', 'transactions', 'billing_subscriptions', 'support_conversations', 'activity_history']) {
    const a = await countEq(ownerA, table, agencyId)
    const n = await countEq(ownerNew, table, AGENCY_A)
    assert(`${table}_a_cannot_read_n`, a.n === 0, a.error ?? `n=${a.n}`)
    assert(`${table}_n_cannot_read_a`, n.n === 0, n.error ?? `n=${n.n}`)
  }

  const extraTables = ['receipts', 'reconciliation_statements', 'producer_payment_batches', 'recoveries']
  for (const table of extraTables) {
    const a = await ownerA.from(table).select('id').limit(1)
    const n = await ownerNew.from(table).select('agency_profile_id').eq('agency_profile_id', AGENCY_A)
    if (a.error && /does not exist|schema cache/i.test(a.error.message)) {
      assert(`${table}_isolation`, true, `table unavailable to client: ${a.error.message}`)
      continue
    }
    assert(`${table}_n_cannot_read_a`, !n.error && (n.data ?? []).length === 0, n.error?.message ?? `n=${n.data?.length}`)
    const aCross = await ownerA.from(table).select('id').eq('agency_profile_id', agencyId)
    assert(`${table}_a_cannot_read_n`, !aCross.error && (aCross.data ?? []).length === 0, aCross.error?.message ?? `n=${aCross.data?.length}`)
  }

  const insertClient = await ownerA.from('clients').insert({
    business_name: 'CROSS SHOULD FAIL',
    agency_profile_id: agencyId,
  }).select('id')
  assert('a_cannot_insert_n', Boolean(insertClient.error) || (insertClient.data ?? []).length === 0, insertClient.error?.message ?? 'inserted')

  const insertBack = await ownerNew.from('clients').insert({
    business_name: 'CROSS SHOULD FAIL',
    agency_profile_id: AGENCY_A,
  }).select('id')
  assert('n_cannot_insert_a', Boolean(insertBack.error) || (insertBack.data ?? []).length === 0, insertBack.error?.message ?? 'inserted')

  const supportClients = await support.from('clients').select('id')
  const supportTxn = await support.from('transactions').select('id')
  const supportReceipts = await support.from('transactions').select('id, premium_amount')
  assert('support_no_clients', (supportClients.data ?? []).length === 0, supportClients.error?.message ?? `n=${supportClients.data?.length}`)
  assert('support_no_transactions', (supportTxn.data ?? []).length === 0, supportTxn.error?.message ?? `n=${supportTxn.data?.length}`)
  assert('support_no_txn_amounts', (supportReceipts.data ?? []).length === 0, 'no financial rows via support JWT')

  const producerTxn = await producerA.from('transactions').select('id, agency_profile_id')
  assert(
    'producer_fail_closed',
    !(producerTxn.data ?? []).some((r) => r.agency_profile_id === agencyId),
    producerTxn.error?.message ?? `n=${producerTxn.data?.length}`,
  )

  const anonAgency = await anonClient.from('agency_profile').select('id')
  assert('anon_no_agency', (anonAgency.data ?? []).length === 0, anonAgency.error?.message ?? `n=${anonAgency.data?.length}`)

  const billingBefore = await ownerNew.from('billing_subscriptions').select('id, status, plan_key, razorpay_subscription_id')
  assert('billing_before_empty', (billingBefore.data ?? []).length === 0, billingBefore.error?.message ?? 'rows present')

  const activate = await invokeFn(support, {
    action: 'activate',
    agency_id: agencyId,
    user_band: 'users_1_3',
    billing_interval: 'monthly',
    period_start: '2026-09-01',
    period_end: '2026-10-01',
    external_reference: `manual-staging-${STAMP}`,
  })
  assert('manual_activate', /active|activation/i.test(activate.blob) && !/error/i.test(activate.blob) || (activate.data as { ok?: boolean })?.ok === true, activate.blob.slice(0, 300))

  const billingAfter = await ownerNew.from('billing_subscriptions').select('id, agency_profile_id, status, plan_key, user_band_key, billing_interval, razorpay_customer_id, razorpay_subscription_id, razorpay_plan_id')
  const bill = billingAfter.data?.[0]
  assert('billing_after_own', (billingAfter.data ?? []).length === 1 && bill?.status === 'active' && bill?.agency_profile_id === agencyId, JSON.stringify(billingAfter.data ?? billingAfter.error))
  assert(
    'no_fake_razorpay',
    bill?.razorpay_customer_id == null && bill?.razorpay_subscription_id == null && bill?.razorpay_plan_id == null,
    JSON.stringify(bill),
  )

  const aBillingAfter = dbQuery(`
    SELECT count(*)::int AS n, COALESCE(max(status), '') AS status
    FROM public.billing_subscriptions WHERE agency_profile_id = '${AGENCY_A}';
  `)
  assert(
    'agency_a_billing_unchanged',
    Number(aBillingAfter.rows?.[0]?.n) === Number(snap.a_billing),
    JSON.stringify({ before: snap.a_billing, after: aBillingAfter.rows?.[0] }),
  )

  const wrongActivate = await invokeFn(ownerA, {
    action: 'activate',
    agency_id: agencyId,
    user_band: 'users_1_3',
    billing_interval: 'annual',
    period_start: '2026-09-01',
    period_end: '2027-09-01',
  })
  assert('owner_cannot_activate', denied(wrongActivate.blob), wrongActivate.blob.slice(0, 200))

  const after = dbQuery(`
    SELECT
      (SELECT agency_name FROM public.agency_profile WHERE id = '${AGENCY_A}') AS a_name,
      (SELECT singleton_key FROM public.agency_profile WHERE id = '${AGENCY_A}') AS a_singleton,
      (SELECT count(*) FROM public.clients WHERE agency_profile_id = '${AGENCY_A}') AS a_clients,
      (SELECT count(*) FROM public.policies WHERE agency_profile_id = '${AGENCY_A}') AS a_policies,
      (SELECT count(*) FROM public.transactions WHERE agency_profile_id = '${AGENCY_A}') AS a_txns;
  `)
  const afterRow = after.rows?.[0] ?? {}
  report.tenant1_after = afterRow
  assert(
    'tenant1_unchanged',
    afterRow.a_name === snap.a_name &&
      afterRow.a_singleton === snap.a_singleton &&
      Number(afterRow.a_clients) === Number(snap.a_clients) &&
      Number(afterRow.a_policies) === Number(snap.a_policies) &&
      Number(afterRow.a_txns) === Number(snap.a_txns),
    JSON.stringify({ before: snap, after: afterRow }),
  )

  const synthetic = dbQuery(`
    SELECT count(*)::int AS n
    FROM public.transactions
    WHERE agency_profile_id = '${agencyId}'::uuid;
  `)
  report.synthetic_transactions = synthetic.rows?.[0]?.n
  report.agency_id = agencyId
  report.owner_email = NEW_OWNER_EMAIL
  report.invite_delivery = 'NOT CONFIRMED'
  report.email_mechanism = 'supabase.auth.admin.inviteUserByEmail'
  report.resend_dependency = 'NO — Auth invite/recovery, not Resend'

  const failed = checks.filter((c) => !c.passed)
  report.pass = failed.length
  report.total = checks.length
  report.failed = failed
  writeFileSync(resolve('tmp-provision-v1-report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nCHECKS ${checks.length - failed.length}/${checks.length}`)
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
