/**
 * Multi-tenancy V1 Phase 4C — Edge function tenant isolation (source-only).
 * Run: npx tsx scripts/validate-multitenancy-phase4c.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

function readFn(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const opsAuth = readFn('supabase/functions/_shared/opsAuth.ts')
const billing = readFn('supabase/functions/_shared/billing.ts')
const matching = readFn('supabase/functions/run-reconciliation-matching/index.ts')
const confirmReceipts = readFn('supabase/functions/confirm-reconciliation-receipts/index.ts')
const notifyReview = readFn('supabase/functions/notify-transaction-review/index.ts')
const inviteUser = readFn('supabase/functions/invite-alza-user/index.ts')

console.log('A. opsAuth tenant contract')
{
  assert(opsAuth.includes('agency_profile_id'), 'ops auth selects agency_profile_id')
  assert(opsAuth.includes('agencyProfileId'), 'ops auth returns agencyProfileId')
  assert(opsAuth.includes('assertCallerAgencyMatches'), 'assertCallerAgencyMatches exported')
  assert(opsAuth.includes("roles.includes('alza_support')"), 'ALZA Support excluded from agency ops')
  assert(opsAuth.includes('callerJwtClient'), 'caller JWT client helper exported')
}

console.log('B. run-reconciliation-matching tenant scoping')
{
  assert(matching.includes('assertCallerAgencyMatches'), 'matching uses agency assertion')
  assert(matching.includes('agency_profile_id'), 'statement loads agency_profile_id')
  assert(matching.includes(".eq('agency_profile_id', statementAgencyId)"), 'transactions filtered by statement agency')
  assert(
    matching.includes(".from('agency_commission_receipts')") &&
      matching.includes(".eq('agency_profile_id', statementAgencyId)"),
    'receipts filtered by agency',
  )
  assert(
    matching.includes('reconciliation_statements') &&
      matching.includes('.eq(\'agency_profile_id\', statementAgencyId)'),
    'cross-statement occupancy scoped to same agency',
  )
  assert(!/\.from\('agency_profile'\)[\s\S]{0,80}\.limit\(1\)/.test(matching), 'no singleton agency lookup')
}

console.log('C. confirm-reconciliation-receipts tenant + RPC')
{
  assert(confirmReceipts.includes('assertCallerAgencyMatches'), 'confirm receipts checks agency parity')
  assert(
    confirmReceipts.includes("rpc('confirm_agency_commission_received'") ||
      confirmReceipts.includes('confirm_agency_commission_received'),
    'confirm receipts uses Phase 3C receipt RPC',
  )
  assert(confirmReceipts.includes('callerJwtClient'), 'confirm receipts calls RPC with caller JWT')
  assert(
    !confirmReceipts.includes(".from('agency_commission_receipts')\n    .insert"),
    'confirm receipts does not insert receipts directly',
  )
  assert(
    !/\.from\('transactions'\)[\s\S]{0,120}\.update\([\s\S]{0,200}agency_commission_confirmed/.test(
      confirmReceipts,
    ),
    'confirm receipts does not patch privileged transaction fields',
  )
}

console.log('D. notify-transaction-review tenant scoping')
{
  assert(notifyReview.includes('authorizeOpsStaff'), 'notify uses ops auth')
  assert(
    notifyReview.includes(".eq('agency_profile_id', callerAgencyId)"),
    'transaction loaded within caller agency',
  )
  assert(
    notifyReview.includes('reviewerEmbed.agency_profile_id') ||
      notifyReview.includes('agency_profile_id'),
    'reviewer/CSR lookups agency-scoped',
  )
}

console.log('E. invite-alza-user tenant scoping')
{
  assert(!inviteUser.includes('fall back to singleton'), 'singleton fallback removed')
  assert(!/\.from\('agency_profile'\)[\s\S]{0,80}\.limit\(1\)/.test(inviteUser), 'no first-agency lookup')
  assert(inviteUser.includes('forbidden_tenant_override'), 'forged tenant input rejected')
  assert(inviteUser.includes('callerAgencyProfileId'), 'invite uses inviter agency membership')
  assert(
    inviteUser.includes('That user does not belong to your agency workspace'),
    'resend enforces same-agency target',
  )
}

console.log('F. billing singleton helper hard-failed')
{
  assert(billing.includes('getSingletonAgency'), 'singleton helper still exported for compatibility')
  assert(
    billing.includes('Singleton agency lookup is disabled'),
    'getSingletonAgency hard-fails',
  )
  assert(!/\.from\('agency_profile'\)[\s\S]{0,80}\.limit\(1\)/.test(billing), 'billing has no LIMIT 1 agency query')
}

console.log('G. Source-wide Edge audit — launch-critical functions')
{
  const launchCritical = [
    'supabase/functions/_shared/opsAuth.ts',
    'supabase/functions/run-reconciliation-matching/index.ts',
    'supabase/functions/confirm-reconciliation-receipts/index.ts',
    'supabase/functions/notify-transaction-review/index.ts',
    'supabase/functions/invite-alza-user/index.ts',
  ]
  const deferred: string[] = []
  for (const rel of launchCritical) {
    const src = readFn(rel)
    if (/\.from\('agency_profile'\)[\s\S]{0,80}\.limit\(1\)/.test(src)) {
      deferred.push(`${rel}: singleton LIMIT 1`)
    }
  }
  assert(deferred.length === 0, `no unexplained singleton reads in launch-critical edge (${deferred.length})`)
  if (deferred.length) deferred.forEach((d) => console.error(`    ${d}`))

  const functionsDir = resolve(root, 'supabase/functions')
  const allFns = readdirSync(functionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name)
  assert(allFns.includes('run-reconciliation-matching'), 'matching function present')
  assert(allFns.includes('confirm-reconciliation-receipts'), 'confirm receipts function present')
}

console.log('H. Razorpay / webhook untouched in 4C')
{
  const razorpay = existsSync(resolve(root, 'supabase/functions/create-razorpay-subscription/index.ts'))
    ? readFn('supabase/functions/create-razorpay-subscription/index.ts')
    : ''
  assert(razorpay.includes('getCallerAgency'), 'razorpay create still uses caller agency')
  assert(!razorpay.includes('getSingletonAgency'), 'razorpay create does not use singleton')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
