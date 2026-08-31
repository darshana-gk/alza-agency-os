/**
 * Current Policy Premium display SoT — live ledger only (Dashboard / Phase 4F).
 *
 * Formula under test:
 *   current = SUM(non-archived, non-voided transaction amounts)
 *
 * Run: npx tsx scripts/validate-onboarding-policy-premium-display.ts
 */

import {
  resolveCurrentPolicyPremium,
  roundPolicyPremiumMoney,
  sumTransactionPremiumAmounts,
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

function assertEq(actual: number, expected: number, message: string) {
  assert(actual === expected, `${message} (got ${actual}, expected ${expected})`)
}

console.log('A. Stored reference premium is not a live total')
{
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: 0,
  })
  assertEq(current, 0, 'zero live txns → $0, not imported policies.premium')
}

console.log('B. Live endorsement sum is the current premium')
{
  const txnSum = sumTransactionPremiumAmounts([500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 500, 'does not add stored opening onto live txns')
}

console.log('C. Signed cancellation/audit')
{
  const txnSum = sumTransactionPremiumAmounts([-2500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, -2500, 'negative live ledger')
}

console.log('D. Mixed signed transactions, money-rounded')
{
  const txnSum = sumTransactionPremiumAmounts([1500, -300, 50.555])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 1250.56, 'mixed deltas, money-rounded')
}

console.log('E. Manually created policy (premium 0) + transactions')
{
  const txnSum = sumTransactionPremiumAmounts([12000, -500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 0,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 11500, 'Add Policy path equals SUM(txns)')
}

console.log('F. Null / invalid stored premium ignored')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: null, transactionPremiumSum: 250 }),
    250,
    'null policy premium',
  )
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: undefined, transactionPremiumSum: 100 }),
    100,
    'undefined policy premium',
  )
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: Number.NaN, transactionPremiumSum: 75 }),
    75,
    'NaN policy premium',
  )
}

console.log('G. Agency B UAT double-count: stored $300 + live $914 → $914')
{
  const currentPolStaging = resolveCurrentPolicyPremium({
    policyPremium: 100,
    transactionPremiumSum: 100,
  })
  const currentPol0001 = resolveCurrentPolicyPremium({
    policyPremium: 200,
    transactionPremiumSum: 814,
  })
  assertEq(currentPolStaging, 100, 'POL-STAGING-0001 live $100, not $200')
  assertEq(currentPol0001, 814, '2AG-B-POL-0001 live $814, not $1,014')
  assertEq(currentPolStaging + currentPol0001, 914, 'client total matches Dashboard $914')
  assert(roundPolicyPremiumMoney(100 + 814) === 914, 'round helper stable')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
