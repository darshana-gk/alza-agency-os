/**
 * Current Policy Premium / policy-term financial SoT.
 *
 * Formula under test:
 *   no live transactions → imported/reference policies.premium
 *   current term = latest live New Business or Renewal
 *                + live endorsements/audits/cancellations in that term
 *   voided/archived excluded
 *   policies.premium never added onto live current-term totals
 *
 * Run: npx tsx scripts/validate-onboarding-policy-premium-display.ts
 */

import { deriveCommission } from '../src/lib/commission.ts'
import {
  currentPolicyPremiumFromTransactions,
  policyTermFinancialTotals,
  resolveCurrentPolicyPremium,
  roundPolicyPremiumMoney,
  selectCurrentTermTransactions,
  sumTransactionPremiumAmounts,
  toPolicyPremiumTxn,
  type PolicyPremiumTxn,
} from '../src/lib/policyPremium.ts'

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

function assertEq(actual: number | string, expected: number | string, message: string) {
  assert(actual === expected, `${message} (got ${actual}, expected ${expected})`)
}

function txn(partial: Partial<PolicyPremiumTxn> & { type: string; amount: number }): PolicyPremiumTxn {
  return toPolicyPremiumTxn(partial)
}

console.log('A. No live transactions → imported/reference premium')
{
  const current = resolveCurrentPolicyPremium({
    policyPremium: 8425,
    transactionPremiumSum: 0,
    liveTransactionCount: 0,
  })
  assertEq(current, 8425, 'zero live txns → imported $8,425, not $0')
}

console.log('B. Caller-provided current-term sum is not added to policies.premium')
{
  const txnSum = sumTransactionPremiumAmounts([500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
    liveTransactionCount: 1,
  })
  assertEq(current, 500, 'does not add stored opening onto live current-term sum')
}

console.log('C. New Business establishes current-term premium')
{
  const rows = [txn({ id: 'nb', type: 'new_policy_premium', amount: 1000, createdAt: '2026-08-31T11:00:00Z' })]
  assertEq(currentPolicyPremiumFromTransactions(rows), 1000, 'NB $1000 → current $1000')
}

console.log('D. Endorsement ± and audit ± adjust the term')
{
  const base: PolicyPremiumTxn[] = [
    txn({
      id: 'nb',
      type: 'new_policy_premium',
      amount: 1000,
      createdAt: '2026-08-31T10:00:00Z',
      transactionEffectiveDate: '2026-08-31',
      transactionExpirationDate: '2027-08-31',
    }),
  ]
  assertEq(
    currentPolicyPremiumFromTransactions([
      ...base,
      txn({
        id: 'endo+',
        type: 'endorsement_premium',
        amount: 100,
        createdAt: '2026-09-01T10:00:00Z',
        transactionEffectiveDate: '2026-09-01',
      }),
    ]),
    1100,
    'NB 1000 + endo +100 = 1100',
  )
  assertEq(
    currentPolicyPremiumFromTransactions([
      ...base,
      txn({
        id: 'endo-',
        type: 'endorsement_premium',
        amount: -200,
        createdAt: '2026-09-01T10:00:00Z',
        transactionEffectiveDate: '2026-09-01',
      }),
    ]),
    800,
    'NB 1000 + endo -200 = 800',
  )
  assertEq(
    currentPolicyPremiumFromTransactions([
      ...base,
      txn({
        id: 'audit+',
        type: 'audit_premium',
        amount: 50,
        createdAt: '2026-10-01T10:00:00Z',
        transactionEffectiveDate: '2026-10-01',
      }),
    ]),
    1050,
    'NB 1000 + audit +50 = 1050',
  )
  assertEq(
    currentPolicyPremiumFromTransactions([
      ...base,
      txn({
        id: 'audit-',
        type: 'audit_premium',
        amount: -25,
        createdAt: '2026-10-01T10:00:00Z',
        transactionEffectiveDate: '2026-10-01',
      }),
    ]),
    975,
    'NB 1000 + audit -25 = 975',
  )
}

