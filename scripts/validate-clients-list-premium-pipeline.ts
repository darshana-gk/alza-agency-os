/**
 * Clients browse page — query-row → aggregation → displayed Total Premium.
 * Covers the exact pipeline Clients.tsx uses (not only standalone helpers).
 *
 * Run: npx tsx scripts/validate-clients-list-premium-pipeline.ts
 */

import {
  aggregateClientsListPremiumFromRows,
  CLIENTS_LIST_POLICY_PREMIUM_SELECT,
  coercePolicyPremiumValue,
} from '../src/lib/clientsListPremium.ts'
import { formatCurrency } from '../src/lib/commission.ts'

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

const CLIENT_ONE = '6c9fa4c1-ca79-4b47-b3a0-3acc7764e1ad'
const CLIENT_TWO = 'b58a2707-94fd-4d67-a53b-322009b44204'
const AGENCY_B_CLIENT = 'b5000000-0000-4000-8000-0000000000b5'

console.log('A. Clients.tsx select contract includes aliased policies.premium')
{
  assert(
    CLIENTS_LIST_POLICY_PREMIUM_SELECT.includes('opening_premium:premium'),
    'select aliases policies.premium as opening_premium',
  )
  assert(
    CLIENTS_LIST_POLICY_PREMIUM_SELECT.includes('client_id'),
    'select includes client_id',
  )
}

console.log('B. Stored opening with zero live txns displays imported/reference premium')
{
  const policyRows = [
    { id: 'pol-gl-001', client_id: CLIENT_ONE, opening_premium: 12000 },
    { id: 'pol-wc-002', client_id: CLIENT_ONE, opening_premium: 18000 },
    { id: 'pol-gl-003', client_id: CLIENT_TWO, opening_premium: 22000 },
  ]

  const { policyCountByClientId, totalPremiumByClientId } =
    aggregateClientsListPremiumFromRows({
      policies: policyRows,
      transactionPremiumSumByPolicyId: {
        'pol-gl-001': 0,
        'pol-wc-002': 0,
        'pol-gl-003': 0,
      },
      liveTransactionCountByPolicyId: {
        'pol-gl-001': 0,
        'pol-wc-002': 0,
        'pol-gl-003': 0,
      },
    })

  assertEq(policyCountByClientId.get(CLIENT_ONE), 2, 'CLIENT ONE policy count 2')
  assertEq(policyCountByClientId.get(CLIENT_TWO), 1, 'CLIENT TWO policy count 1')
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'CLIENT ONE Total Premium uses imported premiums')
  assertEq(totalPremiumByClientId.get(CLIENT_TWO), 22000, 'CLIENT TWO Total Premium uses imported premium')
}

console.log('C. Live ledger sums are the displayed totals')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, premium: 12000 },
      { id: 'p2', client_id: CLIENT_ONE, premium: 18000 },
    ],
    transactionPremiumSumByPolicyId: { p1: 12000, p2: 18000 },
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'live txn path = 30k')
  assertEq(
    formatCurrency(totalPremiumByClientId.get(CLIENT_ONE) ?? 0),
    '$30,000.00',
    'CLIENT ONE displayed $30,000.00',
  )
}

console.log('D. Numeric string live amounts from PostgREST')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, opening_premium: '12000.00' },
      { id: 'p2', client_id: CLIENT_ONE, opening_premium: '18000' },
    ],
    transactions: [
      { policy_id: 'p1', amount: '12000.00' },
      { policy_id: 'p2', amount: '18000' },
    ],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'string numerics = 30k')
}

console.log('E. Currency-formatted strings must not collapse to 0')
{
  assertEq(coercePolicyPremiumValue('12,000'), 12000, 'coerce 12,000')
  assertEq(coercePolicyPremiumValue('$18,000.00'), 18000, 'coerce $18,000.00')
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, opening_premium: '$12,000' },
      { id: 'p2', client_id: CLIENT_ONE, opening_premium: '18,000' },
    ],
    transactions: [
      { policy_id: 'p1', amount: '$12,000' },
      { policy_id: 'p2', amount: '18,000' },
    ],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'currency strings = 30k')
}

