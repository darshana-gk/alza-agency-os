/** STAGING ONLY — existing Auth email must not be attached. */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const AGENCY = '022cfd8d-870d-4c4d-a218-5c0ceb870e65'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'

function dbQuery(sql: string) {
  const path = resolve('tmp-provision-auth-dup.sql')
  writeFileSync(path, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${path}`, {
    encoding: 'utf8',
  })
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
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

async function main() {
  const { url, anon, service } = loadKeys()
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const support = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await support.auth.signInWithPassword({
    email: 'alza.support.staging@example.invalid',
    password: 'StagingTest!SupportV1-2026',
  })
  if (signed.error) throw new Error(signed.error.message)

  const stamp = Date.now()
  const authEmail = `auth.only.provision.${stamp}@example.com`
  const linked = await admin.auth.admin.generateLink({
    type: 'invite',
    email: authEmail,
    options: { redirectTo: 'https://alza-flow-staging.vercel.app/auth/set-password' },
  })
  if (!linked.data.user?.id) throw new Error(linked.error?.message ?? 'no auth user')

  const res = await support.functions.invoke('provision-alza-customer', {
    body: {
      action: 'create',
      agency_name: `Auth Only ${stamp}`,
      agency_email: `agency.auth.only.${stamp}@example.com`,
      owner_first_name: 'Auth',
      owner_last_name: 'Only',
      owner_email: authEmail,
      intended_plan: 'users_1_3',
      billing_interval: 'monthly',
    },
  })
  let payload: unknown = res.data
  const anyErr = res.error as { context?: Response } | null
  if (anyErr?.context) {
    try { payload = JSON.parse(await anyErr.context.text()) } catch { /* ignore */ }
  }
  await admin.auth.admin.deleteUser(linked.data.user.id)
  const leftover = dbQuery(`
    SELECT
      (SELECT count(*)::int FROM public.users WHERE lower(email) = '${authEmail}') AS users,
      (SELECT count(*)::int FROM public.agency_profile WHERE lower(email) = 'agency.auth.only.${stamp}@example.com') AS agencies;
  `)
  console.log('DUP_AUTH', JSON.stringify(payload))
  console.log('LEFTOVER', JSON.stringify(leftover.rows?.[0]))

  const ownerA = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const ownerN = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  await ownerA.auth.signInWithPassword({ email: 'owner.payout.v1@example.invalid', password: 'StagingTest!PayoutV1-2026' })
  await ownerN.auth.signInWithPassword({ email: 'owner.provision.v1.1788940430548@example.com', password: 'StagingTest!ProvisionV1-2026' })
  const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
  const aWrite = await ownerA.storage.from('agency-branding').upload(`${AGENCY}/cross.png`, png, { upsert: true, contentType: 'image/png' })
  const nWrite = await ownerN.storage.from('agency-branding').upload(`${AGENCY_A}/cross.png`, png, { upsert: true, contentType: 'image/png' })
  const receiptsA = await ownerA.from('agency_commission_receipts').select('id').eq('agency_profile_id', AGENCY)
  const recN = await ownerN.from('producer_commission_recoveries').select('id').eq('agency_profile_id', AGENCY_A)
  console.log('STORAGE_CROSS', aWrite.error?.message ?? 'uploaded', nWrite.error?.message ?? 'uploaded')
  console.log('RECEIPT_RECOVERY', receiptsA.data?.length ?? receiptsA.error?.message, recN.data?.length ?? recN.error?.message)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
