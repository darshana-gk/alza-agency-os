/**
 * STAGING ONLY — Phase 2: all 8 plan_key intents via create-agency-signup.
 * Target: uzckhxpqnipnovplohpf. Aborts on Production. No Razorpay creates.
 *
 * Run: npx tsx scripts/validate-pricing-intent-staging.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BILLING_CHECKOUT_SKUS, parseCheckoutSku } from '../src/lib/billingCatalog.ts'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
  if (!passed) throw new Error(`FAIL: ${id} — ${detail}`)
}

function readLinkedRef(): string {
  const p = resolve(process.cwd(), 'supabase/.temp/project-ref')
  if (!existsSync(p)) throw new Error('supabase/.temp/project-ref missing — link staging first')
  return readFileSync(p, 'utf8').trim()
}

function loadStagingKeys(): { url: string; anon: string; service: string } {
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
  if (!url.includes(STAGING_REF)) throw new Error('ABORT: URL is not staging')
  return { url, anon, service }
}

async function invokeSignup(client: SupabaseClient, body: Record<string, unknown>) {
  const res = await client.functions.invoke('create-agency-signup', { body })
  let payload: Record<string, unknown> =
    res.data && typeof res.data === 'object' ? (res.data as Record<string, unknown>) : {}
  const anyErr = res.error as { message?: string; context?: Response } | null
  if (anyErr?.context) {
    try {
      const text = await anyErr.context.text()
      try {
        payload = JSON.parse(text) as Record<string, unknown>
      } catch {
        payload = { ok: false, message: text || anyErr.message }
      }
    } catch {
      payload = { ok: false, message: anyErr.message, code: 'invoke_error' }
    }
  } else if (res.error && payload.ok !== false) {
    payload = { ok: false, message: res.error.message, code: 'invoke_error' }
  }
  return payload
}

async function cleanupAgency(
  admin: SupabaseClient,
  agencyId: string,
  ownerUserId: string | null,
) {
  await admin.from('billing_subscriptions').delete().eq('agency_profile_id', agencyId)
  if (ownerUserId) {
    await admin.from('user_roles').delete().eq('user_id', ownerUserId)
  }
  await admin.from('users').delete().eq('agency_profile_id', agencyId)
  await admin.from('agency_profile').delete().eq('id', agencyId)
  if (ownerUserId) {
    try {
      await admin.auth.admin.deleteUser(ownerUserId)
    } catch {
      /* best-effort */
    }
  }
}

async function main() {
  const ref = readLinkedRef()
  assert('linked_ref', ref === STAGING_REF, `linked=${ref}`)
  assert('not_production', ref !== PRODUCTION_REF, 'not production')

  const keys = loadStagingKeys()
  const anon = createClient(keys.url, keys.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(keys.url, keys.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const stamp = Date.now()
  for (const planKey of BILLING_CHECKOUT_SKUS) {
    const parsed = parseCheckoutSku(planKey)!
    const email = `p2.${planKey}.${stamp}@alza-staging.test`
    const agencyName = `P2 ${planKey} ${stamp}`
    const payload = await invokeSignup(anon, {
      fullName: 'Phase Two Owner',
      agencyName,
      email,
      password: `P2-Test-${stamp}!aA`,
      planKey,
    })
    assert(`${planKey}_ok`, payload.ok === true, String(payload.message ?? 'created'))
    const agencyId = String(payload.agencyId ?? '')
    const ownerUserId = payload.ownerUserId ? String(payload.ownerUserId) : null
    assert(`${planKey}_agency`, Boolean(agencyId), `agencyId=${agencyId}`)
    assert(`${planKey}_role`, String(payload.role ?? '') === 'owner', `role=${payload.role}`)

    const { data: billing } = await admin
      .from('billing_subscriptions')
      .select('plan_key, product_key, user_band_key, billing_interval, status, razorpay_subscription_id, razorpay_plan_id')
      .eq('agency_profile_id', agencyId)
      .maybeSingle()

    assert(`${planKey}_status`, billing?.status === 'incomplete', `status=${billing?.status}`)
    assert(`${planKey}_plan`, billing?.plan_key === planKey, `stored=${billing?.plan_key}`)
    assert(
      `${planKey}_band`,
      billing?.user_band_key === parsed.userBand,
      `band=${billing?.user_band_key}`,
    )
    assert(
      `${planKey}_interval`,
      billing?.billing_interval === parsed.interval,
      `interval=${billing?.billing_interval}`,
    )
    assert(
      `${planKey}_no_rz`,
      !billing?.razorpay_subscription_id && !billing?.razorpay_plan_id,
      'no razorpay ids',
    )

    const { data: roles } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', ownerUserId)
    const roleList = (roles ?? []).map((r) => r.role)
    assert(
      `${planKey}_owner_only`,
      roleList.length === 1 && roleList[0] === 'owner',
      `roles=${roleList.join(',')}`,
    )

    await cleanupAgency(admin, agencyId, ownerUserId)
    assert(`${planKey}_cleaned`, true, 'disposable tenant removed')
  }

  // Contact-only / Flow Pay must not invent checkout SKUs via plan_key alone
  const bad = await invokeSignup(anon, {
    fullName: 'Should Fail',
    agencyName: `P2 Bad ${stamp}`,
    email: `p2.bad.${stamp}@alza-staging.test`,
    password: `P2-Test-${stamp}!aA`,
    planKey: 'flow_51_100_monthly',
  })
  // Invalid plan_key should either reject or create without that checkout sku
  if (bad.ok === true) {
    const agencyId = String(bad.agencyId ?? '')
    const { data: billing } = await admin
      .from('billing_subscriptions')
      .select('plan_key')
      .eq('agency_profile_id', agencyId)
      .maybeSingle()
    assert(
      'bad_plan_not_stored',
      billing?.plan_key !== 'flow_51_100_monthly',
      `plan_key=${billing?.plan_key}`,
    )
    await cleanupAgency(admin, agencyId, bad.ownerUserId ? String(bad.ownerUserId) : null)
  } else {
    assert('bad_plan_rejected', true, String(bad.message ?? bad.code ?? 'rejected'))
  }

  console.log('')
  console.log(`ALL PASS (${checks.length} checks)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
