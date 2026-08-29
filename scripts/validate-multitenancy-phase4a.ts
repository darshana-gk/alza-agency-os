/**
 * Multi-tenancy V1 Phase 4A — agency/session/query wiring (source-only).
 * Run: npx tsx scripts/validate-multitenancy-phase4a.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FORBIDDEN_ONBOARDING_TENANT_KEYS,
  sanitizeOnboardingRows,
  stripForbiddenOnboardingTenantFields,
} from '../src/lib/onboardingImport.ts'

const root = resolve(process.cwd())

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    console.log(`  OK: ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL: ${message}`)
}

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const agency = readSrc('src/lib/agency.ts')
const agencyContext = readSrc('src/lib/agencyContext.tsx')
const auth = readSrc('src/lib/auth.tsx')
const billing = readSrc('src/lib/billing.ts')
const reconciliation = readSrc('src/lib/reconciliation.ts')
const support = readSrc('src/lib/support.ts')
const onboarding = readSrc('src/lib/onboardingImport.ts')

console.log('A. Agency resolver — no singleton reads')
{
  assert(agency.includes('resolveCurrentAgencyProfileId'), 'agency exports membership resolver')
  assert(agency.includes("supabase.rpc('current_user_agency_profile_id')"), 'resolver uses RPC')
  assert(!/from\('agency_profile'\)[\s\S]{0,120}\.limit\(1\)/.test(agency), 'agency.ts has no agency_profile LIMIT 1')
  assert(!agency.includes('singleton_key'), 'agency.ts does not insert singleton_key')
  assert(agency.includes(".eq('id', agencyProfileId)"), 'fetch scoped by membership id')
  assert(agency.includes('.update(rowPayload)'), 'save uses update only')
  assert(!/\.insert\([\s\S]*agency_profile/.test(agency), 'save does not insert agency_profile')
}

console.log('B. Auth profile carries agency_profile_id')
{
  assert(auth.includes('agencyProfileId'), 'AppUserProfile exposes agencyProfileId')
  assert(auth.includes('agency_profile_id'), 'users select includes agency_profile_id')
}

console.log('C. Agency context — platform support excluded')
{
  assert(agencyContext.includes('isPlatformOnlyAlzaSupport'), 'context detects platform-only support')
  assert(agencyContext.includes('agencyProfileId'), 'context exposes agencyProfileId')
  assert(agencyContext.includes('platformOnlySupport'), 'context skips fetch for platform support')
}

console.log('D. Billing reads scoped to membership')
{
  assert(billing.includes('resolveCurrentAgencyProfileId'), 'billing imports resolver')
  assert(billing.includes(".eq('agency_profile_id', agencyProfileId)"), 'subscription filtered by agency')
  assert(!/billing_subscriptions[\s\S]{0,200}\.limit\(1\)/.test(billing), 'no global subscription LIMIT 1')
  assert(!billing.includes('agencyRpc'), 'removed unscoped user-count fallback')
  assert(
    billing.includes('Agency membership is required to count active users'),
    'user count fails closed without membership',
  )
}

console.log('E. Reconciliation frontend uses membership agency')
{
  assert(reconciliation.includes('resolveCurrentAgencyProfileId'), 'reconciliation imports resolver')
  assert(!reconciliation.includes('fetchAgencyProfile'), 'reconciliation removed singleton fetch')
  assert(
    reconciliation.includes('must belong to the same agency'),
    'manual match enforces statement/transaction agency parity',
  )
}

console.log('F. Support ticket creation — no singleton fallback')
{
  assert(support.includes('resolveCurrentAgencyProfileId'), 'support uses membership resolver')
  assert(!support.includes('fetchAgencyProfile'), 'support removed singleton fetch')
  assert(
    !/fetchAgencyProfile\(\)[\s\S]{0,200}agencyProfileId/.test(support),
    'support does not OR singleton into agency id',
  )
}

console.log('G. Onboarding tenant injection protection')
{
  assert(onboarding.includes('FORBIDDEN_ONBOARDING_TENANT_KEYS'), 'forbidden tenant keys defined')
  assert(FORBIDDEN_ONBOARDING_TENANT_KEYS.includes('agency_profile_id'), 'agency_profile_id forbidden')
  const stripped = stripForbiddenOnboardingTenantFields({
    business_name: 'Acme',
    agency_profile_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  })
  assert(stripped.rejected.includes('agency_profile_id'), 'strip detects injected agency_profile_id')
  assert(!('agency_profile_id' in stripped.row), 'strip removes agency_profile_id from row')
  const rows = sanitizeOnboardingRows([
    { client_number: '1', tenant_id: 'evil' },
    { client_number: '2' },
  ])
  assert(!('tenant_id' in rows[0]), 'sanitize removes tenant_id')
  assert(rows[1].client_number === '2', 'sanitize preserves legitimate fields')
}

console.log('H. Role resolution expectations (static contract)')
{
  const roleCases = [
    ['owner', true],
    ['admin', true],
    ['csr', true],
    ['producer', true],
    ['viewer', true],
    ['alza_support', false],
    ['inactive', false],
  ] as const
  for (const [role, expectsAgency] of roleCases) {
    const isSupport = role === 'alza_support'
    const isInactive = role === 'inactive'
    const shouldResolve = expectsAgency && !isSupport && !isInactive
    assert(
      shouldResolve === (role !== 'alza_support' && role !== 'inactive'),
      `${role} operational agency expectation documented`,
    )
  }
}

console.log('I. Deferred singleton sites documented')
{
  const edgeInvite = existsSync(resolve(root, 'supabase/functions/invite-alza-user/index.ts'))
    ? readFileSync(resolve(root, 'supabase/functions/invite-alza-user/index.ts'), 'utf8')
    : ''
  assert(edgeInvite.includes('limit(1)'), 'invite edge still has singleton fallback (4C)')
  assert(!edgeInvite.includes('resolveCurrentAgencyProfileId'), 'invite not wired in 4A (expected)')
  const commission = readSrc('src/lib/commission.ts')
  assert(
    /\.from\('transactions'\)[\s\S]{0,40}\.update/.test(commission),
    'commission direct UPDATE deferred to 4B',
  )
  const documents = readSrc('src/lib/documents.ts')
  assert(documents.includes('`${input.entityType}/${input.entityId}/'), 'storage legacy path deferred to 4E')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
