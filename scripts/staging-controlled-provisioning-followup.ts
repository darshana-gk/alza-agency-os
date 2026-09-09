/**
 * STAGING ONLY follow-up: resend, existing Auth email, receipts/recoveries, storage.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const AGENCY = '022cfd8d-870d-4c4d-a218-5c0ceb870e65'
const OWNER_USER = '66def847-4cc7-4eaf-997d-d5fd630cbf95'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const SUPPORT = { email: 'alza.support.staging@example.invalid', password: 'StagingTest!SupportV1-2026' }
const OWNER_A = { email: 'owner.payout.v1@example.invalid', password: 'StagingTest!PayoutV1-2026' }
const NEW_OWNER = { email: 'owner.provision.v1.1788940430548@example.com', password: 'StagingTest!ProvisionV1-2026' }

function dbQuery(sql: string) {
  const path = resolve('tmp-provision-followup.sql')
  writeFileSync(path, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${path}`, {
    encoding: 'utf8',
  })
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(captured.slice(0, 400))
  return JSON.parse(captured.slice(start, end + 1)) as { rows?: Array<Record<string, unknown>> }
}

function loadKeys() {
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, { encoding: 'utf8' })
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
  return { url: `https://${STAGING_REF}.supabase.co`, anon, service }
}

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(error.message)
  return c
}

async function invoke(client: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const res = await client.functions.invoke('provision-alza-customer', { body })
  let payload: unknown = res.data
  const anyErr = res.error as { message?: string; context?: Response } | null
  if (anyErr?.context) {
    try {
      payload = JSON.parse(await (anyErr.context as Response).text())
    } catch {
      /* ignore */
    }
  }
  return `${anyErr?.message ?? ''} ${JSON.stringify(payload)}`
}

async function main() {
  const { url, anon, service } = loadKeys()
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const support = await signIn(url, anon, SUPPORT)
  const ownerA = await signIn(url, anon, OWNER_A)
  const ownerN = await signIn(url, anon, NEW_OWNER)

  dbQuery(`UPDATE public.users SET invite_status = 'pending' WHERE id = '${OWNER_USER}'::uuid; SELECT invite_status FROM public.users WHERE id = '${OWNER_USER}'::uuid;`)
  const resend = await invoke(support, { action: 'resend', owner_user_id: OWNER_USER })
  const counts = dbQuery(`
    SELECT
      (SELECT count(*)::int FROM public.users WHERE lower(email) = '${NEW_OWNER.email}') AS users,
      (SELECT count(*)::int FROM auth.users WHERE lower(email) = '${NEW_OWNER.email}') AS auth,
      (SELECT count(*)::int FROM public.agency_profile WHERE id = '${AGENCY}'::uuid) AS agencies,
      (SELECT invite_status FROM public.users WHERE id = '${OWNER_USER}'::uuid) AS invite_status;
  `)
  console.log('RESEND', resend.slice(0, 300))
  console.log('RESEND_COUNTS', JSON.stringify(counts.rows?.[0]))

  const stamp = Date.now()
  const authEmail = `auth.only.provision.${stamp}@example.com`
  const linked = await admin.auth.admin.generateLink({
    type: 'invite',
    email: authEmail,
    options: { redirectTo: 'https://alza-flow-staging.vercel.app/auth/set-password' },
  })
  const dupAuth = await invoke(support, {
    action: 'create',
    agency_name: `Auth Only ${stamp}`,
    agency_email: `agency.auth.only.${stamp}@example.com`,
    owner_first_name: 'Auth',
    owner_last_name: 'Only',
    owner_email: authEmail,
    intended_plan: 'users_1_3',
    billing_interval: 'monthly',
  })
  if (linked.data.user?.id) await admin.auth.admin.deleteUser(linked.data.user.id)
  const leftover = dbQuery(`
    SELECT
      (SELECT count(*)::int FROM public.users WHERE lower(email) = '${authEmail}') AS users,
      (SELECT count(*)::int FROM public.agency_profile WHERE lower(email) = 'agency.auth.only.${stamp}@example.com') AS agencies;
  `)
  console.log('DUP_AUTH', dupAuth.slice(0, 300))
  console.log('DUP_AUTH_LEFTOVER', JSON.stringify(leftover.rows?.[0]))

  const receiptsA = await ownerA.from('agency_commission_receipts').select('id, agency_profile_id').eq('agency_profile_id', AGENCY)
  const receiptsN = await ownerN.from('agency_commission_receipts').select('id, agency_profile_id').eq('agency_profile_id', AGENCY_A)
  const recA = await ownerA.from('producer_commission_recoveries').select('id, agency_profile_id').eq('agency_profile_id', AGENCY)
  const recN = await ownerN.from('producer_commission_recoveries').select('id, agency_profile_id').eq('agency_profile_id', AGENCY_A)
  console.log('RECEIPTS', receiptsA.error?.message ?? receiptsA.data?.length, receiptsN.error?.message ?? receiptsN.data?.length)
  console.log('RECOVERIES', recA.error?.message ?? recA.data?.length, recN.error?.message ?? recN.data?.length)

  const supportTickets = await support.from('support_conversations').select('id, agency_profile_id')
  const aTickets = await ownerA.from('support_conversations').select('id, agency_profile_id')
  const nTickets = await ownerN.from('support_conversations').select('id, agency_profile_id')
  console.log('SUPPORT_TICKETS', {
    support: supportTickets.error?.message ?? supportTickets.data?.length,
    a: aTickets.data?.length,
    n: nTickets.data?.length,
    aHasN: (aTickets.data ?? []).some((r) => r.agency_profile_id === AGENCY),
    nHasA: (nTickets.data ?? []).some((r) => r.agency_profile_id === AGENCY_A),
    supportAgencies: [...new Set((supportTickets.data ?? []).map((r) => r.agency_profile_id))],
  })

  const aList = await ownerA.storage.from('agency-branding').list(AGENCY, { limit: 20 })
  const nList = await ownerN.storage.from('agency-branding').list(AGENCY_A, { limit: 20 })
  const aWrite = await ownerA.storage.from('agency-branding').upload(`${AGENCY}/cross-should-fail.txt`, new Blob(['no']), { upsert: true })
  const nWrite = await ownerN.storage.from('agency-branding').upload(`${AGENCY_A}/cross-should-fail.txt`, new Blob(['no']), { upsert: true })
  console.log('STORAGE', {
    aList: aList.error?.message ?? aList.data?.length,
    nList: nList.error?.message ?? nList.data?.length,
    aWrite: aWrite.error?.message ?? 'uploaded',
    nWrite: nWrite.error?.message ?? 'uploaded',
  })

  dbQuery(`UPDATE public.users SET invite_status = 'accepted' WHERE id = '${OWNER_USER}'::uuid; SELECT invite_status FROM public.users WHERE id = '${OWNER_USER}'::uuid;`)
  const audit = dbQuery(`
    SELECT action, count(*)::int AS n
    FROM public.activity_history
    WHERE agency_profile_id = '${AGENCY}'::uuid
    GROUP BY action
    ORDER BY action;
  `)
  console.log('AUDIT', JSON.stringify(audit.rows))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
