/**
 * STAGING ONLY. Temporarily marks Agency A active, checks every role, restores incomplete.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const ROLES = {
  owner: 'owner.payout.v1@example.invalid',
  admin: 'admin.role.payout.v1@example.invalid',
  csr: 'csr.payout.v1@example.invalid',
  producer: 'producer.payout.v1@example.invalid',
  viewer: 'viewer.payout.v1@example.invalid',
}
const OWNER_B = { email: 'owner.provision.v1.1788940430548@example.com', password: 'StagingTest!ProvisionV1-2026' }

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
  return { url: `https://${STAGING_REF}.supabase.co`, anon, service }
}

async function main() {
  const { url, anon, service } = loadKeys()
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const checks: Record<string, string> = {}

  const { error: upErr } = await admin
    .from('billing_subscriptions')
    .update({ status: 'active', current_period_end: '2026-12-31T00:00:00+00' })
    .eq('agency_profile_id', AGENCY_A)
  if (upErr) throw upErr

  try {
    for (const [role, email] of Object.entries(ROLES)) {
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      const signed = await client.auth.signInWithPassword({ email, password: PASSWORD })
      if (signed.error) throw new Error(signed.error.message)
      const rpc = await client.rpc('get_my_workspace_subscription_access')
      const state = (rpc.data as { access_state?: string } | null)?.access_state
      checks[`${role}_active`] = !rpc.error && state === 'active' ? 'PASS' : 'FAIL'
      const clients = await client.from('clients').select('id').limit(1)
      checks[`${role}_still_role_scoped`] = clients.error ? 'DENIED' : 'ALLOWED'
    }
    const ownerB = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedB = await ownerB.auth.signInWithPassword(OWNER_B)
    if (signedB.error) throw signedB.error
    const rpcB = await ownerB.rpc('get_my_workspace_subscription_access')
    checks.owner_b_still_own_agency =
      (rpcB.data as { access_state?: string } | null)?.access_state === 'active' ? 'PASS' : 'FAIL'
  } finally {
    await admin
      .from('billing_subscriptions')
      .update({ status: 'incomplete', current_period_end: null })
      .eq('agency_profile_id', AGENCY_A)
  }

  const owner = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  await owner.auth.signInWithPassword({ email: ROLES.owner, password: PASSWORD })
  const after = await owner.rpc('get_my_workspace_subscription_access')
  checks.agency_a_restored_restricted =
    (after.data as { access_state?: string } | null)?.access_state === 'restricted' ? 'PASS' : 'FAIL'

  console.log(JSON.stringify({ environment: 'STAGING', checks }, null, 2))
  if (Object.values(checks).includes('FAIL')) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
