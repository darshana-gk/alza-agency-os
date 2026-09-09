/**
 * STAGING ONLY — subscription access gate runtime checks.
 * Aborts on Production. Restores any disposable billing row it changes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateSubscriptionAccess, isAllowedWhileRestricted } from '../src/lib/subscriptionAccess.ts'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const AGENCY = '022cfd8d-870d-4c4d-a218-5c0ceb870e65'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const SUPPORT = { email: 'alza.support.staging@example.invalid', password: 'StagingTest!SupportV1-2026' }
const OWNER = { email: 'owner.provision.v1.1788940430548@example.com', password: 'StagingTest!ProvisionV1-2026' }

function dbQuery(sql: string) {
  const path = resolve('tmp-subscription-gate-staging.sql')
  writeFileSync(path, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${path}`, {
    encoding: 'utf8',
  })
  if (captured.includes(PRODUCTION_REF) && !captured.includes(STAGING_REF)) {
    throw new Error('refused: production-looking output')
  }
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(captured.slice(0, 500))
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

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword(creds)
  if (error || !data.user) throw new Error(error?.message ?? 'sign-in failed')
  return c
}

async function billingFor(client: SupabaseClient, agencyId: string) {
  return client
    .from('billing_subscriptions')
    .select('status, current_period_end')
    .eq('agency_profile_id', agencyId)
    .maybeSingle()
}

function decisionFromRow(row: { status?: string | null; current_period_end?: string | null } | null, error: boolean) {
  if (error) return { state: 'ERROR', open: false }
  if (!row) return { state: 'RESTRICTED', open: false, reason: 'none' }
  const decision = evaluateSubscriptionAccess({
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  })
  return { state: decision.open ? 'ACTIVE' : 'RESTRICTED', open: decision.open, reason: decision.reason }
}

async function main() {
  const linked = execSync('npx supabase projects list -o json', { encoding: 'utf8' })
  if (!linked.includes(STAGING_REF)) throw new Error('staging project not visible')
  const checks: Record<string, string> = {}

  const snapshot = dbQuery(`
    SELECT jsonb_build_object(
      'agency', (SELECT jsonb_build_object('id', id, 'name', agency_name) FROM public.agency_profile WHERE id = '${AGENCY}'::uuid),
      'owner', (
        SELECT jsonb_build_object('email', email, 'role', role, 'agency_profile_id', agency_profile_id, 'invite_status', invite_status)
        FROM public.users WHERE lower(email) = '${OWNER.email}'
      ),
      'billing', (
        SELECT jsonb_build_object('status', status, 'current_period_end', current_period_end, 'id', id)
        FROM public.billing_subscriptions WHERE agency_profile_id = '${AGENCY}'::uuid
      ),
      'support', (
        SELECT jsonb_build_object('role', role, 'agency_profile_id', agency_profile_id)
        FROM public.users WHERE lower(email) = '${SUPPORT.email}'
      ),
      'rls', (
        SELECT polname FROM pg_policy
        WHERE polrelid = 'public.billing_subscriptions'::regclass AND polname = 'billing_select_own_admin'
      )
    ) AS report;
  `)
  const report = (snapshot.rows?.[0]?.report ?? {}) as Record<string, unknown>
  const billingBefore = (report.billing ?? null) as { status?: string; current_period_end?: string | null; id?: string } | null
  checks.rls_policy_present = report.rls ? 'PASS' : 'FAIL'
  checks.disposable_agency = report.agency ? 'PASS' : 'FAIL'

  const { url, anon, service } = loadKeys()
  const owner = await signIn(url, anon, OWNER)
  const support = await signIn(url, anon, SUPPORT)

  const ownerProfile = await owner.from('users').select('role, agency_profile_id').eq('email', OWNER.email).maybeSingle()
  checks.owner_signin = ownerProfile.data?.agency_profile_id === AGENCY ? 'PASS' : 'FAIL'

  const none = await billingFor(owner, AGENCY)
  const noneDecision = decisionFromRow(none.data, Boolean(none.error))
  checks.no_billing_row_or_current = none.data ? `HAS_ROW:${none.data.status}` : noneDecision.state
  checks.no_row_restricted = !none.data && !none.error ? 'PASS' : none.data ? 'HAS_ROW' : 'FAIL'

  const blocked = ['/', '/clients', '/onboarding', '/admin/users', '/financials', '/notifications']
  checks.blocked_urls = blocked.every((p) => !isAllowedWhileRestricted(p)) ? 'PASS' : 'FAIL'
  checks.billing_allowed = isAllowedWhileRestricted('/admin/subscription-billing') ? 'PASS' : 'FAIL'
  checks.help_allowed = isAllowedWhileRestricted('/support') && isAllowedWhileRestricted('/help') ? 'PASS' : 'FAIL'

  const supportProfile = await support.from('users').select('role, agency_profile_id').eq('email', SUPPORT.email).maybeSingle()
  checks.support_platform = supportProfile.data?.role === 'alza_support' && supportProfile.data.agency_profile_id == null ? 'PASS' : 'FAIL'
  const supportBilling = await billingFor(support, AGENCY)
  checks.support_does_not_read_customer_billing = !supportBilling.data ? 'PASS' : 'FAIL'

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const original = billingBefore
  async function restore() {
    if (!original?.id) {
      await admin.from('billing_subscriptions').delete().eq('agency_profile_id', AGENCY)
      return
    }
    await admin
      .from('billing_subscriptions')
      .update({
        status: original.status,
        current_period_end: original.current_period_end,
      })
      .eq('id', original.id)
  }

  async function setBilling(status: string, end: string | null) {
    if (original?.id) {
      const { error } = await admin
        .from('billing_subscriptions')
        .update({ status, current_period_end: end })
        .eq('id', original.id)
      if (error) throw error
      return
    }
    const { error } = await admin.from('billing_subscriptions').insert({
      agency_profile_id: AGENCY,
      status,
      current_period_end: end,
      product_key: 'alza_flow',
    })
    if (error) throw error
  }

  try {
    await setBilling('active', '2026-12-31T00:00:00+00')
    const active = await billingFor(owner, AGENCY)
    checks.active_open = decisionFromRow(active.data, Boolean(active.error)).open ? 'PASS' : 'FAIL'

    await setBilling('active', '2020-01-01T00:00:00+00')
    const expired = await billingFor(owner, AGENCY)
    checks.active_expired = decisionFromRow(expired.data, Boolean(expired.error)).reason === 'expired' ? 'PASS' : 'FAIL'

    await setBilling('cancelled', '2026-12-31T00:00:00+00')
    const cancelled = await billingFor(owner, AGENCY)
    checks.cancelled = decisionFromRow(cancelled.data, Boolean(cancelled.error)).reason === 'cancelled' ? 'PASS' : 'FAIL'

    await setBilling('canceled', '2026-12-31T00:00:00+00')
    const canceled = await billingFor(owner, AGENCY)
    checks.canceled = decisionFromRow(canceled.data, Boolean(canceled.error)).reason === 'cancelled' ? 'PASS' : 'FAIL'

    await setBilling('past_due', '2026-12-31T00:00:00+00')
    const pastDue = await billingFor(owner, AGENCY)
    checks.past_due = decisionFromRow(pastDue.data, Boolean(pastDue.error)).reason === 'past_due' ? 'PASS' : 'FAIL'

    await setBilling('pending', '2026-12-31T00:00:00+00')
    const pending = await billingFor(owner, AGENCY)
    checks.pending = decisionFromRow(pending.data, Boolean(pending.error)).open === false ? 'PASS' : 'FAIL'

    await setBilling('active', '2026-12-31T00:00:00+00')
    const after = await billingFor(owner, AGENCY)
    checks.refetch_without_relogin = decisionFromRow(after.data, Boolean(after.error)).open ? 'PASS' : 'FAIL'
  } finally {
    await restore()
  }

  const restored = await billingFor(admin, AGENCY)
  if (!original && restored.data) checks.restore = 'FAIL'
  else if (original && restored.data?.status !== original.status) checks.restore = 'FAIL'
  else checks.restore = 'PASS'

  const other = await billingFor(owner, AGENCY_A)
  checks.other_agency_not_readable = !other.data ? 'PASS' : 'FAIL'

  console.log(JSON.stringify({ environment: 'STAGING', agency: AGENCY, checks, billingBefore }, null, 2))
  const failed = Object.entries(checks).filter(([, v]) => v === 'FAIL')
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
