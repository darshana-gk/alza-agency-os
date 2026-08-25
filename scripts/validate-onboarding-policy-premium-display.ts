/**
 * Current Policy Premium display SoT — onboarding opening + transaction deltas.
 *
 * Formula under test:
 *   current = policies.premium + SUM(non-archived transaction amounts)
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

console.log('A. Imported opening premium + zero transactions')
{
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: 0,
  })
  assertEq(current, 10000, 'shows imported opening premium, not $0')
}

console.log('B. Imported opening + subsequent positive endorsement')
{
  const txnSum = sumTransactionPremiumAmounts([500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 10500, 'opening + positive endorsement')
}

console.log('C. Imported opening + subsequent negative cancellation/audit')
{
  const txnSum = sumTransactionPremiumAmounts([-2500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 7500, 'opening + negative adjustment')
}

console.log('D. Imported opening + mixed signed transactions')
{
  const txnSum = sumTransactionPremiumAmounts([1500, -300, 50.555])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 11250.56, 'opening + mixed deltas, money-rounded')
}

console.log('E. Manually created policy (premium 0) + transactions — ledger-only (no double-count)')
{
  const txnSum = sumTransactionPremiumAmounts([12000, -500])
  const current = resolveCurrentPolicyPremium({
    policyPremium: 0,
    transactionPremiumSum: txnSum,
  })
  assertEq(current, 11500, 'Add Policy path equals SUM(txns) when policies.premium is 0')
}

console.log('F. Null / invalid stored premium treated as 0')
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

console.log('G. No synthetic double-count when opening already on policies.premium')
{
  // If UI used max(premium, txnSum) or premium-or-txn fallback wrong, 10000+10000 would appear.
  // Correct additive model: opening stored once; later NEW_POLICY txn would double-count — product
  // guidance is to book deltas only after onboarding, not a second full premium txn.
  const current = resolveCurrentPolicyPremium({
    policyPremium: 10000,
    transactionPremiumSum: 0,
  })
  assertEq(current, 10000, 'zero txns → exactly policies.premium once')
  assert(roundPolicyPremiumMoney(10000 + 0) === 10000, 'round helper stable')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
