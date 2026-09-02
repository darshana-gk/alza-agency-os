/**
 * V1 Renew / Rewrite workflow tests (no Production writes).
 *
 * Covers:
 *   - next-term date defaults
 *   - prefilled setup vs blank premium / actual commission
 *   - Rewrite creation + bidirectional linkage
 *   - same-agency isolation
 *   - Renewal current-term rollover (prior NB/endo/audit/cancel excluded)
 *
 * Run: npx tsx scripts/validate-policy-renew-rewrite-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { policyTermFinancialTotals, toPolicyPremiumTxn, type PolicyPremiumTxn } from '../src/lib/policyPremium.ts'
import {
  assertNotSelfRewrite,
  assertRewriteSameAgency,
  buildRenewedPolicyCurrentSetup,
  defaultNextTermDates,
  renewedSetupToPolicyPatch,
  renewalPrefillFromPolicy,
  renewPolicy,
  rewritePolicy,
  rewritePrefillFromPolicy,
  type RenewPolicyInput,
  type RenewRewritePolicySnapshot,
  type RewritePolicyInput,
} from '../src/lib/policyRenewRewrite.ts'
import type { CreatePolicyInput } from '../src/lib/directory.ts'

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

function txn(partial: Partial<PolicyPremiumTxn> & { type: string; amount: number }): PolicyPremiumTxn {
  return toPolicyPremiumTxn(partial)
}

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const SOURCE_POLICY_ID = 'policy-source-1'

function samplePolicy(overrides: Partial<RenewRewritePolicySnapshot> = {}): RenewRewritePolicySnapshot {
  return {
    id: SOURCE_POLICY_ID,
    clientId: 'client-1',
    clientName: 'Blue Harbor Plumbing LLC',
    policyNumber: 'BHP-GL-2026-001',
    policyType: 'General Liability',
    carrier: 'North Star Mutual',
    mga: 'Harbor MGA',
    producer: 'Avery Producer',
    csr: 'Blake CSR',
    effectiveDate: '2025-09-01',
    expirationDate: '2026-09-01',
    status: 'active',
    notes: 'imported',
    commissionType: 'percentage',
    agencyCommissionPercentage: 12.5,
    agencyCommissionAmount: 842.5,
    brokerFee: 50,
    producerSplitPercentage: 60,
    overrideSplit: true,
    agencyProfileId: AGENCY_A,
    premium: 8425,
    ...overrides,
  }
}

function rewriteInput(overrides: Partial<RewritePolicyInput> = {}): RewritePolicyInput {
  return {
    sourcePolicyId: SOURCE_POLICY_ID,
    clientId: 'client-1',
    policyNumber: 'BHP-GL-2027-RW',
    policyType: 'General Liability',
    carrier: 'North Star Mutual',
    mga: 'Harbor MGA',
    producer: 'Avery Producer',
    csr: 'Blake CSR',
    effectiveDate: '2026-09-01',
    expirationDate: '2027-09-01',
    premiumAmount: 9100,
    commissionType: 'percentage',
    agencyCommissionPercentage: 12.5,
    agencyCommissionAmount: null,
    brokerFee: 50,
    producerSplitPercentage: 60,
    ...overrides,
  }
}

function renewInput(overrides: Partial<RenewPolicyInput> = {}): RenewPolicyInput {
  return {
    sourcePolicyId: SOURCE_POLICY_ID,
    clientId: 'client-1',
    policyNumber: 'BHP-GL-2026-001',
    policyType: 'General Liability',
    carrier: 'North Star Mutual',
    mga: 'Harbor MGA',
    producer: 'Avery Producer',
    csr: 'Blake CSR',
    effectiveDate: '2026-09-01',
    expirationDate: '2027-09-01',
    premiumAmount: 9100,
    commissionType: 'percentage',
    agencyCommissionPercentage: 12.5,
    agencyCommissionAmount: null,
    brokerFee: 50,
    producerSplitPercentage: 60,
    ...overrides,
  }
}

const root = resolve(process.cwd())

console.log('A. Next-term date defaults')
{
  const term = defaultNextTermDates('2026-09-01')
  assertEq(term.effectiveDate, '2026-09-01', 'new effective = prior expiration')
  assertEq(term.expirationDate, '2027-09-01', 'new expiration = prior expiration + 1 year')
  const yearEnd = defaultNextTermDates('2026-12-31')
  assertEq(yearEnd.effectiveDate, '2026-12-31', 'year-end effective stays 12-31')
  assertEq(yearEnd.expirationDate, '2027-12-31', 'year-end expiration is next 12-31')
}

console.log('B. Renew prefill copies setup, not premium or actual commission')
{
  const prefill = renewalPrefillFromPolicy(samplePolicy())
  assertEq(prefill.clientId, 'client-1', 'renew keeps client')
  assertEq(prefill.policyId, SOURCE_POLICY_ID, 'renew keeps same policy file')
  assertEq(prefill.policyNumber, 'BHP-GL-2026-001', 'renew keeps current policy number')
  assertEq(prefill.policyType, 'General Liability', 'renew copies LOB')
  assertEq(prefill.carrier, 'North Star Mutual', 'renew copies carrier')
  assertEq(prefill.mga, 'Harbor MGA', 'renew copies MGA')
  assertEq(prefill.producer, 'Avery Producer', 'renew copies producer')
  assertEq(prefill.csr, 'Blake CSR', 'renew copies CSR')
  assertEq(prefill.agencyCommissionPercentage, '12.5', 'renew copies commission % setup')
  assertEq(prefill.brokerFee, '50', 'renew copies broker-fee setup')
  assertEq(prefill.producerSplitPercentage, '60', 'renew copies producer split %')
  assertEq(prefill.premiumAmount, '', 'renew does not copy old premium')
  assertEq(prefill.agencyCommissionAmount, '', 'renew does not copy actual commission amount')
  assertEq(prefill.policyEffectiveDate, '2026-09-01', 'renew effective = prior expiration')
  assertEq(prefill.policyExpirationDate, '2027-09-01', 'renew expiration = +1 year')
}

console.log('C. Rewrite prefill blanks number/premium/actual commission; copies setup')
{
  const prefill = rewritePrefillFromPolicy(samplePolicy())
  assertEq(prefill.policyNumber, '', 'rewrite does not inherit policy number')
  assertEq(prefill.premiumAmount, '', 'rewrite does not inherit premium')
  assertEq(prefill.agencyCommissionAmount, '', 'rewrite does not inherit actual commission')
  assertEq(prefill.clientId, 'client-1', 'rewrite prefills client')
  assertEq(prefill.policyType, 'General Liability', 'rewrite copies LOB')
  assertEq(prefill.carrier, 'North Star Mutual', 'rewrite copies carrier')
  assertEq(prefill.agencyCommissionPercentage, '12.5', 'rewrite copies commission %')
  assertEq(prefill.brokerFee, '50', 'rewrite copies broker-fee setup')
  assertEq(prefill.producerSplitPercentage, '60', 'rewrite copies split %')
  assertEq(prefill.rewrittenFromPolicyId, SOURCE_POLICY_ID, 'rewrite records predecessor id')
  assertEq(prefill.effectiveDate, '2026-09-01', 'rewrite effective = prior expiration')
  assertEq(prefill.expirationDate, '2027-09-01', 'rewrite expiration = +1 year')
}

console.log('D. Tenant isolation helpers')
{
  assert(assertRewriteSameAgency(AGENCY_A, AGENCY_A) === null, 'same agency is allowed')
  assert(
    assertRewriteSameAgency(AGENCY_A, AGENCY_B) !== null,
    'cross-agency rewrite is rejected',
  )
  assert(assertRewriteSameAgency(AGENCY_A, '') !== null, 'missing caller agency is rejected')
  assert(assertNotSelfRewrite(SOURCE_POLICY_ID, SOURCE_POLICY_ID) !== null, 'self-rewrite is rejected')
  assert(assertNotSelfRewrite(SOURCE_POLICY_ID, 'policy-new') === null, 'distinct ids are allowed')
}

console.log('E. Rewrite creation + linkage (mocked writes)')
{
  const createdPolicies: CreatePolicyInput[] = []
  const createdTxns: Array<{ policyId: string; type: string; premiumAmount: number }> = []
  const source = samplePolicy()
  const result = await rewritePolicy(rewriteInput(), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    createPolicy: async (input) => {
      createdPolicies.push(input)
      return { data: { id: 'policy-new-1' }, error: null }
    },
    createTransaction: async (input) => {
      createdTxns.push({
        policyId: input.policyId,
        type: input.transactionType,
        premiumAmount: input.premiumAmount,
      })
      return { data: { id: 'txn-new-1', transactionNumber: 'TRX-1' }, error: null }
    },
  })
  assert(result.error === null && result.data?.policyId === 'policy-new-1', 'rewrite returns new policy id')
  assert(result.data?.transactionId === 'txn-new-1', 'rewrite returns opening transaction id')
  assertEq(createdPolicies.length, 1, 'creates exactly one new policy file')
  assertEq(createdPolicies[0]?.rewrittenFromPolicyId, SOURCE_POLICY_ID, 'new file links rewritten_from')
  assertEq(createdPolicies[0]?.policyNumber, 'BHP-GL-2027-RW', 'uses user-entered policy number')
  assertEq(createdPolicies[0]?.premium, 0, 'does not write old premium onto the new policy row')
  assertEq(createdTxns[0]?.type, 'new_policy_premium', 'opening txn is New Business, not a new type')
  assertEq(createdTxns[0]?.premiumAmount, 9100, 'opening txn uses user-entered premium, not 8425')
  assertEq(createdTxns[0]?.policyId, 'policy-new-1', 'opening txn is on the new policy')
}

console.log('F. Rewrite rejects blank number, inherited-zero premium, and cross-tenant caller')
{
  const source = samplePolicy()
  const deps = {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    createPolicy: async () => ({ data: { id: 'should-not-create' }, error: null }),
    createTransaction: async () => ({ data: { id: 'should-not-create', transactionNumber: 'x' }, error: null }),
  }
  const missingNumber = await rewritePolicy(rewriteInput({ policyNumber: '   ' }), deps)
  assert(missingNumber.error?.includes('policy number'), 'blank new policy number is rejected')

  const missingPremium = await rewritePolicy(rewriteInput({ premiumAmount: 0 }), deps)
  assert(missingPremium.error?.toLowerCase().includes('premium'), 'zero/inherited premium is rejected')

  const crossTenant = await rewritePolicy(rewriteInput(), { ...deps, callerAgencyId: AGENCY_B })
  assert(crossTenant.error?.includes('same agency'), 'Agency B cannot rewrite Agency A policy')
}

console.log('G. Renewal term rollover — prior NB/endo/audit/cancel excluded from current totals')
{
  const rows = [
    txn({
      id: 'nb',
      type: 'new_policy_premium',
      amount: 8000,
      agencyCommissionAmount: 1000,
      brokerFee: 100,
      producerCommissionAmount: 600,
      agencyNetCommission: 500,
      createdAt: '2025-09-01T10:00:00Z',
      transactionEffectiveDate: '2025-09-01',
      transactionExpirationDate: '2026-09-01',
    }),
    txn({
      id: 'endo',
      type: 'endorsement_premium',
      amount: 400,
      agencyCommissionAmount: 50,
      brokerFee: 0,
      producerCommissionAmount: 30,
      agencyNetCommission: 20,
      createdAt: '2025-12-01T10:00:00Z',
      transactionEffectiveDate: '2025-12-01',
    }),
    txn({
      id: 'audit',
      type: 'audit_premium',
      amount: 200,
      agencyCommissionAmount: 25,
      createdAt: '2026-03-01T10:00:00Z',
      transactionEffectiveDate: '2026-03-01',
    }),
    txn({
      id: 'cancel',
      type: 'cancellation_premium',
      amount: -150,
      agencyCommissionAmount: -18,
      createdAt: '2026-06-01T10:00:00Z',
      transactionEffectiveDate: '2026-06-01',
    }),
    txn({
      id: 'ren',
      type: 'renewal_premium',
      amount: 9100,
      agencyCommissionAmount: 1137.5,
      brokerFee: 50,
      producerCommissionAmount: 712.5,
      agencyNetCommission: 475,
      createdAt: '2026-09-01T10:00:00Z',
      transactionEffectiveDate: '2026-09-01',
      transactionExpirationDate: '2027-09-01',
    }),
  ]
  const totals = policyTermFinancialTotals(rows)
  assertEq(totals.currentPolicyPremium, 9100, 'current premium is renewal only, not 8000+400+200-150+9100')
  assertEq(totals.totalAgencyCommission, 1137.5, 'current commission excludes prior-term amounts')
  assertEq(totals.totalBrokerFees, 50, 'current broker fee is renewal only')
  assert(!totals.termTransactionIds.includes('nb'), 'prior NB is historical')
  assert(!totals.termTransactionIds.includes('endo'), 'prior endorsement is historical')
  assert(!totals.termTransactionIds.includes('audit'), 'prior audit is historical')
  assert(!totals.termTransactionIds.includes('cancel'), 'prior cancellation is historical')
  assert(totals.termTransactionIds.includes('ren'), 'renewal is the current term')
}

console.log('H. Static wiring — schema, surfaces, no new transaction type')
{
  const migration = readFileSync(
    resolve(root, 'supabase/migrations/20260902120000_policy_rewrite_lineage.sql'),
    'utf8',
  )
  assert(migration.includes('rewritten_from_policy_id'), 'migration adds rewritten_from_policy_id')
  assert(migration.includes('enforce_policy_rewrite_same_agency'), 'migration enforces same-agency rewrite')
  assert(migration.includes('A policy cannot rewrite itself'), 'migration rejects self-rewrite')
  assert(migration.includes('policies_rewrite_same_agency'), 'trigger sorts after aaa_ tenant stamp')

  const details = readFileSync(resolve(root, 'src/pages/PolicyDetails.tsx'), 'utf8')
  assert(details.includes('mode="renew"'), 'Policy Details opens Renew modal')
  assert(details.includes('RewritePolicyModal'), 'Policy Details opens Rewrite modal')
  assert(details.includes('Rewritten from'), 'Policy Details shows Rewritten from')
  assert(details.includes('Rewritten to'), 'Policy Details shows Rewritten to')

  const files = readFileSync(resolve(root, 'src/pages/PolicyFiles.tsx'), 'utf8')
  assert(files.includes('setRenewTarget'), 'Policy Files has per-row Renew')
  assert(files.includes('setRewriteTarget'), 'Policy Files has per-row Rewrite')

  const commission = readFileSync(resolve(root, 'src/lib/commission.ts'), 'utf8')
  assert(!commission.includes('rewrite_premium'), 'does not invent a rewrite transaction type')

  const modal = readFileSync(resolve(root, 'src/components/transactions/AddTransactionModal.tsx'), 'utf8')
  assert(modal.includes('renewPolicy'), 'Renew modal saves through renewPolicy')
  assert(modal.includes("mode === 'renew'"), 'Renew modal unlocks carried-forward fields')
  assert(modal.includes('Policy Type / LOB'), 'Renew modal exposes Policy Type / LOB')
}

console.log('I. Renewal keeps the same Policy File and updates current setup')
{
  const source = samplePolicy()
  const historical = Object.freeze({
    id: 'nb-hist',
    type: 'new_policy_premium',
    amount: 8000,
    producer: 'Avery Producer',
    carrier: 'North Star Mutual',
    mga: 'Harbor MGA',
    csr: 'Blake CSR',
    agencyCommissionPercentage: 12.5,
  })

  async function runRenew(input: RenewPolicyInput) {
    const policyPatches: Array<Record<string, unknown>> = []
    const createdTxns: Array<{ policyId: string; type: string; premiumAmount: number; clientId: string }> = []
    const result = await renewPolicy(input, {
      bypassAuth: true,
      skipActivity: true,
      callerAgencyId: AGENCY_A,
      loadSource: async () => ({ data: source, error: null }),
      loadClientAgencyId: async (clientId) => ({
        agencyProfileId: clientId.startsWith('client-b') ? AGENCY_B : AGENCY_A,
        error: null,
      }),
      hasConflictingPolicyNumber: async () => ({ conflict: false, error: null }),
      updatePolicySetup: async (_policyId, patch) => {
        policyPatches.push({ ...patch })
        return { error: null }
      },
      createTransaction: async (txnInput) => {
        createdTxns.push({
          policyId: txnInput.policyId,
          type: txnInput.transactionType,
          premiumAmount: txnInput.premiumAmount,
          clientId: txnInput.clientId,
        })
        return { data: { id: 'txn-ren-1', transactionNumber: 'TRX-REN-1' }, error: null }
      },
    })
    return { result, policyPatches, createdTxns }
  }

  const unchanged = await runRenew(renewInput())
  assert(unchanged.result.error === null, 'unchanged policy number renewal succeeds')
  assertEq(unchanged.result.data?.policyId, SOURCE_POLICY_ID, 'unchanged number keeps the same Policy File')
  assertEq(unchanged.createdTxns[0]?.type, 'renewal_premium', 'unchanged number still creates a Renewal')
  assertEq(unchanged.policyPatches[0]?.policy_number, 'BHP-GL-2026-001', 'unchanged number is written back as current setup')
  assert(
    !Object.prototype.hasOwnProperty.call(unchanged.policyPatches[0] ?? {}, 'rewritten_from_policy_id'),
    'unchanged-number renew does not set rewrite lineage',
  )

  const renamed = await runRenew(renewInput({ policyNumber: 'BHP-GL-2027-001' }))
  assert(renamed.result.error === null, 'changed policy number renewal succeeds')
  assertEq(renamed.result.data?.policyId, SOURCE_POLICY_ID, 'changed number does not create a new Policy File')
  assertEq(renamed.createdTxns[0]?.policyId, SOURCE_POLICY_ID, 'renewal txn stays on the original policy id')
  assertEq(renamed.createdTxns[0]?.type, 'renewal_premium', 'changed number remains a Renewal, not New Business')
  assertEq(renamed.policyPatches[0]?.policy_number, 'BHP-GL-2027-001', 'Policy File current number becomes the new number')
  assert(
    !Object.prototype.hasOwnProperty.call(renamed.policyPatches[0] ?? {}, 'rewritten_from_policy_id'),
    'changed-number renew does not set rewrite lineage',
  )

  const carrierMga = await runRenew(
    renewInput({ carrier: 'Harbor Specialty', mga: 'Coastal MGA' }),
  )
  assertEq(carrierMga.policyPatches[0]?.carrier, 'Harbor Specialty', 'changed carrier updates current policy setup')
  assertEq(carrierMga.policyPatches[0]?.mga, 'Coastal MGA', 'changed MGA updates current policy setup')
  assertEq(carrierMga.createdTxns[0]?.type, 'renewal_premium', 'carrier/MGA change still creates a Renewal')

  const people = await runRenew(renewInput({ producer: 'Casey Producer', csr: 'Drew CSR' }))
  assertEq(people.policyPatches[0]?.producer, 'Casey Producer', 'changed producer updates current policy setup')
  assertEq(people.policyPatches[0]?.csr, 'Drew CSR', 'changed CSR updates current policy setup')

  const commission = await runRenew(
    renewInput({ agencyCommissionPercentage: 15, brokerFee: 75, producerSplitPercentage: 55 }),
  )
  assertEq(commission.policyPatches[0]?.agency_commission_percentage, 15, 'changed commission % updates current setup')
  assertEq(commission.policyPatches[0]?.broker_fee, 75, 'changed broker fee updates current setup')
  assertEq(commission.policyPatches[0]?.producer_split_percentage, 55, 'changed split % updates current setup')
  assertEq(commission.policyPatches[0]?.agency_commission_amount, 0, 'percentage renew does not write old actual commission')

  assertEq(historical.producer, 'Avery Producer', 'historical producer snapshot object is unchanged')
  assertEq(historical.carrier, 'North Star Mutual', 'historical carrier snapshot object is unchanged')
  assertEq(historical.amount, 8000, 'historical premium snapshot object is unchanged')

  const setup = buildRenewedPolicyCurrentSetup(source, {
    ...renewInput({
      policyNumber: 'BHP-GL-2027-001',
      carrier: 'Harbor Specialty',
      producer: 'Casey Producer',
      agencyCommissionPercentage: 15,
    }),
  })
  assertEq(setup.policyId, SOURCE_POLICY_ID, 'current setup stays on the same policy id')
  const patch = renewedSetupToPolicyPatch(setup)
  assertEq(patch.policy_number, 'BHP-GL-2027-001', 'current Policy File patch has the new number')
  assertEq(patch.carrier, 'Harbor Specialty', 'current Policy File patch has the new carrier')
  assert(!('rewritten_from_policy_id' in patch), 'current setup patch has no rewrite FK')

  const crossTenant = await renewPolicy(renewInput({ clientId: 'client-b-1' }), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_B, error: null }),
    hasConflictingPolicyNumber: async () => ({ conflict: false, error: null }),
    updatePolicySetup: async () => ({ error: null }),
    createTransaction: async () => ({ data: { id: 'should-not', transactionNumber: 'x' }, error: null }),
  })
  assert(crossTenant.error?.includes('same agency'), 'cannot renew onto a client in another agency')
}

console.log('J. Prior-term financials stay out of renewed current-term totals after setup edits')
{
  const rows = [
    txn({
      id: 'nb',
      type: 'new_policy_premium',
      amount: 8000,
      agencyCommissionAmount: 1000,
      createdAt: '2025-09-01T10:00:00Z',
      transactionEffectiveDate: '2025-09-01',
      transactionExpirationDate: '2026-09-01',
    }),
    txn({
      id: 'ren',
      type: 'renewal_premium',
      amount: 9100,
      agencyCommissionAmount: 1365,
      createdAt: '2026-09-01T10:00:00Z',
      transactionEffectiveDate: '2026-09-01',
      transactionExpirationDate: '2027-09-01',
    }),
  ]
  const totals = policyTermFinancialTotals(rows)
  assertEq(totals.currentPolicyPremium, 9100, 'renewed current premium ignores prior-term NB')
  assertEq(totals.totalAgencyCommission, 1365, 'renewed current commission ignores prior-term commission')
  assert(!totals.termTransactionIds.includes('nb'), 'prior-term NB excluded after renewal')
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed`)
console.log('validate-policy-renew-rewrite-v1: ALL GREEN')
