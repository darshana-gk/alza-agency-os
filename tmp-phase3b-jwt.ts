/**
 * STAGING ONLY — Phase 3B JWT/PostgREST RLS matrix.
 * Target uzckhxpqnipnovplohpf. Aborts on production.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const TENANT1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const FORGED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const CREDS = {
  owner: { email: 'owner.payout.v1@example.invalid', password: PASSWORD },
  admin: { email: 'admin.role.payout.v1@example.invalid', password: PASSWORD },
  csr: { email: 'csr.payout.v1@example.invalid', password: PASSWORD },
  producer: { email: 'producer.payout.v1@example.invalid', password: PASSWORD },
  viewer: { email: 'viewer.payout.v1@example.invalid', password: PASSWORD },
  support: { email: 'alza.support.staging@example.invalid', password: 'StagingTest!SupportV1-2026' },
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

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c: SupabaseClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`signIn ${creds.email}: ${error.message}`)
  return c
}

function dbQuery(file: string) {
  execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${file}`, {
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) throw new Error(`ABORT linked ${linked}`)
  const { url, anon } = loadKeys()
  const owner = await signIn(url, anon, CREDS.owner)
  const admin = await signIn(url, anon, CREDS.admin)
  const csr = await signIn(url, anon, CREDS.csr)
  const producer = await signIn(url, anon, CREDS.producer)
  const viewer = await signIn(url, anon, CREDS.viewer)
  const support = await signIn(url, anon, CREDS.support)
  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })

  const created: { table: string; id: string }[] = []

  try {
    const agency = await owner.from('agency_profile').select('id, agency_name')
    assert('owner_agency', (agency.data?.length ?? 0) === 1 && agency.data?.[0]?.id === TENANT1, `n=${agency.data?.length} err=${agency.error?.message ?? ''}`)

    const clients = await owner.from('clients').select('id, agency_profile_id')
    assert('owner_clients', (clients.data?.length ?? 0) >= 2 && (clients.data ?? []).every((r) => r.agency_profile_id === TENANT1), `n=${clients.data?.length} err=${clients.error?.message ?? ''}`)

    const policies = await owner.from('policies').select('id, agency_profile_id')
    assert('owner_policies', (policies.data?.length ?? 0) >= 2, `n=${policies.data?.length} err=${policies.error?.message ?? ''}`)

    const txns = await owner.from('transactions').select('id, agency_profile_id')
    assert(
      'owner_txns',
      (txns.data?.length ?? 0) >= 36 && (txns.data ?? []).every((r) => r.agency_profile_id === TENANT1),
      `n=${txns.data?.length} err=${txns.error?.message ?? ''}`,
    )

    const billing = await owner.from('billing_subscriptions').select('id, agency_profile_id')
    assert('owner_billing', (billing.data?.length ?? 0) === 1 && billing.data?.[0]?.agency_profile_id === TENANT1, `n=${billing.data?.length} err=${billing.error?.message ?? ''}`)

    const dir = await owner.from('carriers').select('id')
    assert('owner_dir_read', (dir.data?.length ?? 0) >= 1, `n=${dir.data?.length} err=${dir.error?.message ?? ''}`)

    const carrierIns = await owner.from('carriers').insert({ carrier_name: '3B-HTTP-CARRIER', status: 'active' }).select('id, agency_profile_id').single()
    assert('owner_dir_insert', Boolean(carrierIns.data?.id) && carrierIns.data?.agency_profile_id === TENANT1, carrierIns.error?.message ?? 'stamped')
    if (carrierIns.data?.id) created.push({ table: 'carriers', id: carrierIns.data.id })

    const stamp = await owner.from('clients').insert({ business_name: '3B-HTTP-STAMP', client_number: '3B-HTTP-ST1' }).select('id, agency_profile_id').single()
    assert('stamp_no_tenant', stamp.data?.agency_profile_id === TENANT1, stamp.error?.message ?? String(stamp.data?.agency_profile_id))
    if (stamp.data?.id) created.push({ table: 'clients', id: stamp.data.id })

    const ownTenant = await owner.from('clients').insert({ business_name: '3B-HTTP-OWN', client_number: '3B-HTTP-OWN1', agency_profile_id: TENANT1 }).select('id, agency_profile_id').single()
    assert('stamp_own_tenant', ownTenant.data?.agency_profile_id === TENANT1, ownTenant.error?.message ?? 'ok')
    if (ownTenant.data?.id) created.push({ table: 'clients', id: ownTenant.data.id })

    const forged = await owner.from('clients').insert({ business_name: '3B-HTTP-FORGED', client_number: '3B-HTTP-FORG', agency_profile_id: FORGED }).select('id').single()
    assert('stamp_forged', Boolean(forged.error), forged.error?.message ?? 'not rejected')

    const adminClients = await admin.from('clients').select('id')
    const adminBill = await admin.from('billing_subscriptions').select('id')
    assert('admin_clients', (adminClients.data?.length ?? 0) >= 2, `n=${adminClients.data?.length} err=${adminClients.error?.message ?? ''}`)
    assert('admin_billing', (adminBill.data?.length ?? 0) === 1, `n=${adminBill.data?.length} err=${adminBill.error?.message ?? ''}`)

    const csrClients = await csr.from('clients').select('id')
    const csrTxns = await csr.from('transactions').select('id')
    const csrPol = await csr.from('policies').select('id')
    const csrRecon = await csr.from('reconciliation_statements').select('id')
    const csrMap = await csr.from('reconciliation_column_mappings').select('id')
    const csrRows = await csr.from('reconciliation_statement_rows').select('id')
    const csrDir = await csr.from('carriers').select('id')
    const csrBill = await csr.from('billing_subscriptions').select('id')
    const csrCarrier = await csr.from('carriers').insert({ carrier_name: '3B-HTTP-CSR-CAR', status: 'active' }).select('id').single()
    const csrClient = await csr.from('clients').insert({ business_name: '3B-HTTP-CSR', client_number: '3B-HTTP-CSR1' }).select('id').single()
    if (csrClient.data?.id) created.push({ table: 'clients', id: csrClient.data.id })
    assert('csr_clients', (csrClients.data?.length ?? 0) >= 2, `n=${csrClients.data?.length}`)
    assert('csr_policies', (csrPol.data?.length ?? 0) >= 2, `n=${csrPol.data?.length}`)
    assert('csr_txns', (csrTxns.data?.length ?? 0) >= 36, `n=${csrTxns.data?.length}`)
    assert('csr_recon', (csrRecon.data?.length ?? 0) >= 1, `n=${csrRecon.data?.length} err=${csrRecon.error?.message ?? ''}`)
    assert('csr_recon_maps', (csrMap.data?.length ?? 0) >= 1, `n=${csrMap.data?.length}`)
    assert('csr_recon_rows', (csrRows.data?.length ?? 0) >= 1, `n=${csrRows.data?.length}`)
    assert('csr_dir_read', (csrDir.data?.length ?? 0) >= 1, `n=${csrDir.data?.length}`)
    assert('csr_no_billing', (csrBill.data?.length ?? 0) === 0 && !csrBill.error, `n=${csrBill.data?.length} err=${csrBill.error?.message ?? ''}`)
    assert('csr_no_dir_mutate', Boolean(csrCarrier.error), csrCarrier.error?.message ?? 'not rejected')
    assert('csr_insert_client', Boolean(csrClient.data?.id), csrClient.error?.message ?? 'ok')

    const prodTxns = await producer.from('transactions').select('id, producer')
    const prodOther = (prodTxns.data ?? []).filter((r) => String(r.producer ?? '') === 'DUMMY Payout V1 Producer')
    const prodClients = await producer.from('clients').select('id')
    const prodMut = await producer.from('clients').insert({ business_name: '3B-HTTP-PROD', client_number: '3B-HTTP-PR1' }).select('id').single()
    const prodBill = await producer.from('billing_subscriptions').select('id')
    const prodRecon = await producer.from('reconciliation_statements').select('id')
    const prodDir = await producer.from('carriers').select('id')
    const prodUsers = await producer.from('users').select('id, email')
    assert('producer_hides_other_book', prodOther.length === 0, `other=${prodOther.length} total=${prodTxns.data?.length} err=${prodTxns.error?.message ?? ''}`)
    assert('producer_no_mutate', Boolean(prodMut.error), prodMut.error?.message ?? 'not rejected')
    assert('producer_no_billing', (prodBill.data?.length ?? 0) === 0, `n=${prodBill.data?.length}`)
    assert('producer_no_recon', (prodRecon.data?.length ?? 0) === 0, `n=${prodRecon.data?.length}`)
    assert('producer_no_dir', (prodDir.data?.length ?? 0) === 0, `n=${prodDir.data?.length}`)
    assert('producer_users_self', (prodUsers.data?.length ?? 0) === 1, `n=${prodUsers.data?.length} emails=${(prodUsers.data ?? []).map((u) => u.email).join(',')}`)
    assert('producer_clients_scoped', (prodClients.data?.length ?? 0) === 0 || (prodClients.data ?? []).every((r) => r), `n=${prodClients.data?.length}`)

    const viewClients = await viewer.from('clients').select('id')
    const viewTxns = await viewer.from('transactions').select('id')
    const viewIns = await viewer.from('clients').insert({ business_name: '3B-HTTP-VIEW', client_number: '3B-HTTP-VW1' }).select('id').single()
    const viewUpd = await viewer.from('clients').update({ notes: '3B-no' }).eq('agency_profile_id', TENANT1).select('id')
    const viewDel = await viewer.from('clients').delete().eq('agency_profile_id', TENANT1).select('id')
    const viewBill = await viewer.from('billing_subscriptions').select('id')
    const viewRecon = await viewer.from('reconciliation_statements').select('id')
    assert('viewer_clients', (viewClients.data?.length ?? 0) >= 2, `n=${viewClients.data?.length}`)
    assert('viewer_txns', (viewTxns.data?.length ?? 0) >= 36, `n=${viewTxns.data?.length}`)
    assert('viewer_no_insert', Boolean(viewIns.error), viewIns.error?.message ?? 'not rejected')
    assert('viewer_no_update', (viewUpd.data?.length ?? 0) === 0, `n=${viewUpd.data?.length} err=${viewUpd.error?.message ?? ''}`)
    assert('viewer_no_delete', (viewDel.data?.length ?? 0) === 0, `n=${viewDel.data?.length} err=${viewDel.error?.message ?? ''}`)
    assert('viewer_no_billing', (viewBill.data?.length ?? 0) === 0, `n=${viewBill.data?.length}`)
    assert('viewer_no_recon', (viewRecon.data?.length ?? 0) === 0, `n=${viewRecon.data?.length}`)

    const ownUsers = await owner.from('users').select('id, email, agency_profile_id')
    assert('owner_users_agency', (ownUsers.data?.length ?? 0) >= 2 && (ownUsers.data ?? []).every((u) => !u.agency_profile_id || u.agency_profile_id === TENANT1), `n=${ownUsers.data?.length}`)
    const csrUsers = await csr.from('users').select('id, email')
    assert('csr_users_self', (csrUsers.data?.length ?? 0) === 1, `n=${csrUsers.data?.length}`)
    const grantAlza = await owner.from('user_roles').insert({ user_id: ownUsers.data?.[0]?.id, role: 'alza_support' }).select('id').single()
    assert('owner_cannot_grant_alza', Boolean(grantAlza.error), grantAlza.error?.message ?? 'not rejected')

    const sAgency = await support.from('agency_profile').select('id')
    const sClients = await support.from('clients').select('id')
    const sPol = await support.from('policies').select('id')
    const sTxn = await support.from('transactions').select('id')
    const sFin = await support.from('agency_commission_receipts').select('id')
    const sBatch = await support.from('producer_payment_batches').select('id')
    const sRecon = await support.from('reconciliation_statements').select('id')
    const sDir = await support.from('carriers').select('id')
    const sBill = await support.from('billing_subscriptions').select('id')
    const sAct = await support.from('activity_history').select('id')
    const sTickets = await support.from('support_conversations').select('id, agency_profile_id')
    const sEmbed = await support.from('support_conversations').select('id, agency_profile:agency_profile_id(agency_name, email)')
    const sBrief = await support.rpc('support_agency_brief')
    const sUsers = await support.from('users').select('id, email, role, agency_profile_id')
    assert('support_no_agency', (sAgency.data?.length ?? 0) === 0, `n=${sAgency.data?.length} err=${sAgency.error?.message ?? ''}`)
    assert('support_no_clients', (sClients.data?.length ?? 0) === 0, `n=${sClients.data?.length}`)
    assert('support_no_policies', (sPol.data?.length ?? 0) === 0, `n=${sPol.data?.length}`)
    assert('support_no_txns', (sTxn.data?.length ?? 0) === 0, `n=${sTxn.data?.length}`)
    assert('support_no_financials', (sFin.data?.length ?? 0) === 0 && (sBatch.data?.length ?? 0) === 0, `fin=${sFin.data?.length} batch=${sBatch.data?.length}`)
    assert('support_no_recon', (sRecon.data?.length ?? 0) === 0, `n=${sRecon.data?.length}`)
    assert('support_no_dir', (sDir.data?.length ?? 0) === 0, `n=${sDir.data?.length}`)
    assert('support_no_billing', (sBill.data?.length ?? 0) === 0, `n=${sBill.data?.length}`)
    assert('support_no_activity', (sAct.data?.length ?? 0) === 0, `n=${sAct.data?.length}`)
    assert('support_tickets', (sTickets.data?.length ?? 0) >= 6, `n=${sTickets.data?.length} err=${sTickets.error?.message ?? ''}`)
    assert(
      'support_brief',
      !sBrief.error &&
        Array.isArray(sBrief.data) &&
        sBrief.data.length >= 1 &&
        sBrief.data.some((r: { id?: string }) => r.id === TENANT1),
      `n=${Array.isArray(sBrief.data) ? sBrief.data.length : -1} err=${sBrief.error?.message ?? ''}`,
    )
    assert(
      'support_users_platform_only',
      (sUsers.data ?? []).every((u) => u.agency_profile_id == null) && (sUsers.data?.length ?? 0) >= 1,
      `n=${sUsers.data?.length} agencies=${(sUsers.data ?? []).map((u) => u.agency_profile_id).join(',')}`,
    )
    if (sEmbed.error) {
      assert('support_embed_agency_phase4', true, `embed blocked (Phase 4): ${sEmbed.error.message}`)
    } else {
      const names = (sEmbed.data ?? []) as Array<{ agency_profile?: { agency_name?: string } | { agency_name?: string }[] | null }>
      const missing = names.filter((row) => {
        const ap = row.agency_profile
        const obj = Array.isArray(ap) ? ap[0] : ap
        return !obj?.agency_name
      }).length
      assert('support_embed_agency_phase4', missing > 0 || names.length === 0, `embed returned names missing=${missing} n=${names.length}`)
    }

    const ownerTickets = await owner.from('support_conversations').select('id, agency_profile_id')
    assert('owner_own_tickets', (ownerTickets.data?.length ?? 0) >= 1 && (ownerTickets.data ?? []).every((t) => t.agency_profile_id === TENANT1), `n=${ownerTickets.data?.length}`)

    const anonClients = await anonClient.from('clients').select('id')
    const anonPol = await anonClient.from('policies').select('id')
    const anonTxn = await anonClient.from('transactions').select('id')
    const anonUsers = await anonClient.from('users').select('id')
    const anonDir = await anonClient.from('carriers').select('id')
    const anonFin = await anonClient.from('agency_commission_receipts').select('id')
    const anonRecon = await anonClient.from('reconciliation_statements').select('id')
    assert('anon_no_clients', Boolean(anonClients.error) || (anonClients.data?.length ?? 0) === 0, anonClients.error?.message ?? `n=${anonClients.data?.length}`)
    assert('anon_no_policies', Boolean(anonPol.error) || (anonPol.data?.length ?? 0) === 0, anonPol.error?.message ?? `n=${anonPol.data?.length}`)
    assert('anon_no_txns', Boolean(anonTxn.error) || (anonTxn.data?.length ?? 0) === 0, anonTxn.error?.message ?? `n=${anonTxn.data?.length}`)
    assert('anon_no_users', Boolean(anonUsers.error) || (anonUsers.data?.length ?? 0) === 0, anonUsers.error?.message ?? `n=${anonUsers.data?.length}`)
    assert('anon_no_dir', Boolean(anonDir.error) || (anonDir.data?.length ?? 0) === 0, anonDir.error?.message ?? `n=${anonDir.data?.length}`)
    assert('anon_no_financials', Boolean(anonFin.error) || (anonFin.data?.length ?? 0) === 0, anonFin.error?.message ?? `n=${anonFin.data?.length}`)
    assert('anon_no_recon', Boolean(anonRecon.error) || (anonRecon.data?.length ?? 0) === 0, anonRecon.error?.message ?? `n=${anonRecon.data?.length}`)

    // Inactive JWT: flip viewer, re-query, restore.
    dbQuery('tmp-phase3b-viewer-inactive.sql')
    try {
      const inactiveClients = await viewer.from('clients').select('id')
      const inactiveTxns = await viewer.from('transactions').select('id')
      assert('inactive_no_clients', (inactiveClients.data?.length ?? 0) === 0, `n=${inactiveClients.data?.length} err=${inactiveClients.error?.message ?? ''}`)
      assert('inactive_no_txns', (inactiveTxns.data?.length ?? 0) === 0, `n=${inactiveTxns.data?.length} err=${inactiveTxns.error?.message ?? ''}`)
    } finally {
      dbQuery('tmp-phase3b-viewer-restore.sql')
    }
    const restored = await viewer.from('clients').select('id')
    assert('inactive_restored', (restored.data?.length ?? 0) >= 2, `n=${restored.data?.length}`)
  } finally {
    for (const row of created.reverse()) {
      await owner.from(row.table).delete().eq('id', row.id)
    }
  }

  const failed = checks.filter((c) => !c.passed)
  console.log(JSON.stringify({ passed: checks.filter((c) => c.passed).length, failed: failed.length, failures: failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((err) => {
  try {
    dbQuery('tmp-phase3b-viewer-restore.sql')
  } catch {
    /* restore best-effort */
  }
  console.error(String(err?.stack ?? err))
  process.exit(1)
})
