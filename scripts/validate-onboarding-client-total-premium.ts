/**
 * Client Total Premium SoT — same resolveCurrentPolicyPremium used by Policy Files /
 * Policy Details / Client Details / Clients browse.
 * Dashboard Total Premium is agency book volume and is not this helper.
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

console.log('A. Stored opening with zero live transactions is the imported/reference premium')
{
  const totals = buildClientTotalPremiumByClientId({
    policies: [
      { id: 'p1', clientId: 'c1', premium: 12000 },
      { id: 'p2', clientId: 'c1', premium: 18000 },
      { id: 'p3', clientId: 'c2', premium: 22000 },
    ],
    transactionPremiumSumByPolicyId: new Map(),
    liveTransactionCountByPolicyId: new Map([
      ['p1', 0],
      ['p2', 0],
      ['p3', 0],
    ]),
  })
  assertEq(totals.get('c1'), 30000, 'no live txns → client total uses imported premiums')
  assertEq(totals.get('c2'), 22000, 'no live txns → client total uses imported premium')
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
    resolveCurrentPolicyPremium({
      policyPremium: 12000,
      transactionPremiumSum: 500,
      liveTransactionCount: 1,
    }),
    500,
    'single policy live endorsement only',
  )
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 12000, transactionPremiumSum: 500, liveTransactionCount: 1 },
      { policyPremium: 18000, transactionPremiumSum: 0, liveTransactionCount: 1 },
    ]),
    500,
    'client total uses live term even when a sibling policy nets to $0',
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

console.log('G. Agency B UAT — stored $300 must not inflate injected current-term sums')
{
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 100, transactionPremiumSum: 100 }),
    100,
    'POL-STAGING-0001',
  )
  assertEq(
    resolveCurrentPolicyPremium({ policyPremium: 200, transactionPremiumSum: 814 }),
    814,
    'injected current-term sum ignores stored $200',
  )
  assertEq(
    sumClientCurrentPremium([
      { policyPremium: 100, transactionPremiumSum: 100 },
      { policyPremium: 200, transactionPremiumSum: 814 },
    ]),
    914,
    'client total uses injected current-term sums, not stored opening',
  )
}

console.log('G. Rewrite replacement is not added to the replaced Policy File current premium')
{
  const totals = buildClientTotalPremiumByClientId({
    policies: [
      { id: 'old-file', clientId: 'c1', premium: 0 },
      { id: 'new-file', clientId: 'c1', premium: 0, rewrittenFromPolicyId: 'old-file' },
    ],
    transactionPremiumSumByPolicyId: new Map([
      ['old-file', 8425],
      ['new-file', 7600],
    ]),
    liveTransactionCountByPolicyId: new Map([
      ['old-file', 1],
      ['new-file', 1],
    ]),
  })
  assertEq(totals.get('c1'), 7600, 'client total excludes the rewritten-away predecessor')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-client-total-premium: ALL GREEN')
