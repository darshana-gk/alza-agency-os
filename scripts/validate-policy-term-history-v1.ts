/**
 * V1 policy-term history UX (presentation over existing Policy Files).
 *
 * Does not require a policy_terms table or a new policy row per renewal.
 * Run: npx tsx scripts/validate-policy-term-history-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EXPIRED_TERM_ADD_WARNING,
  FILE_CURRENT_TERM_ID,
  groupPolicyTermsByLineOfBusiness,
  listPolicyFileTerms,
  policyTermCreateAnchor,
  policyTermCreateSnapshots,
  policyTermFinancialTotals,
  policyTermPath,
  resolveDisplayedPolicyNumber,
  resolvePolicyFileTerm,
  resolveTermTransactionPolicyNumber,
  sumClientCurrentPremium,
  toPolicyTermTxn,
  uniqueEstablishingHeads,
  type PolicyTermTxn,
} from '../src/lib/policyPremium.ts'
import { assertRewriteSameAgency } from '../src/lib/policyRenewRewrite.ts'
import { transactionTypesForPolicyTerm } from '../src/lib/commission.ts'
import { canManageTransactions, canRepairHistoricalPolicyTerm } from '../src/lib/permissions.ts'
import { planHistoricalTermSnapshotRepair } from '../src/lib/policyTermRepair.ts'

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
  assert(clientDetails.includes('rewrittenPredecessorIds'), 'client total excludes rewritten-away predecessors')
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

console.log('G. Expired-term Add Transaction + historical identity')
{
  const terms = listPolicyFileTerms(glTerms, file)
  const prior = terms[0]
  const current = terms[1]
  const priorAnchor = policyTermCreateAnchor(prior!)
  const priorSnap = policyTermCreateSnapshots(priorAnchor)
  const currentSnap = policyTermCreateSnapshots(policyTermCreateAnchor(current!))

  assertEq(priorSnap.lockPolicyIdentitySnapshot, true, 'expired term Add Transaction locks snapshots off the live Policy File')
  assertEq(priorSnap.policyNumber, 'BHP-GL-2026-001', 'historical-term Add Transaction prefills the old policy number')
  assertEq(priorSnap.policyEffectiveDate, '2026-09-01', 'historical-term Add Transaction prefills the old effective date')
  assertEq(priorSnap.policyExpirationDate, '2027-09-01', 'historical-term Add Transaction prefills the old expiration date')
  assertEq(priorSnap.producer, 'Avery Producer', 'historical-term Add Transaction prefills the old producer')
  assertEq(priorSnap.carrier, 'North Star Mutual', 'historical-term Add Transaction prefills the old carrier')
  assertEq(priorSnap.mga, 'Harbor MGA', 'historical-term Add Transaction prefills the old MGA')
  assertEq(priorSnap.csr, 'Blake CSR', 'historical-term Add Transaction prefills the old CSR')
  assertEq(priorSnap.defaultTransactionType, 'endorsement_premium', 'historical add defaults to endorsement, not a new term')
  assertEq(currentSnap.policyNumber, 'BHP-GL-2027-002', 'current term keeps the renewed policy number')
  assertEq(currentSnap.lockPolicyIdentitySnapshot, false, 'current term may still fill from the live Policy File')

  const historicalTypes = transactionTypesForPolicyTerm(false)
  assert(historicalTypes.includes('endorsement_premium'), 'expired term can add an endorsement')
  assert(historicalTypes.includes('audit_premium'), 'expired term can add an audit')
  assert(historicalTypes.includes('cancellation_premium'), 'expired term can add a cancellation')
  assert(!historicalTypes.includes('renewal_premium'), 'expired term cannot establish a renewal')
  assert(!historicalTypes.includes('new_policy_premium'), 'expired term cannot establish new business')

  const late = [
    ...glTerms,
    txn({
      id: 'late-endo',
      type: 'endorsement_premium',
      amount: 250,
      agencyCommissionAmount: 30,
      createdAt: '2027-10-15T10:00:00Z',
      transactionEffectiveDate: '2026-12-01',
      transactionExpirationDate: '2027-09-01',
      policyNumber: 'BHP-GL-2026-001',
      policyEffectiveDate: '2026-09-01',
      policyExpirationDate: '2027-09-01',
    }),
    txn({
      id: 'late-audit',
      type: 'audit_premium',
      amount: 100,
      agencyCommissionAmount: 12,
      createdAt: '2027-11-01T10:00:00Z',
      transactionEffectiveDate: '2027-01-15',
      transactionExpirationDate: '2027-09-01',
      policyNumber: 'BHP-GL-2026-001',
      policyEffectiveDate: '2026-09-01',
      policyExpirationDate: '2027-09-01',
    }),
  ]
  const afterLate = listPolicyFileTerms(late, file)
  assert(afterLate[0]?.transactionIds.includes('late-endo'), 'late endorsement belongs only to the old term')
  assert(afterLate[0]?.transactionIds.includes('late-audit'), 'late audit belongs only to the old term')
  assert(!afterLate[1]?.transactionIds.includes('late-endo'), 'late endorsement is not on the current term')
  assert(!afterLate[1]?.transactionIds.includes('late-audit'), 'late audit is not on the current term')
  assertEq(afterLate[1]?.displayedPremium, 9100, 'current term totals remain unchanged after late prior-term activity')
  assertEq(afterLate[0]?.displayedPremium, 8750, 'historical term totals update for late endorsement + audit')
  const currentLedger = policyTermFinancialTotals(late)
  assertEq(currentLedger.currentPolicyPremium, 9100, 'current-term financial formula is unchanged')

  const renamedFile = { ...file, policyNumber: 'BHP-GL-2027-002' }
  const afterRename = listPolicyFileTerms(glTerms, renamedFile)
  assertEq(afterRename[0]?.policyNumber, 'BHP-GL-2026-001', 'old number remains old after renewal rename')
  assertEq(afterRename[1]?.policyNumber, 'BHP-GL-2027-002', 'new term keeps the new number')
  const grouped = groupPolicyTermsByLineOfBusiness(
    afterRename.map((term) => ({ policyType: 'General Liability', policyNumber: term.policyNumber })),
  )
  assertEq(grouped[0]?.terms.map((t) => t.policyNumber).join(','), 'BHP-GL-2026-001,BHP-GL-2027-002', 'client Policy Summary shows both numbers')

  const nullSnapshotPrior = listPolicyFileTerms(
    [
      txn({
        id: 'nb-legacy',
        type: 'new_policy_premium',
        amount: 8000,
        createdAt: '2026-09-01T10:00:00Z',
        transactionEffectiveDate: '2026-09-01',
        transactionExpirationDate: '2027-09-01',
        policyNumber: null,
      }),
      glTerms[2],
    ],
    file,
  )
  assertEq(
    nullSnapshotPrior[0]?.policyNumber,
    '—',
    'missing historical snapshot is not replaced with the live current policy number',
  )

  assertEq(
    resolveTermTransactionPolicyNumber({
      snapshotPolicyNumber: '',
      termPolicyNumber: 'BHP-GL-2026-001',
      livePolicyNumber: 'BHP-GL-2027-002',
      isCurrentTerm: false,
    }),
    'BHP-GL-2026-001',
    'historical related-txn display uses term identity, not the live Policy File',
  )
  assertEq(
    resolveDisplayedPolicyNumber({
      snapshotPolicyNumber: 'BHP-GL-2026-001',
      currentPolicyNumber: 'BHP-GL-2027-002',
    }),
    'BHP-GL-2026-001',
    'snapshot wins over the live current number',
  )

  const details = readFileSync(resolve(root, 'src/pages/PolicyDetails.tsx'), 'utf8')
  assert(details.includes('policyTermCreateAnchor(selectedTerm)'), 'Policy Details anchors Add Transaction to the selected term')
  assert(details.includes('{canAddTxn && ('), 'expired terms still expose Add Transaction')
  assert(details.includes('canAddTxn && isCurrentTerm'), 'Renew/Rewrite remain gated to the current term')
  assert(details.includes('snapshotPolicyNumber'), 'Policy Details term identity uses raw snapshots')

  const modal = readFileSync(resolve(root, 'src/components/transactions/AddTransactionModal.tsx'), 'utf8')
  assert(modal.includes('EXPIRED_TERM_ADD_WARNING'), 'expired-term add shows the informational warning')
  assert(
    readFileSync(resolve(root, 'src/lib/policyPremium.ts'), 'utf8').includes(EXPIRED_TERM_ADD_WARNING),
    'expired-term warning copy is informational and not a save block',
  )
  assert(modal.includes('lockPolicyIdentitySnapshot: historicalTerm'), 'historical add does not stamp the live current policy number')

  const clientDetails = readFileSync(resolve(root, 'src/pages/ClientDetails.tsx'), 'utf8')
  assert(clientDetails.includes('PolicyTermActionsMenu'), 'Client Details Policy Summary has an Actions menu')
  assert(clientDetails.includes('canAddTransaction={canAddTxn}'), 'prior-term rows expose Add Transaction')
  assert(clientDetails.includes('snapshotPolicyNumber'), 'Client Details term identity uses raw snapshots')

  const createSrc = readFileSync(resolve(root, 'src/lib/commission.ts'), 'utf8')
  assert(createSrc.includes('lockPolicyIdentitySnapshot'), 'createTransaction can skip live Policy File fallback')

  assert(canManageTransactions('owner'), 'owner may add transactions')
  assert(canManageTransactions('admin'), 'admin may add transactions')
  assert(canManageTransactions('csr'), 'csr may add transactions')
  assert(!canManageTransactions('viewer'), 'viewer cannot add transactions')
  assert(!canManageTransactions('producer'), 'producer cannot add transactions')
}

console.log('H. Owner/Admin historical term snapshot repair')
{
  const termIds = ['nb', 'endo']
  const missing = [
    { id: 'nb', policyId: 'pol-1', transactionNumber: 'TXN-1', policyNumber: null, policyEffectiveDate: '2026-09-01', policyExpirationDate: '2027-09-01' },
    { id: 'endo', policyId: 'pol-1', transactionNumber: 'TXN-2', policyNumber: null, policyEffectiveDate: null, policyExpirationDate: null },
    { id: 'ren', policyId: 'pol-1', transactionNumber: 'TXN-3', policyNumber: 'BHP-GL-2027-002', policyEffectiveDate: '2027-09-01', policyExpirationDate: '2028-09-01' },
  ]
  const fill = planHistoricalTermSnapshotRepair({
    policyId: 'pol-1',
    termId: 'nb',
    isCurrent: false,
    termTransactionIds: termIds,
    rows: missing,
    policyNumber: 'BHP-GL-2026-001',
    policyEffectiveDate: '2026-09-01',
    policyExpirationDate: '2027-09-01',
  })
  assert(!fill.error, 'missing snapshots can be repaired')
  assertEq(fill.updates.map((u) => u.id).join(','), 'nb,endo', 'repair updates only the selected term')
  assert(!fill.updates.some((u) => u.id === 'ren'), 'current-term renewal row is not in the selected term update set')
  assertEq(fill.updates[0]?.policyNumber, 'BHP-GL-2026-001', 'establishing txn missing number is filled')
  assertEq(fill.updates[1]?.policyNumber, 'BHP-GL-2026-001', 'endorsement missing number is filled')
  assertEq(fill.updates[0]?.policyEffectiveDate, undefined, 'already-valid term effective date is not overwritten')
  assertEq(fill.updates[1]?.policyEffectiveDate, '2026-09-01', 'missing endorsement term dates are filled')

  const conflict = planHistoricalTermSnapshotRepair({
    policyId: 'pol-1',
    termId: 'nb',
    isCurrent: false,
    termTransactionIds: termIds,
    rows: [
      { id: 'nb', policyId: 'pol-1', policyNumber: 'BHP-GL-2026-001' },
      { id: 'endo', policyId: 'pol-1', policyNumber: null },
    ],
    policyNumber: 'BHP-GL-2027-002',
  })
  assert(Boolean(conflict.error), 'conflicting requested number vs valid snapshot stops save')
  assertEq(conflict.updates.length, 0, 'conflict does not patch any rows')

  const mixed = planHistoricalTermSnapshotRepair({
    policyId: 'pol-1',
    termId: 'nb',
    isCurrent: false,
    termTransactionIds: termIds,
    rows: [
      { id: 'nb', policyId: 'pol-1', policyNumber: 'BHP-GL-2026-001' },
      { id: 'endo', policyId: 'pol-1', policyNumber: 'OTHER' },
    ],
    policyNumber: 'BHP-GL-2026-001',
  })
  assert(Boolean(mixed.error), 'two different existing numbers stop save')

  const currentBlocked = planHistoricalTermSnapshotRepair({
    policyId: 'pol-1',
    termId: 'ren',
    isCurrent: true,
    termTransactionIds: ['ren'],
    rows: [{ id: 'ren', policyId: 'pol-1', policyNumber: null }],
    policyNumber: 'BHP-GL-2026-001',
  })
  assert(Boolean(currentBlocked.error), 'current term cannot be repaired through Edit Term Details')

  const otherPolicy = planHistoricalTermSnapshotRepair({
    policyId: 'pol-1',
    termId: 'nb',
    isCurrent: false,
    termTransactionIds: ['nb'],
    rows: [{ id: 'nb', policyId: 'pol-2', policyNumber: null }],
    policyNumber: 'BHP-GL-2026-001',
  })
  assert(Boolean(otherPolicy.error), 'rows from another Policy File are rejected')

  assert(canRepairHistoricalPolicyTerm('owner'), 'owner may repair historical term details')
  assert(canRepairHistoricalPolicyTerm('admin'), 'admin may repair historical term details')
  assert(!canRepairHistoricalPolicyTerm('csr'), 'csr cannot repair historical term details')
  assert(!canRepairHistoricalPolicyTerm('viewer'), 'viewer cannot repair historical term details')

  const details = readFileSync(resolve(root, 'src/pages/PolicyDetails.tsx'), 'utf8')
  assert(details.includes('Edit Term Details'), 'Policy Details exposes Edit Term Details')
  assert(details.includes('canRepairTerm && !isCurrentTerm'), 'Edit Term Details is historical-only')

  const repair = readFileSync(resolve(root, 'src/lib/policyTermRepair.ts'), 'utf8')
  assert(repair.includes("from('policies')"), 'repair loads the Policy File for RLS/tenant scope')
  assert(repair.includes('agency_profile_id'), 'repair compares caller agency to the Policy File')
  assert(!repair.includes("from('policies').update"), 'repair does not update the live Policy File')
  assert(repair.includes("action: 'policy_term_snapshot_repair'"), 'repair writes Activity History')
  assert(repair.includes('.eq(\'policy_id\', policyId)'), 'transaction updates stay on the selected Policy File')
  assert(repair.includes('.in(\'id\', termIds)'), 'transaction updates stay on the selected term ids')

  const activity = readFileSync(resolve(root, 'src/lib/activityPresentation.ts'), 'utf8')
  assert(activity.includes("case 'policy_term_snapshot_repair'"), 'Activity History labels the term repair action')
}

console.log('I. Rewritten Policy File with one New Business is a single current term')
{
  const rewriteFile = {
    policyNumber: 'BHP-GL-2027-RW 002',
    effectiveDate: '2027-01-14',
    expirationDate: '2028-01-14',
    producer: 'Casey Producer',
    csr: 'Drew CSR',
    carrier: 'Harbor Specialty',
    mga: 'Coastal MGA',
    premium: 0,
  }
  const rewriteNb = txn({
    id: 'rw-nb',
    type: 'new_policy_premium',
    amount: 10000,
    agencyCommissionAmount: 1250,
    brokerFee: 50,
    createdAt: '2027-01-14T18:00:00Z',
    transactionEffectiveDate: '2027-01-14',
    transactionExpirationDate: '2028-01-14',
    policyNumber: 'BHP-GL-2027-RW 002',
    policyEffectiveDate: '2027-01-14',
    policyExpirationDate: '2028-01-14',
    producer: 'Casey Producer',
    csr: 'Drew CSR',
    carrier: 'Harbor Specialty',
    mga: 'Coastal MGA',
  })
  const predecessorNb = txn({
    id: 'pred-nb',
    type: 'new_policy_premium',
    amount: 8425,
    createdAt: '2026-01-14T10:00:00Z',
    transactionEffectiveDate: '2026-01-14',
    transactionExpirationDate: '2027-01-14',
    policyNumber: 'BHP-GL-2026-001',
    policyEffectiveDate: '2026-01-14',
    policyExpirationDate: '2027-01-14',
  })

  const terms = listPolicyFileTerms([rewriteNb], rewriteFile)
  assertEq(terms.length, 1, 'rewritten file with one NB builds exactly one virtual term')
  assertEq(terms[0]?.isCurrent, true, 'that term is the current term')
  assertEq(terms[0]?.termId, 'rw-nb', 'term identity is the establishing New Business id')
  assertEq(terms[0]?.establishingTransactionId, 'rw-nb', 'establishing transaction id is unique')
  assertEq(terms[0]?.priorTermId, null, 'rewritten file does not synthesize a prior term')
  assertEq(terms[0]?.displayedPremium, 10000, 'current premium is the single New Business')
  assertEq(terms[0]?.transactionIds.join(','), 'rw-nb', 'transactions this term = 1')
  assertEq(terms.filter((term) => term.termId === 'rw-nb').length, 1, 'establishing txn id appears once')
  assert(!terms.some((term) => term.termId === FILE_CURRENT_TERM_ID), 'does not also emit a file-identity term')

  const selected = resolvePolicyFileTerm(terms, 'pred-nb')
  assertEq(selected?.termId, 'rw-nb', 'stale prior-term query does not select a missing predecessor term')
  assertEq(selected?.isCurrent, true, 'stale query still resolves to the current term')
  assertEq(Boolean(selected && !selected.isCurrent), false, 'no prior-term banner state')

  const duplicateId = listPolicyFileTerms([rewriteNb, { ...rewriteNb }], rewriteFile)
  assertEq(duplicateId.length, 1, 'same establishing txn id cannot produce two terms')
  assertEq(uniqueEstablishingHeads([rewriteNb, { ...rewriteNb }]).length, 1, 'uniqueEstablishingHeads dedupes by id')

  const sameDates = listPolicyFileTerms(
    [
      rewriteNb,
      txn({
        ...rewriteNb,
        id: 'rw-nb-copy',
        createdAt: '2027-01-14T18:01:00Z',
      }),
    ],
    rewriteFile,
  )
  assertEq(sameDates.length, 1, 'duplicate same-date establishing heads collapse to one term')
  assertEq(sameDates[0]?.isCurrent, true, 'collapsed rewrite term remains current')

  const replacementOnly = listPolicyFileTerms([rewriteNb], rewriteFile)
  assert(
    !replacementOnly.some((term) => term.policyNumber === 'BHP-GL-2026-001'),
    'predecessor policy number is not a term of the replacement file',
  )
  assertEq(
    listPolicyFileTerms([rewriteNb], rewriteFile).length,
    listPolicyFileTerms([rewriteNb], rewriteFile, {
      policyEffectiveDate: rewriteFile.effectiveDate,
      policyExpirationDate: rewriteFile.expirationDate,
    }).length,
    'file dates do not synthesize an extra term beside the New Business',
  )
  assertEq(
    listPolicyFileTerms([predecessorNb], {
      ...rewriteFile,
      policyNumber: 'BHP-GL-2026-001',
      effectiveDate: '2026-01-14',
      expirationDate: '2027-01-14',
    }).length,
    1,
    'predecessor file still has its own term when derived separately',
  )

  const details = readFileSync(resolve(root, 'src/pages/PolicyDetails.tsx'), 'utf8')
  assert(details.includes('termViews.length > 1'), 'term pills render only when multiple derived terms exist')
  assert(details.includes('!isCurrentTerm && selectedTerm'), 'prior-term banner follows selectedTerm.isCurrent')
  assert(details.includes('canRepairTerm && !isCurrentTerm'), 'Edit Term Details stays hidden on the current term')
  assert(details.includes('canEdit && isCurrentTerm'), 'Edit Policy remains a current-term action')
  assert(details.includes('canAddTxn && isCurrentTerm'), 'Renew remains a current-term action')
  assert(details.includes('canEdit && canAddTxn && isCurrentTerm'), 'Rewrite remains a current-term action')
  assert(details.includes('Rewritten from'), 'Rewritten From linkage remains on Policy Details')

  const renewLib = readFileSync(resolve(root, 'src/lib/policyRenewRewrite.ts'), 'utf8')
  assert(renewLib.includes('rewrittenFromPolicyId: sourceId'), 'rewrite still writes rewritten_from lineage')
  assert(renewLib.includes('transactionType: \'new_policy_premium\''), 'rewrite still opens with New Business')
}

console.log('J. Renewal Policy File still produces distinct selectable terms')
{
  const nb = txn({
    id: 'nb-2025',
    type: 'new_policy_premium',
    amount: 7000,
    createdAt: '2025-01-14T10:00:00Z',
    transactionEffectiveDate: '2025-01-14',
    transactionExpirationDate: '2026-01-14',
    policyNumber: 'BHP-GL-2025-001',
    policyEffectiveDate: '2025-01-14',
    policyExpirationDate: '2026-01-14',
  })
  const ren1 = txn({
    id: 'ren-2026',
    type: 'renewal_premium',
    amount: 8000,
    createdAt: '2026-01-14T10:00:00Z',
    transactionEffectiveDate: '2026-01-14',
    transactionExpirationDate: '2027-01-14',
    policyNumber: 'BHP-GL-2026-001',
    policyEffectiveDate: '2026-01-14',
    policyExpirationDate: '2027-01-14',
  })
  const ren2 = txn({
    id: 'ren-2027',
    type: 'renewal_premium',
    amount: 9000,
    createdAt: '2027-01-14T10:00:00Z',
    transactionEffectiveDate: '2027-01-14',
    transactionExpirationDate: '2028-01-14',
    policyNumber: 'BHP-GL-2027-002',
    policyEffectiveDate: '2027-01-14',
    policyExpirationDate: '2028-01-14',
  })
  const three = listPolicyFileTerms([nb, ren1, ren2], {
    policyNumber: 'BHP-GL-2027-002',
    effectiveDate: '2027-01-14',
    expirationDate: '2028-01-14',
    premium: 0,
  })
  assertEq(three.length, 3, 'three consecutive renewal terms remain distinct')
  assertEq(three.map((term) => term.termId).join(','), 'nb-2025,ren-2026,ren-2027', 'renewal terms stay separately selectable')
  assertEq(three[0]?.isCurrent, false, 'first NB term is historical')
  assertEq(three[1]?.isCurrent, false, 'middle renewal is historical')
  assertEq(three[2]?.isCurrent, true, 'latest renewal is current')
  assertEq(new Set(three.map((term) => term.termId)).size, 3, 'each establishing txn id appears once')
  assertEq(resolvePolicyFileTerm(three, 'nb-2025')?.termId, 'nb-2025', 'prior renewal-file term remains selectable')
  assertEq(resolvePolicyFileTerm(three, 'nb-2025')?.isCurrent, false, 'selected prior renewal-file term is not current')

  const twoTermFile = listPolicyFileTerms(glTerms, file)
  assertEq(twoTermFile.length, 2, 'renewal Policy File still produces multiple distinct terms')
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed`)
console.log('validate-policy-term-history-v1: ALL GREEN')
