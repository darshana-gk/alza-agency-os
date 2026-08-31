/**
 * Client Total Premium SoT — same resolveCurrentPolicyPremium used by Policy Files /
 * Policy Details / Client Details / Clients browse / Dashboard.
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

console.log('A. Stored opening with zero live transactions is $0')
{
  const totals = buildClientTotalPremiumByClientId({
    policies: [
      { id: 'p1', clientId: 'c1', premium: 12000 },
      { id: 'p2', clientId: 'c1', premium: 18000 },
      { id: 'p3', clientId: 'c2', premium: 22000 },
    ],
    transactionPremiumSumByPolicyId: new Map(),
  })
  assertEq(totals.get('c1'), 0, 'no live txns → client total 0')
  assertEq(totals.get('c2'), 0, 'no live txns → client total 0')
}

console.log('B. Multiple policies under one client — live ledger')
{
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 12000, transactionPremiumSum: 12000 },
      { policyPremium: 18000, transactionPremiumSum: 18000 },
    ]),
    30000,
    'two policies sum live txns',
  )
}

console.log('C. Stored opening is not added onto live endorsement')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 12000, transactionPremiumSum: 500 }),
    500,
    'single policy live endorsement only',
  )
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 12000, transactionPremiumSum: 500 },
      { policyPremium: 18000, transactionPremiumSum: 0 },
    ]),
    500,
    'client total ignores stored opening',
  )
}

console.log('D. Signed cancellation is the live total')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 22000, transactionPremiumSum: -2000 }),
    -2000,
    'live cancellation',
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

console.log('F. Archived/voided transactions excluded by caller (not in txn map)')
{
  const totals = buildClientTotalPremiumByClientId({
    policies: [{ id: 'p1', clientId: 'c1', premium: 10000 }],
    transactionPremiumSumByPolicyId: { p1: 250 },
  })
  assertEq(totals.get('c1'), 250, 'only live txn sum')
}

console.log('G. Agency B UAT — stored $300 must not inflate live $914')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 100, transactionPremiumSum: 100 }),
    100,
    'POL-STAGING-0001',
  )
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 200, transactionPremiumSum: 814 }),
    814,
    '2AG-B-POL-0001',
  )
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 100, transactionPremiumSum: 100 },
      { policyPremium: 200, transactionPremiumSum: 814 },
    ]),
    914,
    'client total matches Dashboard',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-client-total-premium: ALL GREEN')
