/**
 * Client Total Premium SoT — same resolveCurrentPolicyPremium used by Policy Files /
 * Policy Details / Client Details / Clients browse.
 *
 * Run: npx tsx scripts/validate-onboarding-client-total-premium.ts
 */

import {
  buildClientTotalPremiumByClientId,
  resolveCurrentPolicyPremium,
  sumClientCurrentPremium,
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

function assertEq(actual: unknown, expected: unknown, message: string) {
  assert(
    actual === expected,
    `${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  )
}

console.log('A. QA master clients — opening premium + zero transactions')
{
  const totals = buildClientTotalPremiumByClientId({
    policies: [
      { id: 'p1', clientId: 'c1', premium: 12000 },
      { id: 'p2', clientId: 'c1', premium: 18000 },
      { id: 'p3', clientId: 'c2', premium: 22000 },
    ],
    transactionPremiumSumByPolicyId: new Map(),
  })
  assertEq(totals.get('c1'), 30000, 'ALZA MASTER CLIENT ONE = 12k + 18k = 30k')
  assertEq(totals.get('c2'), 22000, 'ALZA MASTER CLIENT TWO = 22k')
}

console.log('B. Multiple policies under one client')
{
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 12000, transactionPremiumSum: 0 },
      { policyPremium: 18000, transactionPremiumSum: 0 },
    ]),
    30000,
    'two policies sum',
  )
}

console.log('C. Opening + positive endorsement')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 12000, transactionPremiumSum: 500 }),
    12500,
    'single policy opening + endorsement',
  )
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 12000, transactionPremiumSum: 500 },
      { policyPremium: 18000, transactionPremiumSum: 0 },
    ]),
    30500,
    'client total with endorsement on one policy',
  )
}

console.log('D. Opening + negative cancellation')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 22000, transactionPremiumSum: -2000 }),
    20000,
    'opening + cancellation',
  )
}

console.log('E. Manual policy premium 0 remains transaction-driven')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 0, transactionPremiumSum: 9500 }),
    9500,
    'Add Policy path',
  )
  assertEq(
    sumClientCurrentPremium([{ policyPremium: 0, transactionPremiumSum: 9500 }]),
    9500,
    'client total for manual policy',
  )
}

console.log('F. Archived transactions excluded by caller (not in txn map)')
{
  // Archived row must not be passed into transactionPremiumSumByPolicyId.
  const totals = buildClientTotalPremiumByClientId({
    policies: [{ id: 'p1', clientId: 'c1', premium: 10000 }],
    transactionPremiumSumByPolicyId: { p1: 250 }, // only live txns
  })
  assertEq(totals.get('c1'), 10250, 'archived amounts never included')
}

console.log('G. No double counting — opening once + txn deltas')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 10000, transactionPremiumSum: 0 }),
    10000,
    'zero txns = policies.premium once',
  )
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 10000, transactionPremiumSum: 1000 }),
    11000,
    'not max() or premium-or-txn',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-client-total-premium: ALL GREEN')
