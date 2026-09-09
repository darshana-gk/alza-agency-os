/**
 * STAGING ONLY. Narrow workspace-access RPC vs existing roles.
 * Restores any billing row it changes. Does not print payment fields.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AGENCY_B = '022cfd8d-870d-4c4d-a218-5c0ceb870e65'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const SUPPORT = { email: 'alza.support.staging@example.invalid', password: 'StagingTest!SupportV1-2026' }
const ROLES = {
  owner: 'owner.payout.v1@example.invalid',
  admin: 'admin.role.payout.v1@example.invalid',
  csr: 'csr.payout.v1@example.invalid',
  producer: 'producer.payout.v1@example.invalid',
  viewer: 'viewer.payout.v1@example.invalid',
}

function dbQuery(sql: string) {
  const path = resolve('tmp-workspace-access-roles.sql')
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
    if (name.includes('anon') || name.includes('publishable')) anon = anon || key
    if (name.includes('service_role') || name === 'service') service = key
  }
  if (!anon || !service) throw new Error('staging keys missing')
  return { url: `https://${STAGING_REF}.supabase.co`, anon, service }
}

async function signIn(url: string, anon: string, email: string, password: string) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`${email}: ${error.message}`)
  return c
}

async function access(client: SupabaseClient) {
  const { data, error } = await client.rpc('get_my_workspace_subscription_access')
  return { data, error: error?.message ?? null }
}

function open(result: { data: unknown; error: string | null }) {
  if (result.error || !result.data || typeof result.data !== 'object') return false
  return (result.data as { access_state?: string }).access_state === 'active'
}

function reason(result: { data: unknown; error: string | null }) {
  if (result.error || !result.data || typeof result.data !== 'object') return 'error'
  return String((result.data as { reason?: string }).reason ?? '')
}

async function main() {
  const { url, anon, service } = loadKeys()
  const checks: Record<string, string> = {}
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  const before = dbQuery(`
    SELECT to_jsonb(bs) AS row
    FROM public.billing_subscriptions bs
    WHERE agency_profile_id = '${AGENCY_A}'::uuid;
  `)
  const original = (before.rows?.[0]?.row ?? null) as { id?: string; status?: string } | null
  if (!original?.id) throw new Error('agency A billing row missing')

  const sessions: Record<string, SupabaseClient> = {}
  for (const [role, email] of Object.entries(ROLES)) {
    sessions[role] = await signIn(url, anon, email, PASSWORD)
  }
  const support = await signIn(url, anon, SUPPORT.email, SUPPORT.password)

  const activeResults = await Promise.all(
    Object.entries(sessions).map(async ([role, client]) => [role, await access(client)] as const),
  )
  for (const [role, result] of activeResults) {
    checks[`${role}_active`] = open(result) ? 'PASS' : 'FAIL'
  }

  const csrBilling = await sessions.csr
    .from('billing_subscriptions')
    .select('id, razorpay_subscription_id')
    .eq('agency_profile_id', AGENCY_B)
    .maybeSingle()
  checks.csr_cannot_read_other_billing = !csrBilling.data ? 'PASS' : 'FAIL'

  const csrOwnBilling = await sessions.csr
    .from('billing_subscriptions')
    .select('status')
    .eq('agency_profile_id', AGENCY_A)
    .maybeSingle()
  checks.csr_no_direct_billing_select = !csrOwnBilling.data ? 'PASS' : 'FAIL'

  const supportRpc = await access(support)
  checks.support_rpc_denied = supportRpc.error ? 'PASS' : 'FAIL'

  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const anonRpc = await access(anonClient)
  checks.anon_denied = anonRpc.error ? 'PASS' : 'FAIL'

  async function setStatus(status: string, end: string | null) {
    const { error } = await admin
      .from('billing_subscriptions')
      .update({ status, current_period_end: end })
      .eq('id', original.id!)
    if (error) throw error
  }

  try {
    await setStatus('cancelled', '2026-12-31T00:00:00+00')
    const cancelled = await access(sessions.producer)
    checks.cancelled = reason(cancelled) === 'cancelled' && !open(cancelled) ? 'PASS' : 'FAIL'

    await setStatus('active', '2020-01-01T00:00:00+00')
    const expired = await access(sessions.csr)
    checks.expired = reason(expired) === 'expired' && !open(expired) ? 'PASS' : 'FAIL'

    await setStatus('past_due', '2026-12-31T00:00:00+00')
    const pastDue = await access(sessions.viewer)
    checks.past_due = reason(pastDue) === 'past_due' && !open(pastDue) ? 'PASS' : 'FAIL'

    await setStatus('pending', '2026-12-31T00:00:00+00')
    const pending = await access(sessions.admin)
    checks.pending = !open(pending) ? 'PASS' : 'FAIL'

    const { error: delErr } = await admin.from('billing_subscriptions').delete().eq('id', original.id!)
    if (delErr) throw delErr
    const none = await access(sessions.owner)
    const noneCsr = await access(sessions.csr)
    checks.no_row_owner = reason(none) === 'none' && !open(none) ? 'PASS' : 'FAIL'
    checks.no_row_csr = reason(noneCsr) === 'none' && !open(noneCsr) ? 'PASS' : 'FAIL'
  } finally {
    const payload = JSON.stringify(original).replace(/'/g, "''")
    dbQuery(`
      INSERT INTO public.billing_subscriptions
      SELECT * FROM jsonb_populate_record(NULL::public.billing_subscriptions, '${payload}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end;
    `)
  }

  const restored = await access(sessions.owner)
  checks.restored_owner_open = open(restored) ? 'PASS' : 'FAIL'

  const payload = JSON.stringify(restored.data)
  checks.no_payment_fields =
    !/razorpay|amount|plan_id|customer_id/i.test(payload) ? 'PASS' : 'FAIL'

  console.log(JSON.stringify({ environment: 'STAGING', checks }, null, 2))
  if (Object.values(checks).includes('FAIL')) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
