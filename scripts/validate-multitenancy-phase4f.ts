/**
 * Multi-tenancy V1 Phase 4F — final application audit (source-only).
 * Run: npx tsx scripts/validate-multitenancy-phase4f.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  isActiveFinancialTransaction,
  isReadyForPayout,
  type CommissionTransaction,
} from '../src/lib/commission.ts'
import { resolveCurrentPolicyPremium } from '../src/lib/policyPremium.ts'
import {
  canAccessPath,
  homePathForRoles,
  isPurePlatformSupport,
} from '../src/lib/permissions.ts'
import {
  agencyBrandingLogoPath,
  reconciliationStatementObjectPath,
  supportingDocumentObjectPath,
} from '../src/lib/storagePaths.ts'

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

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const agency = read('src/lib/agency.ts')
const documents = read('src/lib/documents.ts')
const reconciliation = read('src/lib/reconciliation.ts')
const support = read('src/lib/support.ts')
const billing = read('src/lib/billing.ts')
const commission = read('src/lib/commission.ts')
const dashboard = read('src/pages/Dashboard.tsx')
const reports = read('src/pages/Reports.tsx')
const financials = read('src/pages/Financials.tsx')
const testSupabase = read('src/pages/TestSupabase.tsx')
const notifications = read('src/lib/notifications.ts')

console.log('A. No singleton / first-agency lookups')
{
  assert(agency.includes("supabase.rpc('current_user_agency_profile_id')"), 'agency resolver uses membership RPC')
  assert(!/from\('agency_profile'\)[\s\S]{0,120}\.limit\(1\)/.test(agency), 'agency.ts has no agency_profile LIMIT 1')
  assert(!agency.includes('singleton_key'), 'agency.ts does not insert singleton_key')
  assert(agency.includes(".eq('id', agencyProfileId)"), 'agency profile fetch/update scoped by membership id')
  for (const rel of ['src/lib/billing.ts', 'src/lib/support.ts', 'src/lib/reconciliation.ts', 'src/lib/documents.ts']) {
    const src = read(rel)
    assert(!/from\('agency_profile'\)[\s\S]{0,80}\.limit\(1\)/.test(src), `${rel} has no first-agency lookup`)
  }
}

console.log('B. Voided transactions excluded from active totals')
{
  const sample = {
    voidedAt: '2026-08-01T00:00:00Z',
    archived: false,
    agencyCommissionConfirmed: true,
    reviewStatus: 'approved',
    producer: 'A Producer',
    producerCommissionAmount: 100,
    producerPaymentStatus: 'ready',
    paymentBatchId: null,
    paidDate: null,
  } as CommissionTransaction
  assert(!isActiveFinancialTransaction({ voidedAt: 'x' }), 'voided row is not active')
  assert(!isActiveFinancialTransaction({ archived: true }), 'archived row is not active')
  assert(isActiveFinancialTransaction({ voidedAt: null, archived: false }), 'live row is active')
  assert(!isReadyForPayout(sample), 'voided row is not ready for payout')
  assert(commission.includes('export function isActiveFinancialTransaction'), 'shared active-total helper exported')
  assert(commission.includes(".is('voided_at', null)"), 'policy premium summaries exclude voided')
  assert(
    !/export async function fetchCommissionTransactions\(\) \{[\s\S]{0,280}\.is\('voided_at'/.test(commission),
    'transaction history fetch still includes voided rows',
  )
  assert(dashboard.includes('isActiveFinancialTransaction'), 'Dashboard KPIs use active-total helper')
  assert(reports.includes('isActiveFinancialTransaction'), 'Reports KPIs use active-total helper')
  assert(financials.includes('isActiveFinancialTransaction'), 'Financials KPIs use active-total helper')
  assert(notifications.includes('isActiveFinancialTransaction'), 'notifications skip voided transactions')
  assert(
    resolveCurrentPolicyPremium({ policyPremium: 300, transactionPremiumSum: 914 }) === 914,
    'current premium ignores stored policies.premium',
  )
  const policyPremium = read('src/lib/policyPremium.ts')
  assert(
    !policyPremium.includes('stored + txnSum') &&
      policyPremium.includes('SUM(non-archived, non-voided transactions.amount)'),
    'policy premium helper documents live-ledger formula',
  )
}

console.log('C. Storage writes remain Phase 4E prefixed')
{
  const agencyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  assert(agencyBrandingLogoPath(agencyId, 'png') === `${agencyId}/logo.png`, 'branding write path')
  assert(
    supportingDocumentObjectPath(agencyId, 'transaction', 'e1', 'a.pdf') ===
      `${agencyId}/transaction/e1/a.pdf`,
    'docs transaction write path',
  )
  assert(
    supportingDocumentObjectPath(agencyId, 'recovery', 'e1', 'b.pdf') === `${agencyId}/recovery/e1/b.pdf`,
    'docs recovery write path',
  )
  assert(
    reconciliationStatementObjectPath(agencyId, 's1', 'f.csv') === `${agencyId}/s1/f.csv`,
    'recon write path',
  )
  assert(agency.includes('agencyBrandingLogoPath'), 'agency writes via helper')
  assert(!agency.includes('`logo/${agencyProfileId'), 'agency does not write legacy logo path')
  assert(documents.includes('supportingDocumentObjectPath'), 'docs writes via helper')
  assert(
    !documents.includes('`${input.entityType}/${input.entityId}/'),
    'docs does not write unprefixed entity paths',
  )
  assert(reconciliation.includes('reconciliationStatementObjectPath'), 'recon writes via helper')
}

console.log('D. Support does not reopen agency_profile')
{
  assert(support.includes("rpc('support_agency_brief')"), 'support hydrates via support_agency_brief')
  assert(!support.includes('agency_profile:agency_profile_id'), 'no agency_profile embed')
  assert(support.includes('resolveCurrentAgencyProfileId'), 'ticket create uses membership')
  assert(!support.includes('fetchAgencyProfile'), 'support does not fetch operational agency profile')
}

console.log('E. TestSupabase is not a tenant dump')
{
  assert(!testSupabase.includes("from('clients')"), 'TestSupabase does not select clients')
  assert(testSupabase.includes('getSession'), 'TestSupabase is a session connectivity ping')
}

console.log('F. Navigation / RBAC — path gate, not nav hiding')
{
  assert(isPurePlatformSupport('alza_support'), 'pure support detected')
  assert(homePathForRoles('alza_support') === '/admin/support-inbox', 'support home is inbox')
  assert(!canAccessPath([], '/'), 'inactive / empty roles denied dashboard')
  assert(!canAccessPath('alza_support', '/'), 'support denied dashboard')
  assert(!canAccessPath('alza_support', '/clients'), 'support denied clients')
  assert(!canAccessPath('alza_support', '/financials'), 'support denied financials')
  assert(!canAccessPath('alza_support', '/reports'), 'support denied reports')
  assert(canAccessPath('alza_support', '/admin/support-inbox'), 'support allowed inbox')
  assert(canAccessPath('owner', '/admin/users'), 'owner allowed users')
  assert(canAccessPath('admin', '/admin/agency-settings'), 'admin allowed agency settings')
  assert(!canAccessPath('csr', '/admin/users'), 'CSR denied users admin')
  assert(canAccessPath('csr', '/financials'), 'CSR allowed financials')
  assert(!canAccessPath('producer', '/financials'), 'producer denied financials')
  assert(!canAccessPath('viewer', '/financials'), 'viewer denied financials')
  assert(canAccessPath('producer', '/reports'), 'producer allowed reports')
  assert(canAccessPath('viewer', '/reports'), 'viewer allowed reports')
  assert(!canAccessPath('producer', '/admin/producers'), 'producer denied producers admin')
  assert(!canAccessPath('viewer', '/reconciliation'), 'viewer denied reconciliation')
  const requirePerm = read('src/components/auth/RequirePermission.tsx')
  assert(requirePerm.includes('canAccessPath(roles, path)'), 'route guard uses canAccessPath')
  assert(requirePerm.includes('isPurePlatformSupport'), 'support deep-link redirects to inbox')
}

console.log('G. Edge / service-role — no new singleton path')
{
  const functionsDir = resolve(root, 'supabase/functions')
  const unsafe: string[] = []
  function walkFns(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walkFns(full)
      else if (name.endsWith('.ts')) {
        const src = readFileSync(full, 'utf8')
        if (/\.from\('agency_profile'\)[\s\S]{0,80}\.limit\(1\)/.test(src)) unsafe.push(full)
      }
    }
  }
  walkFns(functionsDir)
  assert(unsafe.length === 0, `no Edge agency_profile LIMIT 1 (${unsafe.length})`)
  const opsAuth = read('supabase/functions/_shared/opsAuth.ts')
  assert(opsAuth.includes('assertCallerAgencyMatches'), 'opsAuth still asserts caller agency')
  assert(opsAuth.includes("roles.includes('alza_support')"), 'ALZA Support excluded from agency ops')
}

console.log('H. Billing membership scope')
{
  assert(billing.includes('resolveCurrentAgencyProfileId'), 'billing uses membership resolver')
  assert(billing.includes(".eq('agency_profile_id', agencyProfileId)"), 'billing filters by agency')
}

console.log('I. Source walk — unexplained singleton hits')
{
  const hits: string[] = []
  for (const file of walk(resolve(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    if (/\.from\('agency_profile'\)[\s\S]{0,120}\.limit\(1\)/.test(text)) hits.push(file)
  }
  assert(hits.length === 0, `zero src agency_profile LIMIT 1 (${hits.length})`)
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
