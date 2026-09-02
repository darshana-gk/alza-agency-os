/**
 * V1 policy-term history UX (presentation over existing Policy Files).
 *
 * Does not require a policy_terms table or a new policy row per renewal.
 * Run: npx tsx scripts/validate-policy-term-history-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  groupPolicyTermsByLineOfBusiness,
  listPolicyFileTerms,
  policyTermFinancialTotals,
  policyTermPath,
  resolveDisplayedPolicyNumber,
  resolvePolicyFileTerm,
  sumClientCurrentPremium,
  toPolicyTermTxn,
  type PolicyTermTxn,
} from '../src/lib/policyPremium.ts'
import { assertRewriteSameAgency } from '../src/lib/policyRenewRewrite.ts'

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

function assertEq(actual: unknown, expected: unknown, message: string) {
  assert(actual === expected, `${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

function txn(partial: Partial<PolicyTermTxn> & { type: string; amount: number }): PolicyTermTxn {
  return toPolicyTermTxn(partial)
}

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const root = resolve(process.cwd())

const file = {
  policyNumber: 'BHP-GL-2027-002',
  effectiveDate: '2027-09-01',
  expirationDate: '2028-09-01',
  producer: 'Casey Producer',
  csr: 'Drew CSR',
  carrier: 'Harbor Specialty',
  mga: 'Coastal MGA',
  premium: 0,
}

const glTerms = [
  txn({
    id: 'nb',
    type: 'new_policy_premium',
    amount: 8000,
    agencyCommissionAmount: 1000,
    brokerFee: 50,
    createdAt: '2026-09-01T10:00:00Z',
    transactionEffectiveDate: '2026-09-01',
    transactionExpirationDate: '2027-09-01',
    policyNumber: 'BHP-GL-2026-001',
    policyEffectiveDate: '2026-09-01',
    policyExpirationDate: '2027-09-01',
    producer: 'Avery Producer',
    csr: 'Blake CSR',
    carrier: 'North Star Mutual',
    mga: 'Harbor MGA',
  }),
  txn({
    id: 'endo',
    type: 'endorsement_premium',
    amount: 400,
    agencyCommissionAmount: 50,
    createdAt: '2026-11-01T10:00:00Z',
    transactionEffectiveDate: '2026-11-01',
    transactionExpirationDate: '2027-09-01',
    policyNumber: 'BHP-GL-2026-001',
  }),
  txn({
    id: 'ren',
    type: 'renewal_premium',
    amount: 9100,
    agencyCommissionAmount: 1365,
    brokerFee: 75,
    createdAt: '2027-09-01T10:00:00Z',
    transactionEffectiveDate: '2027-09-01',
    transactionExpirationDate: '2028-09-01',
    policyNumber: 'BHP-GL-2027-002',
    policyEffectiveDate: '2027-09-01',
    policyExpirationDate: '2028-09-01',
    producer: 'Casey Producer',
    csr: 'Drew CSR',
    carrier: 'Harbor Specialty',
    mga: 'Coastal MGA',
  }),
]

console.log('A. One client with multiple GL terms')
{
  const terms = listPolicyFileTerms(glTerms, file)
  assertEq(terms.length, 2, 'renewal creates a second term entry without a new policy row')
  assertEq(terms[0]?.policyNumber, 'BHP-GL-2026-001', 'prior term keeps the snapshotted policy number')
  assertEq(terms[1]?.policyNumber, 'BHP-GL-2027-002', 'current term shows the renewed policy number')
  assertEq(terms[0]?.isCurrent, false, 'first term is not current')
  assertEq(terms[1]?.isCurrent, true, 'renewal is the current term')
  assertEq(terms[1]?.priorTermId, 'nb', 'current term is linked to the prior establishing txn')
  assertEq(terms[0]?.nextTermId, 'ren', 'prior term is linked forward to the renewal')
}

console.log('B. Each term shows only its own transactions and counts')
{
  const terms = listPolicyFileTerms(glTerms, file)
  const prior = terms[0]
  const current = terms[1]
  assertEq(prior?.transactionIds.sort().join(','), 'endo,nb', 'prior term includes NB + endorsement')
  assertEq(current?.transactionIds.join(','), 'ren', 'current term includes only the renewal')
  assertEq(prior?.transactionIds.includes('ren'), false, 'renewal is not on the prior term')
  assertEq(current?.transactionIds.includes('nb'), false, 'NB is not on the renewed term')
  assertEq(prior?.transactionIds.length, 2, 'prior term transaction count is 2')
  assertEq(current?.transactionIds.length, 1, 'current term transaction count is 1')
  const selectedPrior = resolvePolicyFileTerm(terms, 'nb')
  assertEq(selectedPrior?.termId, 'nb', 'selecting the prior term id opens that term')
  assertEq(resolvePolicyFileTerm(terms, 'missing')?.termId, 'ren', 'unknown term id falls back to current')
}

console.log('C. Term-specific financial totals / history')
{
  const terms = listPolicyFileTerms(glTerms, file)
  assertEq(terms[0]?.displayedPremium, 8400, 'prior term premium is NB + endorsement')
  assertEq(terms[1]?.displayedPremium, 9100, 'current term premium is renewal only')
  assertEq(terms[0]?.totals.totalAgencyCommission, 1050, 'prior term commission excludes renewal')
  assertEq(terms[1]?.totals.totalAgencyCommission, 1365, 'current term commission excludes prior NB')
  const currentLedger = policyTermFinancialTotals(glTerms)
  assertEq(currentLedger.currentPolicyPremium, 9100, 'current-term formula is unchanged')
  assert(!currentLedger.termTransactionIds.includes('nb'), 'current-term totals still exclude prior NB')
}

console.log('D. Client-level total premium does not double-count terms')
{
  const terms = listPolicyFileTerms(glTerms, file)
  const clientTotal = sumClientCurrentPremium([
    {
      policyPremium: 0,
      transactionPremiumSum: terms.find((term) => term.isCurrent)?.displayedPremium ?? 0,
      liveTransactionCount: terms.find((term) => term.isCurrent)?.liveTransactionCount ?? 0,
    },
  ])
  assertEq(clientTotal, 9100, 'client total uses the current term only, not 8400+9100')
  assert(clientTotal !== 17500, 'client total is not the sum of every term')
}

console.log('E. Display snapshots, grouping, paths, tenant isolation')
{
  assertEq(
    resolveDisplayedPolicyNumber({
      snapshotPolicyNumber: 'BHP-GL-2026-001',
      currentPolicyNumber: 'BHP-GL-2027-002',
    }),
    'BHP-GL-2026-001',
    'transaction displays prefer the snapshot number',
  )
  const grouped = groupPolicyTermsByLineOfBusiness([
    { policyType: 'General Liability', policyNumber: 'BHP-GL-2026-001' },
    { policyType: 'General Liability', policyNumber: 'BHP-GL-2027-002' },
    { policyType: 'Commercial Auto', policyNumber: 'BHP-CA-2026-001' },
  ])
  assertEq(grouped.length, 2, 'groups terms by line of business')
  assertEq(grouped[0]?.lineOfBusiness, 'General Liability', 'GL terms share a group')
  assertEq(grouped[0]?.terms.length, 2, 'both GL terms appear under the same LOB')
  assertEq(policyTermPath('policy-1', 'nb'), '/policies/policy-1?term=nb', 'prior term has a stable deep link')
  assert(assertRewriteSameAgency(AGENCY_A, AGENCY_A) === null, 'same-agency continuity is allowed')
  assert(assertRewriteSameAgency(AGENCY_A, AGENCY_B) !== null, 'cross-agency rewrite remains rejected')
}

console.log('F. Static wiring — no schema split, rewrite still first-class')
{
  const details = readFileSync(resolve(root, 'src/pages/PolicyDetails.tsx'), 'utf8')
  assert(details.includes('This term only'), 'Policy Details filters to one term')
  assert(details.includes('Rewritten from'), 'rewrite predecessor remains visible')
  assert(details.includes('Rewritten to'), 'rewrite successor remains visible')
  assert(!details.includes('title="Prior Terms"'), 'does not merge prior-term rows onto the current page')

  const clientDetails = readFileSync(resolve(root, 'src/pages/ClientDetails.tsx'), 'utf8')
  assert(clientDetails.includes('groupPolicyTermsByLineOfBusiness'), 'Client Details groups by LOB')
  assert(clientDetails.includes('policiesBase.map'), 'client total still sums current-term per Policy File')
  assert(clientDetails.includes('policyTermPath'), 'Client Details links each term separately')

  const files = readFileSync(resolve(root, 'src/pages/PolicyFiles.tsx'), 'utf8')
  assert(files.includes('listPolicyFileTerms'), 'Policy Files expands one file into term rows')
  assert(files.includes('currentTerms.reduce'), 'Policy Files KPI premium does not sum prior terms')
  assert(files.includes('policy.isCurrent'), 'Renew/Rewrite stay on the current term only')

  const renew = readFileSync(resolve(root, 'src/lib/policyRenewRewrite.ts'), 'utf8')
  assert(renew.includes('transactionType: \'renewal_premium\''), 'renew still writes a Renewal on the same file')
  assert(renew.includes('rewritten_from_policy_id: sourceId'), 'rewrite still creates a replacement policy')
  assert(renew.includes('freezeHistoricalPolicySnapshots'), 'renew still freezes historical snapshots')

  const recon = readFileSync(resolve(root, 'src/lib/reconciliation.ts'), 'utf8')
  assert(recon.includes('policies!transactions_policy_id_fkey ( policy_number )'), 'reconciliation still matches live Policy File numbers')
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed`)
console.log('validate-policy-term-history-v1: ALL GREEN')
