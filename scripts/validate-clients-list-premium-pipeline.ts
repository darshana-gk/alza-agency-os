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

console.log('B. QA master fixture — PostgREST-shaped rows → displayed totals')
{
  // Shape returned by: select('id, client_id, opening_premium:premium')
  const policyRows = [
    {
      id: 'pol-gl-001',
      client_id: CLIENT_ONE,
      opening_premium: 12000,
    },
    {
      id: 'pol-wc-002',
      client_id: CLIENT_ONE,
      opening_premium: 18000,
    },
    {
      id: 'pol-gl-003',
      client_id: CLIENT_TWO,
      opening_premium: 22000,
    },
  ]

  const { policyCountByClientId, totalPremiumByClientId } =
    aggregateClientsListPremiumFromRows({
      policies: policyRows,
      transactionPremiumSumByPolicyId: {
        'pol-gl-001': 0,
        'pol-wc-002': 0,
        'pol-gl-003': 0,
      },
    })

  assertEq(policyCountByClientId.get(CLIENT_ONE), 2, 'CLIENT ONE policy count 2')
  assertEq(policyCountByClientId.get(CLIENT_TWO), 1, 'CLIENT TWO policy count 1')
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'CLIENT ONE Total Premium 30000')
  assertEq(totalPremiumByClientId.get(CLIENT_TWO), 22000, 'CLIENT TWO Total Premium 22000')
  assertEq(
    formatCurrency(totalPremiumByClientId.get(CLIENT_ONE) ?? 0),
    '$30,000.00',
    'CLIENT ONE displayed $30,000.00',
  )
  assertEq(
    formatCurrency(totalPremiumByClientId.get(CLIENT_TWO) ?? 0),
    '$22,000.00',
    'CLIENT TWO displayed $22,000.00',
  )
}

console.log('C. Unaliased premium column still works (legacy select shape)')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, premium: 12000 },
      { id: 'p2', client_id: CLIENT_ONE, premium: 18000 },
    ],
    transactions: [],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'premium field path = 30k')
}

console.log('D. Numeric string premiums from PostgREST')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, opening_premium: '12000.00' },
      { id: 'p2', client_id: CLIENT_ONE, opening_premium: '18000' },
    ],
    transactions: [],
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
    transactions: [],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 30000, 'currency strings = 30k')
}

console.log('F. Opening + endorsement / cancellation via txn summaries')
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
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 28500, '12k+500 + 18k-2k = 28500')
}

console.log('G. Manual policy premium 0 + transactions')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [{ id: 'p1', client_id: CLIENT_TWO, opening_premium: 0 }],
    transactions: [{ policy_id: 'p1', amount: 9500 }],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_TWO), 9500, 'txn-only policy')
}

console.log('H. Null/missing premium treated as 0 (not NaN)')
{
  const { totalPremiumByClientId } = aggregateClientsListPremiumFromRows({
    policies: [
      { id: 'p1', client_id: CLIENT_ONE, opening_premium: null },
      { id: 'p2', client_id: CLIENT_ONE, opening_premium: 18000 },
    ],
    transactions: [],
  })
  assertEq(totalPremiumByClientId.get(CLIENT_ONE), 18000, 'null + 18k')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-clients-list-premium-pipeline: ALL GREEN')