console.log('E. Cancellation reduces current-term premium')
{
  assertEq(
    currentPolicyPremiumFromTransactions([
      txn({
        id: 'nb',
        type: 'new_policy_premium',
        amount: 1000,
        createdAt: '2026-08-31T10:00:00Z',
        transactionEffectiveDate: '2026-08-31',
        transactionExpirationDate: '2027-08-31',
      }),
      txn({
        id: 'cx',
        type: 'cancellation_premium',
        amount: -300,
        createdAt: '2026-12-01T10:00:00Z',
        transactionEffectiveDate: '2026-12-01',
      }),
    ]),
    700,
    'NB 1000 + cancel -300 = 700',
  )
}

console.log('F. Renewal starts a new term and does not accumulate the expired term')
{
  const rows = [
    txn({
      id: 'nb',
      type: 'new_policy_premium',
      amount: 800,
      createdAt: '2025-08-31T10:00:00Z',
      transactionEffectiveDate: '2025-08-31',
      transactionExpirationDate: '2026-08-31',
    }),
    txn({
      id: 'ren',
      type: 'renewal_premium',
      amount: 1000,
      createdAt: '2026-08-31T10:00:00Z',
      transactionEffectiveDate: '2026-08-31',
      transactionExpirationDate: '2027-08-31',
    }),
    txn({
      id: 'endo',
      type: 'endorsement_premium',
      amount: 50,
      createdAt: '2026-09-15T10:00:00Z',
      transactionEffectiveDate: '2026-09-15',
    }),
  ]
  assertEq(currentPolicyPremiumFromTransactions(rows), 1050, 'renewal 1000 + endo 50 = 1050, not 1850')
  const termIds = selectCurrentTermTransactions(rows).map((t) => t.id)
  assert(!termIds.includes('nb'), 'expired NB is not in the current term set')
  assert(termIds.includes('ren') && termIds.includes('endo'), 'renewal + in-term endo are current')
}

console.log('G. Voided and archived rows never affect current-term totals')
{
  const rows = [
    txn({
      id: 'nb',
      type: 'new_policy_premium',
      amount: 1000,
      createdAt: '2026-08-31T11:00:00Z',
    }),
    txn({
      id: 'void-nb',
      type: 'new_policy_premium',
      amount: 99999,
      createdAt: '2026-08-31T09:00:00Z',
      voidedAt: '2026-08-31T09:30:00Z',
    }),
    txn({
      id: 'arch-endo',
      type: 'endorsement_premium',
      amount: 400,
      createdAt: '2026-09-01T10:00:00Z',
      archived: true,
    }),
  ]
  assertEq(currentPolicyPremiumFromTransactions(rows), 1000, 'voided $99,999 and archived endo excluded')
}

console.log('H. Multiple New Business rows: latest establishing wins (not a lifetime SUM)')
{
  const rows = [
    txn({ id: 'old1', type: 'new_policy_premium', amount: 200, createdAt: '2026-08-01T10:00:00Z' }),
    txn({ id: 'old2', type: 'new_policy_premium', amount: 81, createdAt: '2026-08-15T10:00:00Z' }),
    txn({
      id: 'uat011',
      type: 'new_policy_premium',
      amount: 1000,
      createdAt: '2026-08-31T11:49:12Z',
      agencyCommissionAmount: 100,
      producerCommissionAmount: 100,
      brokerFee: 0,
      agencyNetCommission: 0,
    }),
  ]
  const totals = policyTermFinancialTotals(rows)
  assertEq(totals.currentPolicyPremium, 1000, '2AG-B-POL-0001 current premium is $1000 not $1,814')
  assertEq(totals.totalAgencyCommission, 100, 'current-term agency commission is the latest NB only')
  assertEq(totals.totalProducerCommission, 100, 'current-term producer commission is the latest NB only')
}