console.log('F. Endorsement / cancellation via txn summaries — stored opening ignored')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, opening_premium: 12000 },
      { id: 'p2', client_id: CLIENT_ONE, opening_premium: 18000 },
    ],
    transactionPremiumSumByPolicyId: {
      p1: 500,
      p2: -2000,
    },
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), -1500, '500 + -2000 = -1500')
}

console.log('G. Manual policy premium 0 + transactions')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'p1', client_id: CLIENT_TWO, opening_premium: 0 }],
    transactions: [{ policy_id: 'p1', amount: 9500 }],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_TWO), 9500, 'txn-only policy')
}

console.log('H. Voided/archived rows excluded from live sum')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'p1', client_id: CLIENT_ONE, opening_premium: 100 }],
    transactions: [
      { policy_id: 'p1', amount: 100, voided_at: null },
      { policy_id: 'p1', amount: 300, voided_at: '2026-08-31T00:00:00Z' },
      { policy_id: 'p1', amount: 50, archived_at: '2026-08-31T00:00:00Z' },
    ],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 100, 'voided and archived excluded')
}

console.log('I. Agency B UAT BUG 002 — stored $300 must not inflate injected current-term sums')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      {
        id: 'b6000000-0000-4000-8000-0000000000b6',
        client_id: AGENCY_B_CLIENT,
        opening_premium: 100,
      },
      {
        id: 'b6100000-0000-4000-8000-000000000061',
        client_id: AGENCY_B_CLIENT,
        opening_premium: 200,
      },
    ],
    transactionPremiumSumByPolicyId: {
      'b6000000-0000-4000-8000-0000000000b6': 100,
      'b6100000-0000-4000-8000-000000000061': 814,
    },
  })
  assertEq(totalPremiumByClientId.get(AGENCY_B_CLIENT), 914, 'injected current-term sums ignore stored $300')
  assertEq(
    formatCurrency(totalPremiumByClientId.get(AGENCY_B_CLIENT) ?? 0),
    '$914.00',
    'displayed $914.00 from injected sums',
  )
}

console.log('J. Fallback txn rows use current-term (latest NB, not lifetime SUM)')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'p1', client_id: CLIENT_ONE, opening_premium: 300 }],
    transactions: [
      {
        id: 'old',
        policy_id: 'p1',
        amount: 814,
        transaction_type: 'new_policy_premium',
        created_at: '2026-08-01T10:00:00Z',
      },
      {
        id: 'uat011',
        policy_id: 'p1',
        amount: 1000,
        transaction_type: 'new_policy_premium',
        created_at: '2026-08-31T11:49:12Z',
      },
    ],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 1000, 'latest NB is current premium, not 1814')
}

console.log('K. Master Agency imported premium with zero txns; live term not double-counted')
{
  const none = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'bhp', client_id: CLIENT_ONE, opening_premium: 8425 }],
    transactionPremiumSumByPolicyId: { bhp: 0 },
    liveTransactionCountByPolicyId: { bhp: 0 },
  })
  assertEq(none.totalPremiumByClientId.get(CLIENT_ONE), 8425, 'imported $8,425 with 0 txns')

  const live = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'bhp', client_id: CLIENT_ONE, opening_premium: 8425 }],
    transactionPremiumSumByPolicyId: { bhp: 1000 },
    liveTransactionCountByPolicyId: { bhp: 1 },
  })
  assertEq(live.totalPremiumByClientId.get(CLIENT_ONE), 1000, 'live NB replaces imported, not $9,425')

  const netZero = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'bhp', client_id: CLIENT_ONE, opening_premium: 8425 }],
    transactionPremiumSumByPolicyId: { bhp: 0 },
    liveTransactionCountByPolicyId: { bhp: 2 },
  })
  assertEq(netZero.totalPremiumByClientId.get(CLIENT_ONE), 0, 'live term net $0 stays $0')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-clients-list-premium-pipeline: ALL GREEN')
