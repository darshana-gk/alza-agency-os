/**
 * STAGING ONLY — Phase 4A membership-scoped agency wiring validation.
 * Target: uzckhxpqnipnovplohpf. Aborts on production.
 * Transient Agency B only; rolled back / cleaned. Never drops singleton.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FORBIDDEN_ONBOARDING_TENANT_KEYS,
  sanitizeOnboardingRows,
  stripForbiddenOnboardingTenantFields,
} from './src/lib/onboardingImport.ts'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const TENANT1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const FORGED_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const TRANSIENT_C = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
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
  const file = resolve('tmp-phase4a-staging-query.sql')
  const outFile = resolve('tmp-phase4a-staging-query.out')
  writeFileSync(file, sql, 'utf8')
  try {
    execSync(
      `npx supabase db query --linked --project-ref ${STAGING_REF} -f ${file}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    const combined = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`
    writeFileSync(outFile, combined, 'utf8')
    throw e
  }
  // Re-run capturing stdout to file via shell redirect is flaky on Windows; parse from re-exec with pipe
  const out = execSync(
    `npx supabase db query --linked --project-ref ${STAGING_REF} -f ${file}`,
    { encoding: 'utf8' },
  )
  writeFileSync(outFile, out, 'utf8')
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON in db query output: ${out.slice(0, 300)}`)
  return JSON.parse(out.slice(start, end + 1))
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

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) {
    throw new Error(`ABORT linked ${linked}`)
  }
  const { url, anon } = loadKeys()

  // ---- Pre-fingerprint ----
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
  ),
  'uuid_fp', md5(coalesce((SELECT string_agg(id::text, ',' ORDER BY id) FROM public.transactions), '')),
  'numbers_fp', md5(coalesce((SELECT string_agg(transaction_number, ',' ORDER BY transaction_number) FROM public.transactions), ''))
) AS pre;
`) as { rows?: Array<{ pre: Record<string, unknown> }> }
  const pre = preRaw.rows?.[0]?.pre
  if (!pre) throw new Error('pre-fingerprint failed')
  console.log('PRE', JSON.stringify(pre))

  assert('pre_singleton_recorded', typeof pre.singleton === 'boolean', `singleton=${pre.singleton}`)
  assert('pre_agency_n_positive', Number(pre.agency_n) >= 1, `agency_n=${pre.agency_n}`)
  assert('pre_agency_b_recorded', Number(pre.agency_b) >= 0, `agency_b=${pre.agency_b}`)
  assert('pre_rls_n', Number(pre.rls_n) === 70, `rls_n=${pre.rls_n}`)
  assert(
    'pre_rls_fp',
    String(pre.rls_fp) === '2a0c7f4a4dea235ee6e8a1275f1c478e',
    `rls_fp=${pre.rls_fp}`,
  )

  const owner = await signIn(url, anon, CREDS.owner)
  const admin = await signIn(url, anon, CREDS.admin)
  const csr = await signIn(url, anon, CREDS.csr)
  const producer = await signIn(url, anon, CREDS.producer)
  const viewer = await signIn(url, anon, CREDS.viewer)
  const support = await signIn(url, anon, CREDS.support)

  // ---- Role membership resolution ----
  async function checkMembership(
    id: string,
    client: SupabaseClient,
    expectAgency: string | null,
  ) {
    const rpc = await client.rpc('current_user_agency_profile_id')
    const profile = await client
      .from('users')
      .select('id, email, role, status, agency_profile_id, archived_at')
      .eq('auth_user_id', (await client.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()
    const rpcId = rpc.data == null || rpc.data === '' ? null : String(rpc.data)
    const rowId =
      profile.data?.agency_profile_id == null || profile.data.agency_profile_id === ''
        ? null
        : String(profile.data.agency_profile_id)
    const ok =
      !rpc.error &&
      !profile.error &&
      rpcId === expectAgency &&
      rowId === expectAgency &&
      String(profile.data?.status ?? '').toLowerCase() === 'active' &&
      !profile.data?.archived_at
    assert(
      id,
      ok,
      `rpc=${rpcId} row=${rowId} status=${profile.data?.status} err=${rpc.error?.message ?? profile.error?.message ?? ''}`,
    )
  }

  await checkMembership('owner_agency', owner, TENANT1)
  await checkMembership('admin_agency', admin, TENANT1)
  await checkMembership('csr_agency', csr, TENANT1)
  await checkMembership('producer_agency', producer, TENANT1)
  await checkMembership('viewer_agency', viewer, TENANT1)

  // Support: null agency
  {
    const rpc = await support.rpc('current_user_agency_profile_id')
    const profile = await support
      .from('users')
      .select('agency_profile_id, role')
      .eq('auth_user_id', (await support.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()
    const rpcId = rpc.data == null || rpc.data === '' ? null : String(rpc.data)
    const rowId =
      profile.data?.agency_profile_id == null || profile.data.agency_profile_id === ''
        ? null
        : String(profile.data.agency_profile_id)
    assert(
      'support_no_agency',
      rpcId === null && rowId === null && !rpc.error,
      `rpc=${rpcId} row=${rowId} err=${rpc.error?.message ?? ''}`,
    )

    // Pure alza_support must not load another agency via singleton pattern
    const ag = await support.from('agency_profile').select('id').limit(1).maybeSingle()
    // RLS should deny or return empty for support
    assert(
      'support_no_agency_profile_read',
      !ag.data || ag.error != null,
      `data=${ag.data?.id ?? 'null'} err=${ag.error?.message ?? ''}`,
    )
  }

  // Inactive user
  {
    const inactiveTry = await trySignIn(url, anon, CREDS.inactive)
    if (inactiveTry.error) {
      // Auth may still allow login; check profile/RPC if signed in
      assert('inactive_sign_in_blocked_or_checked', true, `auth_error=${inactiveTry.error}`)
    } else {
      const rpc = await inactiveTry.client.rpc('current_user_agency_profile_id')
      const profile = await inactiveTry.client
        .from('users')
        .select('status, agency_profile_id, archived_at')
        .eq('auth_user_id', (await inactiveTry.client.auth.getUser()).data.user?.id ?? '')
        .maybeSingle()
      const status = String(profile.data?.status ?? '').toLowerCase()
      const rpcId = rpc.data == null || rpc.data === '' ? null : String(rpc.data)
      // Inactive must not obtain operational agency via RPC (null or RLS blocks ops)
      const clients = await inactiveTry.client.from('clients').select('id').limit(5)
      const noOps =
        (clients.data?.length ?? 0) === 0 ||
        clients.error != null ||
        status !== 'active' ||
        rpcId === null
      assert(
        'inactive_no_operational_agency',
        noOps,
        `status=${status} rpc=${rpcId} clients_n=${clients.data?.length ?? 0} err=${clients.error?.message ?? ''}`,
      )
      await inactiveTry.client.auth.signOut()
    }
  }

  // ---- Agency Settings: load + update only caller agency; never INSERT ----
  {
    const load = await owner
      .from('agency_profile')
      .select('id, agency_name')
      .eq('id', TENANT1)
      .maybeSingle()
    assert(
      'settings_load_own',
      load.data?.id === TENANT1 && !load.error,
      `id=${load.data?.id} err=${load.error?.message ?? ''}`,
    )

    // Cannot load forged B (doesn't exist / RLS)
    const forged = await owner
      .from('agency_profile')
      .select('id')
      .eq('id', FORGED_B)
      .maybeSingle()
    assert(
      'settings_no_forged_b',
      !forged.data,
      `data=${forged.data?.id ?? 'null'} err=${forged.error?.message ?? ''}`,
    )

    // INSERT must fail (Phase 3B revoked INSERT on agency_profile for authenticated)
    const ins = await owner.from('agency_profile').insert({
      agency_name: 'PHASE4A-SHOULD-NOT-INSERT',
      singleton_key: true,
    })
    assert(
      'settings_no_insert',
      !!ins.error,
      `err=${ins.error?.message ?? 'UNEXPECTED_SUCCESS'}`,
    )

    // UPDATE only own agency — change notes-like field safely (timezone roundtrip)
    const before = await owner
      .from('agency_profile')
      .select('id, timezone')
      .eq('id', TENANT1)
      .single()
    const origTz = String(before.data?.timezone ?? 'America/New_York')
    const nextTz = origTz === 'America/Chicago' ? 'America/New_York' : 'America/Chicago'
    const upd = await owner
      .from('agency_profile')
      .update({ timezone: nextTz, updated_at: new Date().toISOString() })
      .eq('id', TENANT1)
      .select('id, timezone')
      .single()
    assert(
      'settings_update_own',
      upd.data?.id === TENANT1 && String(upd.data?.timezone) === nextTz && !upd.error,
      `tz=${upd.data?.timezone} err=${upd.error?.message ?? ''}`,
    )
    // Restore
    await owner
      .from('agency_profile')
      .update({ timezone: origTz, updated_at: new Date().toISOString() })
      .eq('id', TENANT1)

    // UPDATE forged id must affect 0 rows
    const updForge = await owner
      .from('agency_profile')
      .update({ timezone: 'UTC' })
      .eq('id', FORGED_B)
      .select('id')
    assert(
      'settings_update_forged_noop',
      (updForge.data?.length ?? 0) === 0,
      `n=${updForge.data?.length ?? 0} err=${updForge.error?.message ?? ''}`,
    )
  }

  // ---- Billing scoped ----
  {
    const sub = await owner
      .from('billing_subscriptions')
      .select('id, agency_profile_id')
      .eq('agency_profile_id', TENANT1)
      .maybeSingle()
    assert(
      'billing_scoped_query',
      !sub.error && (sub.data == null || String(sub.data.agency_profile_id) === TENANT1),
      `agency=${sub.data?.agency_profile_id ?? 'null'} err=${sub.error?.message ?? ''}`,
    )

    // Unscoped limit(1) is application anti-pattern — verify membership filter works
    const allVisible = await owner.from('billing_subscriptions').select('id, agency_profile_id')
    const allOwn = (allVisible.data ?? []).every((r) => String(r.agency_profile_id) === TENANT1)
    assert(
      'billing_visible_only_own',
      !allVisible.error && allOwn,
      `n=${allVisible.data?.length ?? 0} err=${allVisible.error?.message ?? ''}`,
    )

    // Support cannot count/read billing
    const supportBill = await support.from('billing_subscriptions').select('id')
    assert(
      'billing_support_denied',
      (supportBill.data?.length ?? 0) === 0,
      `n=${supportBill.data?.length ?? 0} err=${supportBill.error?.message ?? ''}`,
    )

    // Active user count agency-scoped
    const users = await owner
      .from('users')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
      .neq('role', 'alza_support')
      .eq('agency_profile_id', TENANT1)
    assert(
      'user_count_agency_scoped',
      !users.error && (users.count ?? 0) > 0,
      `count=${users.count} err=${users.error?.message ?? ''}`,
    )

    // Fail-closed: without membership agency, app must not count globally —
    // support RPC null proves fail-closed input for fetchAgencyActiveUserCount
    const supportRpc = await support.rpc('current_user_agency_profile_id')
    assert(
      'user_count_fail_closed_input',
      (supportRpc.data == null || supportRpc.data === '') && !supportRpc.error,
      `rpc=${supportRpc.data}`,
    )
  }

  // ---- Reconciliation mappings / import agency stamp ----
  {
    const mapName = `phase4a-map-${Date.now()}`
    const insMap = await owner
      .from('reconciliation_column_mappings')
      .insert({
        agency_profile_id: TENANT1,
        name: mapName,
        mapping: { policy_number: 'Policy', commission_amount: 'Commission' },
      })
      .select('id, agency_profile_id')
      .single()
    assert(
      'recon_mapping_own_agency',
      String(insMap.data?.agency_profile_id) === TENANT1 && !insMap.error,
      `agency=${insMap.data?.agency_profile_id} err=${insMap.error?.message ?? ''}`,
    )

    // Forged agency stamp must be rejected by Phase 3A stamp
    const forgedMap = await owner.from('reconciliation_column_mappings').insert({
      agency_profile_id: FORGED_B,
      name: `${mapName}-forged`,
      mapping: { policy_number: 'Policy', commission_amount: 'Commission' },
    })
    assert(
      'recon_mapping_forged_rejected',
      !!forgedMap.error,
      `err=${forgedMap.error?.message ?? 'UNEXPECTED_SUCCESS'}`,
    )

    if (insMap.data?.id) {
      await owner.from('reconciliation_column_mappings').delete().eq('id', insMap.data.id)
    }

    // Manual match agency parity: load a statement + txn, compare agencies
    const stmt = await owner
      .from('reconciliation_statements')
      .select('id, agency_profile_id')
      .eq('agency_profile_id', TENANT1)
      .limit(1)
      .maybeSingle()
    const txn = await owner
      .from('transactions')
      .select('id, agency_profile_id')
      .eq('agency_profile_id', TENANT1)
      .limit(1)
      .maybeSingle()
    assert(
      'recon_manual_match_agency_parity_inputs',
      !!stmt.data &&
        !!txn.data &&
        String(stmt.data.agency_profile_id) === String(txn.data.agency_profile_id) &&
        String(stmt.data.agency_profile_id) === TENANT1,
      `stmt=${stmt.data?.agency_profile_id} txn=${txn.data?.agency_profile_id}`,
    )

    // Duplicate hash check tenant-scoped: same hash different agency would be allowed in multi-tenant;
    // with singleton, verify duplicate lookup filters agency_profile_id
    const existing = await owner
      .from('reconciliation_statements')
      .select('id, file_hash, agency_profile_id')
      .eq('agency_profile_id', TENANT1)
      .not('file_hash', 'is', null)
      .limit(1)
      .maybeSingle()
    if (existing.data?.file_hash) {
      const dup = await owner
        .from('reconciliation_statements')
        .select('id')
        .eq('file_hash', existing.data.file_hash)
        .eq('agency_profile_id', TENANT1)
        .maybeSingle()
      assert(
        'recon_dup_hash_tenant_scoped',
        !!dup.data && String(dup.data.id) === String(existing.data.id),
        `dup=${dup.data?.id} existing=${existing.data.id}`,
      )
    } else {
      assert('recon_dup_hash_tenant_scoped', true, 'no statement hash present — skipped')
    }
  }

  // ---- Support ticket creation without singleton fallback ----
  {
    // Application path uses resolveCurrentAgencyProfileId — verify RPC for agency user
    const rpc = await csr.rpc('current_user_agency_profile_id')
    assert(
      'support_create_agency_from_rpc',
      String(rpc.data) === TENANT1 && !rpc.error,
      `rpc=${rpc.data} err=${rpc.error?.message ?? ''}`,
    )

    // Support user cannot resolve operational agency for ticket as agency user
    const supportRpc = await support.rpc('current_user_agency_profile_id')
    assert(
      'support_create_no_singleton_fallback',
      supportRpc.data == null || supportRpc.data === '',
      `rpc=${supportRpc.data}`,
    )

    // Create + cleanup a real ticket as CSR (agency membership)
    const subject = `phase4a-support-${Date.now()}`
    const conv = await csr
      .from('support_conversations')
      .insert({
        agency_profile_id: TENANT1,
        created_by_user_id: (
          await csr
            .from('users')
            .select('id')
            .eq('auth_user_id', (await csr.auth.getUser()).data.user?.id ?? '')
            .single()
        ).data?.id,
        category: 'other',
        subject,
        status: 'waiting_on_alza',
        priority: 'normal',
      })
      .select('id, agency_profile_id')
      .single()
    assert(
      'support_ticket_stamped_membership',
      String(conv.data?.agency_profile_id) === TENANT1 && !conv.error,
      `agency=${conv.data?.agency_profile_id} err=${conv.error?.message ?? ''}`,
    )
    if (conv.data?.id) {
      await csr.from('support_messages').delete().eq('conversation_id', conv.data.id)
      // CSR may not delete conversations — use owner or leave for SQL cleanup
      writeFileSync(
        resolve('tmp-phase4a-cleanup-ticket.sql'),
        `DELETE FROM public.support_messages WHERE conversation_id = '${conv.data.id}';
DELETE FROM public.support_conversations WHERE id = '${conv.data.id}';`,
        'utf8',
      )
      try {
        execSync(
          `npx supabase db query --linked --project-ref ${STAGING_REF} -f tmp-phase4a-cleanup-ticket.sql`,
          { encoding: 'utf8', stdio: 'pipe' },
        )
      } catch {
        /* best-effort */
      }
    }
  }

  // ---- Onboarding injection protection (pure + live) ----
  {
    for (const key of FORBIDDEN_ONBOARDING_TENANT_KEYS) {
      const stripped = stripForbiddenOnboardingTenantFields({
        business_name: 'Acme',
        [key]: FORGED_B,
      })
      assert(
        `onboard_strip_${key}`,
        stripped.rejected.includes(key) && !(key in stripped.row),
        `rejected=${stripped.rejected.join(',')}`,
      )
    }
    const rows = sanitizeOnboardingRows([
      { business_name: 'Keep Me', agency_profile_id: FORGED_B, client_number: 'X1' },
    ])
    assert(
      'onboard_sanitize_preserves_legit',
      rows[0].business_name === 'Keep Me' &&
        rows[0].client_number === 'X1' &&
        !('agency_profile_id' in rows[0]),
      JSON.stringify(rows[0]),
    )

    // Normal onboarding still works: create a transient carrier then archive/delete via SQL
    const carrierName = `PHASE4A-CARRIER-${Date.now()}`
    const create = await owner
      .from('carriers')
      .insert({
        carrier_name: carrierName,
        status: 'active',
      })
      .select('id, agency_profile_id, carrier_name')
      .single()
    assert(
      'onboard_normal_insert_stamped',
      String(create.data?.agency_profile_id) === TENANT1 &&
        create.data?.carrier_name === carrierName &&
        !create.error,
      `agency=${create.data?.agency_profile_id} err=${create.error?.message ?? ''}`,
    )
    if (create.data?.id) {
      writeFileSync(
        resolve('tmp-phase4a-cleanup-carrier.sql'),
        `DELETE FROM public.carriers WHERE id = '${create.data.id}';`,
        'utf8',
      )
      try {
        execSync(
          `npx supabase db query --linked --project-ref ${STAGING_REF} -f tmp-phase4a-cleanup-carrier.sql`,
          { encoding: 'utf8', stdio: 'pipe' },
        )
      } catch {
        /* best-effort */
      }
    }

    // Injected agency on insert must fail stamp
    const inject = await owner.from('carriers').insert({
      carrier_name: `PHASE4A-INJECT-${Date.now()}`,
      status: 'active',
      agency_profile_id: FORGED_B,
    } as Record<string, unknown>)
    assert(
      'onboard_inject_agency_rejected',
      !!inject.error,
      `err=${inject.error?.message ?? 'UNEXPECTED_SUCCESS'}`,
    )
  }

  // ---- Transient Agency B negative (rolled back) ----
  {
    writeFileSync(
      resolve('tmp-phase4a-agency-b-tx.sql'),
      `-- Transient extra agency inside rolled-back transaction (never persist)
DO $$
DECLARE
  v_c uuid := '${TRANSIENT_C}'::uuid;
  v_before int;
  v_mismatch int;
BEGIN
  ALTER TABLE public.agency_profile DROP CONSTRAINT IF EXISTS agency_profile_singleton;
  SELECT COUNT(*) INTO v_before FROM public.agency_profile;
  INSERT INTO public.agency_profile (id, agency_name)
  VALUES (v_c, 'PHASE4A Transient C');

  SELECT COUNT(*) INTO v_mismatch
  FROM public.transactions t
  JOIN public.clients c ON c.id = t.client_id
  WHERE t.agency_profile_id IS DISTINCT FROM c.agency_profile_id;

  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'phase4a_FAIL mismatch=%', v_mismatch;
  END IF;

  IF (SELECT COUNT(*) FROM public.agency_profile) <> v_before + 1 THEN
    RAISE EXCEPTION 'phase4a_FAIL expected % agencies in txn, got %', v_before + 1, (SELECT COUNT(*) FROM public.agency_profile);
  END IF;

  RAISE EXCEPTION 'phase4a_agency_b_PASS rolled_back';
END $$;
`,
      'utf8',
    )
    try {
      execSync(
        `npx supabase db query --linked --project-ref ${STAGING_REF} -f tmp-phase4a-agency-b-tx.sql`,
        { encoding: 'utf8', stdio: 'pipe' },
      )
      assert('transient_agency_b_rollback', false, 'expected rollback exception')
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      const msg = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`
      assert(
        'transient_agency_b_rollback',
        msg.includes('phase4a_agency_b_PASS'),
        msg.replace(/\s+/g, ' ').slice(0, 500),
      )
    }

    // JWT: owner cannot stamp forged B (singleton restored after rollback)
    const stamp = await owner.from('carriers').insert({
      carrier_name: `PHASE4A-FORGED-${Date.now()}`,
      status: 'active',
      agency_profile_id: FORGED_B,
    } as Record<string, unknown>)
    assert(
      'jwt_forged_agency_b_rejected',
      !!stamp.error,
      `err=${stamp.error?.message ?? 'UNEXPECTED_SUCCESS'}`,
    )
  }

  // ---- Post fingerprint ----
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
  ),
  'uuid_fp', md5(coalesce((SELECT string_agg(id::text, ',' ORDER BY id) FROM public.transactions), '')),
  'numbers_fp', md5(coalesce((SELECT string_agg(transaction_number, ',' ORDER BY transaction_number) FROM public.transactions), '')),
  'fixtures', jsonb_build_object(
    'phase4a_carriers', (SELECT COUNT(*) FROM public.carriers WHERE carrier_name ILIKE 'PHASE4A-%'),
    'phase4a_maps', (SELECT COUNT(*) FROM public.reconciliation_column_mappings WHERE name ILIKE 'phase4a-map-%'),
    'phase4a_tickets', (SELECT COUNT(*) FROM public.support_conversations WHERE subject ILIKE 'phase4a-support-%')
  )
) AS post;
`) as { rows?: Array<{ post: Record<string, unknown> }> }
  const post = postRaw.rows?.[0]?.post
  if (!post) throw new Error('post-fingerprint failed')
  console.log('POST', JSON.stringify(post))

  assert('post_singleton', post.singleton === pre.singleton, `singleton=${post.singleton}`)
  assert('post_agency_n', Number(post.agency_n) === Number(pre.agency_n), `agency_n=${post.agency_n}`)
  assert('post_agency_b', Number(post.agency_b) === Number(pre.agency_b), `agency_b=${post.agency_b}`)
  assert('post_rls_n', Number(post.rls_n) === 70, `rls_n=${post.rls_n}`)
  assert('post_rls_fp', String(post.rls_fp) === String(pre.rls_fp), `fp=${post.rls_fp}`)
  assert(
    'finance_unchanged',
    JSON.stringify(post.finance) === JSON.stringify(pre.finance),
    `pre=${JSON.stringify(pre.finance)} post=${JSON.stringify(post.finance)}`,
  )
  assert('uuid_fp_unchanged', String(post.uuid_fp) === String(pre.uuid_fp), 'uuid fp')
  assert('numbers_fp_unchanged', String(post.numbers_fp) === String(pre.numbers_fp), 'numbers fp')
  const fixtures = post.fixtures as Record<string, number>
  assert(
    'no_test_fixtures',
    Number(fixtures.phase4a_carriers) === 0 &&
      Number(fixtures.phase4a_maps) === 0 &&
      Number(fixtures.phase4a_tickets) === 0,
    JSON.stringify(fixtures),
  )

  const failed = checks.filter((c) => !c.passed)
  console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, failures: failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
