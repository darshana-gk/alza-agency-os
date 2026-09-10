/**
 * STAGING ONLY — Phase 1.5 real HTTP self-serve signup smoke.
 * Target: uzckhxpqnipnovplohpf. Aborts on Production.
 *
 * Loads staging anon + service_role via `supabase projects api-keys` (no .env required).
 * Does NOT touch Production. Does NOT create Razorpay subscriptions.
 *
 * Run: npx tsx scripts/validate-self-serve-signup-staging.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

async function main() {
  const ref = readLinkedRef()
  assert('linked_ref', ref === STAGING_REF, `linked=${ref}`)
  assert('not_production_ref', ref !== PRODUCTION_REF, 'ref is not production')

  const { url, anon, service } = loadStagingKeys()
  assert('staging_url', url.includes(STAGING_REF) && !url.includes(PRODUCTION_REF), url)

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const stamp = Date.now()
  const email = `selfserve.smoke.${stamp}@alza-staging.test`
  const password = `SmokeTest!${stamp}`
  const agencyName = `ALZA Self Serve Smoke ${stamp}`
  const fullName = 'Smoke Test Owner'
  let agencyId = ''
  let ownerUserId = ''
  let authUserId = ''

  try {
    // Failure: agency_id
    {
      const bad = await invokeSignup(anonClient, {
        fullName,
        agencyName: `${agencyName} bad-agency`,
        email: `bad.agency.${stamp}@alza-staging.test`,
        password,
        agency_id: '00000000-0000-0000-0000-000000000099',
      })
      assert(
        'reject_agency_id',
        bad.ok === false && String(bad.code ?? '') === 'forbidden_field',
        String(bad.code ?? bad.message),
      )
    }

    // Failure: role
    {
      const bad = await invokeSignup(anonClient, {
        fullName,
        agencyName: `${agencyName} bad-role`,
        email: `bad.role.${stamp}@alza-staging.test`,
        password,
        role: 'admin',
      })
      assert(
        'reject_role',
        bad.ok === false && String(bad.code ?? '') === 'forbidden_field',
        String(bad.code ?? bad.message),
      )
    }

    // Failure: malformed band
    {
      const bad = await invokeSignup(anonClient, {
        fullName,
        agencyName: `${agencyName} bad-band`,
        email: `bad.band.${stamp}@alza-staging.test`,
        password,
        product: 'alza_flow',
        userBand: 'users_999',
        interval: 'monthly',
      })
      assert(
        'reject_malformed_band',
        bad.ok === false,
        String(bad.code ?? bad.message),
      )
    }

    // Failure: malformed interval
    {
      const bad = await invokeSignup(anonClient, {
        fullName,
        agencyName: `${agencyName} bad-interval`,
        email: `bad.interval.${stamp}@alza-staging.test`,
        password,
        product: 'alza_flow',
        userBand: 'users_1_3',
        interval: 'weekly',
      })
      assert(
        'reject_malformed_interval',
        bad.ok === false,
        String(bad.code ?? bad.message),
      )
    }

    // Success path
    const created = await invokeSignup(anonClient, {
      fullName,
      agencyName,
      email,
      password,
      product: 'alza_flow',
      userBand: 'users_4_10',
      interval: 'annual',
    })
    assert('http_signup_ok', created.ok === true, String(created.message ?? JSON.stringify(created)))
    assert('response_role_owner', created.role === 'owner', String(created.role))
    agencyId = String(created.agencyId ?? '')
    ownerUserId = String(created.ownerUserId ?? '')
    assert('agency_id_present', Boolean(agencyId), agencyId)
    assert('owner_id_present', Boolean(ownerUserId), ownerUserId)

    // Auth user exists
    const { data: userRow, error: userErr } = await admin
      .from('users')
      .select('id, role, agency_profile_id, invite_status, email, auth_user_id')
      .eq('id', ownerUserId)
      .single()
    assert('users_row', !userErr && !!userRow, userErr?.message ?? 'missing user')
    authUserId = String(userRow!.auth_user_id ?? '')
    assert('auth_user_linked', Boolean(authUserId), authUserId)
    const { data: authData, error: authLookupErr } = await admin.auth.admin.getUserById(authUserId)
    assert('auth_user_exists', !authLookupErr && !!authData.user, authLookupErr?.message ?? 'no auth')
    assert('users_role_owner', userRow!.role === 'owner', String(userRow!.role))
    assert('users_agency_match', userRow!.agency_profile_id === agencyId, String(userRow!.agency_profile_id))
    assert('invite_accepted', userRow!.invite_status === 'accepted', String(userRow!.invite_status))

    // Agency exactly once
    const { data: agencies, error: agErr } = await admin
      .from('agency_profile')
      .select('id, agency_name, email')
      .eq('id', agencyId)
    assert('agency_once', !agErr && (agencies?.length ?? 0) === 1, agErr?.message ?? `count=${agencies?.length}`)

    // Roles owner only
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', ownerUserId)
    const roleList = (roles ?? []).map((r) => String(r.role))
    assert(
      'owner_only_roles',
      roleList.length === 1 && roleList[0] === 'owner',
      roleList.join(','),
    )
    assert(
      'no_admin_csr_producer',
      !roleList.some((r) => ['admin', 'csr', 'producer'].includes(r)),
      roleList.join(','),
    )

    // Billing intent
    const { data: billing } = await admin
      .from('billing_subscriptions')
      .select(
        'status, product_key, user_band_key, billing_interval, plan_key, razorpay_subscription_id, razorpay_plan_id',
      )
      .eq('agency_profile_id', agencyId)
    assert('billing_one_row', (billing?.length ?? 0) === 1, `count=${billing?.length}`)
    const bill = billing![0]
    assert('intent_incomplete', bill.status === 'incomplete', String(bill.status))
    assert('intent_band', bill.user_band_key === 'users_4_10', String(bill.user_band_key))
    assert('intent_interval', bill.billing_interval === 'annual', String(bill.billing_interval))
    assert('intent_plan', bill.plan_key === 'flow_4_10_annual', String(bill.plan_key))
    assert('intent_product', bill.product_key === 'alza_flow', String(bill.product_key))
    assert('no_razorpay_sub', !bill.razorpay_subscription_id, String(bill.razorpay_subscription_id))
    assert('no_razorpay_plan', !bill.razorpay_plan_id, String(bill.razorpay_plan_id))

    // Duplicate email
    const dup = await invokeSignup(anonClient, {
      fullName,
      agencyName: `${agencyName} Dup`,
      email,
      password,
      product: 'alza_flow',
      userBand: 'users_1_3',
      interval: 'monthly',
    })
    assert('duplicate_email', dup.ok === false, String(dup.code ?? dup.message))

    // Replay identical request
    const replay = await invokeSignup(anonClient, {
      fullName,
      agencyName,
      email,
      password,
      product: 'alza_flow',
      userBand: 'users_4_10',
      interval: 'annual',
    })
    assert('replay_safe', replay.ok === false, String(replay.code ?? replay.message))

    // Login
    const { data: session, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    })
    assert('login', !signInError && !!session.session, signInError?.message ?? 'no session')

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Gate restricted
    const { data: gate } = await userClient.rpc('get_my_workspace_subscription_access')
    const gateRow = (Array.isArray(gate) ? gate[0] : gate) as Record<string, unknown> | null
    assert(
      'gate_restricted',
      String(gateRow?.access_state ?? '') === 'restricted',
      JSON.stringify(gateRow),
    )

    // Tenant isolation
    const { data: myAgency } = await userClient.rpc('current_user_agency_profile_id')
    assert('tenant_self', myAgency === agencyId, String(myAgency))

    // Cannot read another known staging agency (Agency A fixture) as own membership
    const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    const { data: foreignAgency, error: foreignErr } = await userClient
      .from('agency_profile')
      .select('id')
      .eq('id', OTHER)
      .maybeSingle()
    assert(
      'cross_tenant_agency_blocked',
      !foreignAgency && !foreignErr,
      `row=${foreignAgency?.id ?? 'none'} err=${foreignErr?.message ?? 'none'}`,
    )

    // Billing page data readable for own incomplete row (Owner)
    const { data: ownBilling, error: ownBillErr } = await userClient
      .from('billing_subscriptions')
      .select('status, plan_key')
      .eq('agency_profile_id', agencyId)
      .maybeSingle()
    assert(
      'billing_readable_own',
      !ownBillErr && ownBilling?.status === 'incomplete',
      ownBillErr?.message ?? String(ownBilling?.status),
    )

    await anonClient.auth.signOut()
    assert('logout', true, 'signed out')

    console.log('\nPHASE 1.5 HTTP SMOKE: ALL ASSERTIONS PASSED')
  } finally {
    // Cleanup ONLY disposable smoke rows
    if (agencyId) {
      await admin.from('billing_subscriptions').delete().eq('agency_profile_id', agencyId)
      await admin.from('activity_history').delete().eq('agency_profile_id', agencyId)
    }
    if (ownerUserId) {
      await admin.from('user_roles').delete().eq('user_id', ownerUserId)
      await admin.from('users').delete().eq('id', ownerUserId)
    }
    if (agencyId) {
      await admin.from('agency_profile').delete().eq('id', agencyId)
    }
    if (authUserId) {
      try {
        await admin.auth.admin.deleteUser(authUserId)
      } catch {
        // best-effort
      }
    }
    console.log('Cleanup complete (disposable smoke tenant only)')
  }

  writeFileSync(
    resolve('tmp-self-serve-smoke-report.json'),
    JSON.stringify(
      {
        ok: true,
        staging_ref: STAGING_REF,
        checks,
        stamp,
        email_domain: 'alza-staging.test',
      },
      null,
      2,
    ),
    'utf8',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