console.log('I. Broker-fee sharing snapshot math (form / persist identity)')
{
  const derived = deriveCommission({
    commissionType: 'percentage',
    baseAmount: 1000,
    agencyCommissionPercentage: 10,
    agencyCommissionAmount: null,
    brokerFee: 100,
    producerSplitPercentage: 50,
  })
  assertEq(derived.agencyCommissionAmount, 100, '10% of $1000 = $100 agency')
  assertEq(derived.brokerFee, 100, 'broker fee snapshot $100')
  assertEq(derived.commissionPool, 200, 'pool = agency + broker')
  assertEq(derived.producerCommissionAmount, 100, '50% of $200 pool = $100 producer')
  assertEq(derived.agencyNetCommission, 100, 'agency net = pool − producer')

  const zeroBroker = deriveCommission({
    commissionType: 'percentage',
    baseAmount: 1000,
    agencyCommissionPercentage: 10,
    agencyCommissionAmount: null,
    brokerFee: 0,
    producerSplitPercentage: 50,
  })
  assertEq(zeroBroker.commissionPool, 100, 'BUG008 pool with $0 broker = $100')
  assertEq(zeroBroker.producerCommissionAmount, 50, 'BUG008 50% of $100 pool = $50')
  assertEq(zeroBroker.agencyNetCommission, 50, 'BUG008 agency net $50')
  assertEq(derived.agencyNetCommission, 100, 'agency net = pool − producer')

  const persisted = policyTermFinancialTotals([
    txn({
      id: 'snap',
      type: 'new_policy_premium',
      amount: 1000,
      createdAt: '2026-08-31T11:49:12Z',
      agencyCommissionAmount: derived.agencyCommissionAmount,
      brokerFee: derived.brokerFee,
      producerCommissionAmount: derived.producerCommissionAmount,
      agencyNetCommission: derived.agencyNetCommission,
    }),
  ])
  assertEq(persisted.totalBrokerFees, 100, 'broker fee survives as a snapshot total')
  assertEq(persisted.totalCommissionPool, 200, 'pool from persisted components')
  assertEq(persisted.totalAgencyNet, 100, 'agency net survives identically after reload')
}

console.log('J. Lossy TRX-2026-000011 row cannot recover broker/split from stored evidence')
{
  const persisted = policyTermFinancialTotals([
    txn({
      id: 'a9fc0bd7-57be-4492-9444-b863ee13ce45',
      type: 'new_policy_premium',
      amount: 1000,
      createdAt: '2026-08-31T11:49:12Z',
      agencyCommissionAmount: 100,
      producerCommissionAmount: 100,
      brokerFee: 0,
      agencyNetCommission: 0,
    }),
  ])
  assertEq(persisted.totalBrokerFees, 0, 'missing broker_fee column defaulted to 0 — not recovered')
  assertEq(persisted.totalAgencyNet, 0, 'missing agency_net defaulted to 0 — not recovered')
  assert(
    persisted.totalProducerCommission === 100 && persisted.totalAgencyCommission === 100,
    'premium/agency/producer amounts that did persist are unchanged',
  )
}

console.log('K. Null / invalid stored premium ignored')
{
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: null,
      transactionPremiumSum: 250,
      liveTransactionCount: 1,
    }),
    250,
    'null policy premium',
  )
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: undefined,
      transactionPremiumSum: 100,
      liveTransactionCount: 1,
    }),
    100,
    'undefined policy premium',
  )
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: Number.NaN,
      transactionPremiumSum: 75,
      liveTransactionCount: 1,
    }),
    75,
    'NaN policy premium',
  )
  assert(roundPolicyPremiumMoney(100 + 814) === 914, 'round helper stable')
}

console.log('L. Master Agency imported premium vs later live term (no double-count)')
{
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: 8425,
      transactionPremiumSum: 0,
      liveTransactionCount: 0,
    }),
    8425,
    'BHP-GL-2026-001: no txns → $8,425',
  )
  assertEq(
    policyTermFinancialTotals([]).currentPolicyPremium,
    0,
    'Financial Totals commission path stays $0 with no txns',
  )
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: 8425,
      transactionPremiumSum: 1000,
      liveTransactionCount: 1,
    }),
    1000,
    'later NB $1,000 replaces reference; not $9,425',
  )
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: 8425,
      transactionPremiumSum: 8525,
      liveTransactionCount: 2,
    }),
    8525,
    'NB + endorsement is live term only, not 8425+8525',
  )
  assertEq(
    resolveCurrentPolicyPremium({
      policyPremium: 8425,
      transactionPremiumSum: 0,
      liveTransactionCount: 2,
    }),
    0,
    'live term that nets to $0 stays $0, does not restore imported $8,425',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-policy-premium-display: ALL GREEN')
