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
import { policyTermFinancialTotals, groupRelatedPolicyTransactions, resolveDisplayedPolicyNumber, rewrittenPredecessorIds, includePolicyInCurrentPremiumTotals, sumClientCurrentPremium, toPolicyPremiumTxn, type PolicyPremiumTxn } from '../src/lib/policyPremium.ts'
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
import type { PolicyFileNumberOwner } from '../src/lib/policyNumberUniqueness.ts'

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

console.log('C. Rewrite prefill blanks number/premium/actual commission; copies setup; does not roll dates')
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
  assertEq(prefill.notes, 'imported', 'rewrite copies notes')
  assertEq(prefill.remarks, '', 'rewrite remarks stay blank')
  assertEq(prefill.status, 'active', 'rewrite copies status')
  assertEq(prefill.rewrittenFromPolicyId, SOURCE_POLICY_ID, 'rewrite records predecessor id')
  assertEq(prefill.effectiveDate, '2025-09-01', 'rewrite dates copy the existing effective date, not next term')
  assertEq(prefill.expirationDate, '2026-09-01', 'rewrite dates copy the existing expiration date, not +1 year')
  assert(
    prefill.effectiveDate !== defaultNextTermDates(samplePolicy().expirationDate).effectiveDate ||
      samplePolicy().effectiveDate === samplePolicy().expirationDate,
    'rewrite prefill is not the renew next-term default',
  )
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
  const createdTxns: Array<{
    policyId: string
    type: string
    premiumAmount: number
    policyNumber?: string | null
    notes?: string
    remarks?: string
    carrier?: string
    mga?: string
    producer?: string
    csr?: string
    brokerFee?: number
    producerSplitPercentage?: number
    agencyCommissionPercentage?: number | null
    policyEffectiveDate?: string | null
    policyExpirationDate?: string | null
  }> = []
  const source = samplePolicy()
  const result = await rewritePolicy(rewriteInput(), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
    lookupPolicyNumberConflict: async () => ({ owner: null, error: null }),
    createPolicy: async (input) => {
      createdPolicies.push(input)
      return { data: { id: 'policy-new-1' }, error: null }
    },
    createTransaction: async (input) => {
      createdTxns.push({
        policyId: input.policyId,
        type: input.transactionType,
        premiumAmount: input.premiumAmount,
        policyNumber: input.policyNumber,
        notes: input.notes,
        remarks: input.remarks,
        carrier: input.carrier,
        mga: input.mga,
        producer: input.producer,
        csr: input.csr,
        brokerFee: input.brokerFee,
        producerSplitPercentage: input.producerSplitPercentage,
        agencyCommissionPercentage: input.agencyCommissionPercentage,
        policyEffectiveDate: input.policyEffectiveDate,
        policyExpirationDate: input.policyExpirationDate,
      })
      return { data: { id: 'txn-new-1', transactionNumber: 'TRX-1' }, error: null }
    },
  })
  assert(result.error === null && result.data?.policyId === 'policy-new-1', 'rewrite returns new policy id')
  assert(result.data?.policyId !== SOURCE_POLICY_ID, 'rewrite creates a new Policy File id')
  assert(result.data?.transactionId === 'txn-new-1', 'rewrite returns opening transaction id')
  assertEq(createdPolicies.length, 1, 'creates exactly one new policy file')
  assertEq(createdPolicies[0]?.rewrittenFromPolicyId, SOURCE_POLICY_ID, 'new file links rewritten_from')
  assertEq(createdPolicies[0]?.policyNumber, 'BHP-GL-2027-RW', 'uses user-entered policy number')
  assertEq(createdPolicies[0]?.premium, 0, 'does not write old premium onto the new policy row')
  assertEq(createdTxns[0]?.type, 'new_policy_premium', 'opening txn is New Business, not a renewal')
  assertEq(createdTxns[0]?.premiumAmount, 9100, 'opening txn uses user-entered premium, not 8425')
  assertEq(createdTxns[0]?.policyId, 'policy-new-1', 'opening txn is on the new policy')
  assertEq(createdTxns[0]?.policyNumber, 'BHP-GL-2027-RW', 'opening txn snapshots the new policy number')
}

console.log('F. Rewrite rejects blank number, inherited-zero premium, and cross-tenant caller')
{
  const source = samplePolicy()
  const deps = {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
    lookupPolicyNumberConflict: async () => ({ owner: null, error: null }),
    createPolicy: async () => ({ data: { id: 'should-not-create' }, error: null }),
    createTransaction: async () => ({ data: { id: 'should-not-create', transactionNumber: 'x' }, error: null }),
  }
  const missingNumber = await rewritePolicy(rewriteInput({ policyNumber: '   ' }), deps)
  assert(missingNumber.error?.includes('policy number'), 'blank new policy number is rejected')

  const missingPremium = await rewritePolicy(rewriteInput({ premiumAmount: 0 }), deps)
  assert(missingPremium.error?.toLowerCase().includes('premium'), 'zero/inherited premium is rejected')

  const crossTenant = await rewritePolicy(rewriteInput(), { ...deps, callerAgencyId: AGENCY_B })
  assert(crossTenant.error?.includes('same agency'), 'Agency B cannot rewrite Agency A policy')

  const crossClient = await rewritePolicy(rewriteInput({ clientId: 'client-b-1' }), {
    ...deps,
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_B, error: null }),
  })
  assert(crossClient.error?.includes('same agency'), 'cannot rewrite onto a client in another agency')
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
  assert(details.includes('This term only'), 'Policy Details shows one term of transactions')
  assert(details.includes('policyTermPath'), 'Policy Details links prior/next terms')
  assert(details.includes('listPolicyFileTerms'), 'Policy Details derives terms from establishing transactions')
  assert(!details.includes('Prior Terms'), 'Policy Details no longer merges prior terms onto the current page')

  const clientDetails = readFileSync(resolve(root, 'src/pages/ClientDetails.tsx'), 'utf8')
  assert(
    clientDetails.includes('snapshotPolicyNumber || tx.policyNumber') ||
      clientDetails.includes('policyNumber: tx.policyNumber'),
    'Client Details recent txns use mapped snapshot number',
  )

  const files = readFileSync(resolve(root, 'src/pages/PolicyFiles.tsx'), 'utf8')
  assert(files.includes('setRenewTarget'), 'Policy Files has per-row Renew')
  assert(files.includes('setRewriteTarget'), 'Policy Files has per-row Rewrite')

  const commission = readFileSync(resolve(root, 'src/lib/commission.ts'), 'utf8')
  assert(!commission.includes('rewrite_premium'), 'does not invent a rewrite transaction type')
  assert(commission.includes("'policy_number'"), 'create insert treats policy_number as a required snapshot')
  assert(commission.includes('resolveDisplayedPolicyNumber'), 'txn mapper prefers snapshotted policy number')

  const renewLib = readFileSync(resolve(root, 'src/lib/policyRenewRewrite.ts'), 'utf8')
  assert(renewLib.includes('freezeHistoricalPolicySnapshots'), 'renew freezes historical policy snapshots')
  assert(renewLib.includes(".is('policy_number', null)"), 'freeze only fills rows that lack a snapshot')
  assert(!/freezeHistoricalPolicySnapshots[\s\S]{0,1200}producer_commission/.test(renewLib), 'freeze does not rewrite producer commission')

  const recon = readFileSync(resolve(root, 'src/lib/reconciliation.ts'), 'utf8')
  assert(recon.includes('policies!transactions_policy_id_fkey ( policy_number )'), 'reconciliation still matches on live Policy File number')

  const snapshotMigration = readFileSync(
    resolve(root, 'supabase/migrations/20260902200000_transaction_policy_snapshots.sql'),
    'utf8',
  )
  assert(snapshotMigration.includes('ADD COLUMN IF NOT EXISTS policy_number text'), 'snapshot migration adds policy_number')
  assert(snapshotMigration.includes('policy_effective_date'), 'snapshot migration adds policy term effective date')
  assert(snapshotMigration.includes('policy_expiration_date'), 'snapshot migration adds policy term expiration date')
  assert(
    !/UPDATE[\s\S]{0,400}policy_number[\s\S]{0,200}policies/i.test(snapshotMigration),
    'snapshot migration does not backfill policy_number from the current Policy File',
  )

  const modal = readFileSync(resolve(root, 'src/components/transactions/AddTransactionModal.tsx'), 'utf8')
  assert(modal.includes('renewPolicy'), 'Renew modal saves through renewPolicy')
  assert(modal.includes("mode === 'renew'"), 'Renew modal unlocks carried-forward fields')
  assert(modal.includes('Policy Type / LOB'), 'Renew modal exposes Policy Type / LOB')

  const rewriteModal = readFileSync(resolve(root, 'src/components/policies/RewritePolicyModal.tsx'), 'utf8')
  assert(
    rewriteModal.includes(
      'Creates a replacement Policy File. The existing policy and all of its historical terms and transactions remain unchanged.',
    ),
    'rewrite modal uses the replacement-file explanation',
  )
  assert(rewriteModal.includes('Rewritten From'), 'rewrite modal keeps Rewritten From read-only')
  assert(rewriteModal.includes('to={`/policies/${sourcePolicyId}`}'), 'Rewritten From links to the existing Policy File')
  assert(rewriteModal.includes('New Policy #'), 'rewrite modal exposes New Policy #')
  assert(rewriteModal.includes('>LOB<') || rewriteModal.includes('>LOB</span>'), 'rewrite modal exposes LOB')
  assert(rewriteModal.includes('Reviewer'), 'rewrite modal exposes Reviewer')
  assert(rewriteModal.includes('Remarks'), 'rewrite modal exposes Remarks')
  assert(rewriteModal.includes('Effective Date'), 'rewrite modal exposes Effective Date')
  assert(rewriteModal.includes('Expiration Date'), 'rewrite modal exposes Expiration Date')
  assert(
    rewriteModal.includes('A rewrite may start mid-term'),
    'rewrite modal states dates are not rolled to the next renewal term',
  )
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
    const createdTxns: Array<{
      policyId: string
      type: string
      premiumAmount: number
      clientId: string
      policyNumber?: string | null
      policyEffectiveDate?: string | null
      policyExpirationDate?: string | null
    }> = []
    const freezeCalls: Array<{ policyId: string; snapshot: Record<string, string> }> = []
    const callOrder: string[] = []
    const result = await renewPolicy(input, {
      bypassAuth: true,
      skipActivity: true,
      callerAgencyId: AGENCY_A,
      loadSource: async () => ({ data: source, error: null }),
      loadClientAgencyId: async (clientId) => ({
        agencyProfileId: clientId.startsWith('client-b') ? AGENCY_B : AGENCY_A,
        error: null,
      }),
      lookupPolicyNumberConflict: async () => ({ owner: null, error: null }),
      freezeHistoricalPolicySnapshots: async (policyId, snapshot) => {
        callOrder.push('freeze')
        freezeCalls.push({
          policyId,
          snapshot: {
            policyNumber: snapshot.policyNumber,
            effectiveDate: snapshot.effectiveDate,
            expirationDate: snapshot.expirationDate,
          },
        })
        return { error: null }
      },
      updatePolicySetup: async (_policyId, patch) => {
        callOrder.push('patch')
        policyPatches.push({ ...patch })
        return { error: null }
      },
      createTransaction: async (txnInput) => {
        callOrder.push('create')
        createdTxns.push({
          policyId: txnInput.policyId,
          type: txnInput.transactionType,
          premiumAmount: txnInput.premiumAmount,
          clientId: txnInput.clientId,
          policyNumber: txnInput.policyNumber,
          policyEffectiveDate: txnInput.policyEffectiveDate,
          policyExpirationDate: txnInput.policyExpirationDate,
        })
        return { data: { id: 'txn-ren-1', transactionNumber: 'TRX-REN-1' }, error: null }
      },
    })
    return { result, policyPatches, createdTxns, freezeCalls, callOrder }
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
  assertEq(renamed.callOrder.join('>'), 'freeze>patch>create', 'history freeze runs before Policy File rename')
  assertEq(renamed.freezeCalls[0]?.policyId, SOURCE_POLICY_ID, 'freeze targets the same Policy File')
  assertEq(renamed.freezeCalls[0]?.snapshot.policyNumber, 'BHP-GL-2026-001', 'freeze stamps the old policy number')
  assertEq(renamed.freezeCalls[0]?.snapshot.effectiveDate, '2025-09-01', 'freeze stamps the expiring term effective date')
  assertEq(renamed.freezeCalls[0]?.snapshot.expirationDate, '2026-09-01', 'freeze stamps the expiring term expiration date')
  assertEq(renamed.createdTxns[0]?.policyNumber, 'BHP-GL-2027-001', 'renewal txn snapshots the new policy number')
  assertEq(renamed.createdTxns[0]?.policyEffectiveDate, '2026-09-01', 'renewal txn snapshots the new term effective date')
  assertEq(renamed.createdTxns[0]?.policyExpirationDate, '2027-09-01', 'renewal txn snapshots the new term expiration date')
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
    lookupPolicyNumberConflict: async () => ({ owner: null, error: null }),
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

console.log('K. Transaction history snapshots display the create-time policy number and term')
{
  assertEq(
    resolveDisplayedPolicyNumber({
      snapshotPolicyNumber: 'BHP-GL-2026-001',
      currentPolicyNumber: 'BHP-GL-2027-001',
    }),
    'BHP-GL-2026-001',
    'display prefers the transaction snapshot over the current Policy File number',
  )
  assertEq(
    resolveDisplayedPolicyNumber({
      snapshotPolicyNumber: '  ',
      currentPolicyNumber: 'BHP-GL-2027-001',
    }),
    'BHP-GL-2027-001',
    'legacy rows with no snapshot still fall back to the current Policy File',
  )

  const grouped = groupRelatedPolicyTransactions([
    txn({
      id: 'nb',
      type: 'new_policy_premium',
      amount: 8000,
      createdAt: '2025-09-01T10:00:00Z',
      transactionEffectiveDate: '2025-09-01',
      transactionExpirationDate: '2026-09-01',
    }),
    txn({
      id: 'endo',
      type: 'endorsement_premium',
      amount: 400,
      createdAt: '2025-10-01T10:00:00Z',
      transactionEffectiveDate: '2025-10-01',
      transactionExpirationDate: '2026-09-01',
    }),
    txn({
      id: 'ren',
      type: 'renewal_premium',
      amount: 9100,
      createdAt: '2026-09-01T10:00:00Z',
      transactionEffectiveDate: '2026-09-01',
      transactionExpirationDate: '2027-09-01',
    }),
  ])
  assertEq(grouped.currentTerm.map((tx) => tx.id).join(','), 'ren', 'renewal is current term')
  assertEq(grouped.priorTerms.map((tx) => tx.id).join(','), 'nb,endo', 'NB and endorsement are prior terms')

  const totals = policyTermFinancialTotals([
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
  ])
  assertEq(totals.currentPolicyPremium, 9100, 'grouping helper does not change current-term premium formula')
  assertEq(totals.totalAgencyCommission, 1365, 'grouping helper does not change current-term commission formula')
}

console.log('L. Mid-term rewrite and rewrite at expiration create a new file, not a renewal term')
{
  const source = samplePolicy()
  const sourceSnapshot = Object.freeze({
    id: SOURCE_POLICY_ID,
    policyNumber: 'BHP-GL-2026-001',
    premium: 8425,
    carrier: 'North Star Mutual',
    mga: 'Harbor MGA',
    producer: 'Avery Producer',
    csr: 'Blake CSR',
  })

  async function runRewrite(input: RewritePolicyInput) {
    const createdPolicies: CreatePolicyInput[] = []
    const createdTxns: Array<Record<string, unknown>> = []
    const result = await rewritePolicy(input, {
      bypassAuth: true,
      skipActivity: true,
      callerAgencyId: AGENCY_A,
      loadSource: async () => ({ data: source, error: null }),
      loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
      lookupPolicyNumberConflict: async () => ({ owner: null, error: null }),
      createPolicy: async (policyInput) => {
        createdPolicies.push(policyInput)
        return { data: { id: 'policy-new-1' }, error: null }
      },
      createTransaction: async (txnInput) => {
        createdTxns.push({ ...txnInput })
        return { data: { id: 'txn-new-1', transactionNumber: 'TRX-1' }, error: null }
      },
    })
    return { result, createdPolicies, createdTxns }
  }

  const midTerm = await runRewrite(
    rewriteInput({
      policyNumber: 'BHP-GL-MID-001',
      effectiveDate: '2026-03-15',
      expirationDate: '2027-03-15',
      premiumAmount: 7600,
    }),
  )
  assert(midTerm.result.error === null, 'mid-term rewrite succeeds')
  assertEq(midTerm.result.data?.policyId, 'policy-new-1', 'mid-term rewrite creates a new Policy File')
  assert(midTerm.result.data?.policyId !== SOURCE_POLICY_ID, 'mid-term rewrite does not keep the old Policy File')
  assertEq(midTerm.createdPolicies[0]?.effectiveDate, '2026-03-15', 'mid-term rewrite uses the entered effective date')
  assertEq(midTerm.createdPolicies[0]?.expirationDate, '2027-03-15', 'mid-term rewrite uses the entered expiration date')
  assert(
    midTerm.createdPolicies[0]?.effectiveDate !== defaultNextTermDates(source.expirationDate).effectiveDate,
    'mid-term rewrite is not defaulted onto the next renewal term',
  )
  assertEq(midTerm.createdTxns[0]?.transactionType, 'new_policy_premium', 'mid-term rewrite opens with New Business')
  assertEq(midTerm.createdTxns[0]?.policyId, 'policy-new-1', 'mid-term opening txn is on the new file')
  assertEq(midTerm.createdTxns[0]?.policyEffectiveDate, '2026-03-15', 'mid-term txn snapshots the new effective date')
  assertEq(midTerm.createdTxns[0]?.policyExpirationDate, '2027-03-15', 'mid-term txn snapshots the new expiration date')

  const atExpiration = await runRewrite(
    rewriteInput({
      policyNumber: 'BHP-GL-2027-RW',
      effectiveDate: '2026-09-01',
      expirationDate: '2027-09-01',
      premiumAmount: 9100,
    }),
  )
  assert(atExpiration.result.error === null, 'rewrite at expiration succeeds')
  assertEq(atExpiration.result.data?.policyId, 'policy-new-1', 'rewrite at expiration still creates a new Policy File')
  assertEq(atExpiration.createdTxns[0]?.transactionType, 'new_policy_premium', 'rewrite at expiration is not a Renewal')
  assertEq(atExpiration.createdPolicies[0]?.rewrittenFromPolicyId, SOURCE_POLICY_ID, 'rewrite at expiration still links Rewritten From')
  assertEq(sourceSnapshot.policyNumber, 'BHP-GL-2026-001', 'old policy number object is unchanged')
  assertEq(sourceSnapshot.premium, 8425, 'old policy premium object is unchanged')
}

console.log('M. Replacement setup edits apply only to the new file')
{
  const source = samplePolicy()
  const createdPolicies: CreatePolicyInput[] = []
  const createdTxns: Array<Record<string, unknown>> = []
  const result = await rewritePolicy(
    rewriteInput({
      policyNumber: 'BHP-GL-2027-RW',
      carrier: 'Harbor Specialty',
      mga: 'Coastal MGA',
      producer: 'Casey Producer',
      csr: 'Drew CSR',
      agencyCommissionPercentage: 15,
      brokerFee: 75,
      producerSplitPercentage: 55,
      notes: 'replacement notes',
      remarks: 'opening remarks',
      reviewerUserId: 'reviewer-1',
      status: 'pending',
    }),
    {
      bypassAuth: true,
      skipActivity: true,
      callerAgencyId: AGENCY_A,
      loadSource: async () => ({ data: source, error: null }),
      loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
      lookupPolicyNumberConflict: async () => ({ owner: null, error: null }),
      createPolicy: async (policyInput) => {
        createdPolicies.push(policyInput)
        return { data: { id: 'policy-new-1' }, error: null }
      },
      createTransaction: async (txnInput) => {
        createdTxns.push({ ...txnInput })
        return { data: { id: 'txn-new-1', transactionNumber: 'TRX-1' }, error: null }
      },
    },
  )
  assert(result.error === null, 'setup-edited rewrite succeeds')
  assertEq(createdPolicies[0]?.carrier, 'Harbor Specialty', 'replacement policy has the new carrier')
  assertEq(createdPolicies[0]?.mga, 'Coastal MGA', 'replacement policy has the new MGA')
  assertEq(createdPolicies[0]?.producer, 'Casey Producer', 'replacement policy has the new producer')
  assertEq(createdPolicies[0]?.csr, 'Drew CSR', 'replacement policy has the new CSR')
  assertEq(createdPolicies[0]?.agencyCommissionPercentage, 15, 'replacement policy has the new commission %')
  assertEq(createdPolicies[0]?.brokerFee, 75, 'replacement policy has the new broker fee')
  assertEq(createdPolicies[0]?.producerSplitPercentage, 55, 'replacement policy has the new split %')
  assertEq(createdPolicies[0]?.overrideSplit, true, 'changed split marks override on the replacement file')
  assertEq(createdPolicies[0]?.status, 'pending', 'replacement policy has the entered status')
  assertEq(createdPolicies[0]?.notes, 'replacement notes', 'replacement policy stores notes')
  assertEq(createdTxns[0]?.carrier, 'Harbor Specialty', 'opening txn snapshots the new carrier')
  assertEq(createdTxns[0]?.mga, 'Coastal MGA', 'opening txn snapshots the new MGA')
  assertEq(createdTxns[0]?.producer, 'Casey Producer', 'opening txn snapshots the new producer')
  assertEq(createdTxns[0]?.csr, 'Drew CSR', 'opening txn snapshots the new CSR')
  assertEq(createdTxns[0]?.agencyCommissionPercentage, 15, 'opening txn snapshots the new commission %')
  assertEq(createdTxns[0]?.brokerFee, 75, 'opening txn snapshots the new broker fee')
  assertEq(createdTxns[0]?.producerSplitPercentage, 55, 'opening txn snapshots the new split %')
  assertEq(createdTxns[0]?.notes, 'replacement notes', 'opening txn stores notes')
  assertEq(createdTxns[0]?.remarks, 'opening remarks', 'opening txn stores remarks')
  assertEq(createdTxns[0]?.reviewerUserId, 'reviewer-1', 'opening txn stores reviewer')
  assertEq(source.carrier, 'North Star Mutual', 'source carrier snapshot is unchanged')
  assertEq(source.producer, 'Avery Producer', 'source producer snapshot is unchanged')
  assertEq(source.agencyCommissionPercentage, 12.5, 'source commission % snapshot is unchanged')
  assertEq(source.brokerFee, 50, 'source broker fee snapshot is unchanged')
  assertEq(source.producerSplitPercentage, 60, 'source split % snapshot is unchanged')
  assertEq(source.policyNumber, 'BHP-GL-2026-001', 'source policy number is unchanged')
}

console.log('N. Rewritten-away files are excluded from current/client premium totals')
{
  const replacedIds = rewrittenPredecessorIds([
    { rewrittenFromPolicyId: null },
    { rewrittenFromPolicyId: SOURCE_POLICY_ID },
  ])
  assert(replacedIds.has(SOURCE_POLICY_ID), 'source file is marked replaced when a successor exists')
  assert(
    includePolicyInCurrentPremiumTotals('policy-new-1', replacedIds),
    'replacement file still counts in current premium',
  )
  assert(
    !includePolicyInCurrentPremiumTotals(SOURCE_POLICY_ID, replacedIds),
    'replaced file does not count in current premium',
  )
  const clientTotal = sumClientCurrentPremium([
    { policyPremium: 0, transactionPremiumSum: 8425, liveTransactionCount: 1 },
    { policyPremium: 0, transactionPremiumSum: 7600, liveTransactionCount: 1 },
  ])
  assertEq(clientTotal, 16025, 'unfiltered sum still adds both files')
  const liveTotal = sumClientCurrentPremium([
    { policyPremium: 0, transactionPremiumSum: 7600, liveTransactionCount: 1 },
  ])
  assertEq(liveTotal, 7600, 'after excluding the replaced file, client total is the replacement only')
}

console.log('N. Agency policy-number uniqueness on renew (changed number) and rewrite')
{
  const source = samplePolicy()
  const otherFile: PolicyFileNumberOwner = {
    policyId: 'policy-other-1',
    policyNumber: 'BHP-GL-TAKEN',
    clientId: 'client-2',
    clientName: 'Oak Street HVAC',
  }
  const freezeCalls: string[] = []
  const createdPolicyIds: string[] = []

  const sameNumber = await renewPolicy(renewInput(), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
    lookupPolicyNumberConflict: async () => {
      throw new Error('same-number renew must not uniqueness-check')
    },
    freezeHistoricalPolicySnapshots: async () => {
      freezeCalls.push('freeze')
      return { error: null }
    },
    updatePolicySetup: async () => ({ error: null }),
    createTransaction: async () => ({ data: { id: 'txn-ren-same', transactionNumber: 'T' }, error: null }),
  })
  assert(sameNumber.error === null, 'renewing with the same Policy File number is allowed')
  assertEq(freezeCalls.join(','), 'freeze', 'same-number renew still freezes historical snapshots')

  const blockedRenew = await renewPolicy(renewInput({ policyNumber: 'BHP-GL-TAKEN' }), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
    lookupPolicyNumberConflict: async () => ({ owner: otherFile, error: null }),
    freezeHistoricalPolicySnapshots: async () => {
      freezeCalls.push('should-not-freeze')
      return { error: null }
    },
    updatePolicySetup: async () => ({ error: 'should-not-patch' }),
    createTransaction: async () => ({ data: { id: 'should-not', transactionNumber: 'x' }, error: null }),
  })
  assert(blockedRenew.error?.includes('Oak Street HVAC'), 'changed-number renew names the existing client')
  assert(blockedRenew.error?.includes('BHP-GL-TAKEN'), 'changed-number renew names the existing Policy File')
  assert(blockedRenew.data === null, 'changed-number renew does not return ids on conflict')
  assert(!freezeCalls.includes('should-not-freeze'), 'conflicting renew does not freeze historical snapshots')

  const blockedRewrite = await rewritePolicy(rewriteInput({ policyNumber: 'BHP-GL-TAKEN' }), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
    lookupPolicyNumberConflict: async () => ({ owner: otherFile, error: null }),
    createPolicy: async () => {
      createdPolicyIds.push('should-not-create')
      return { data: { id: 'should-not-create' }, error: null }
    },
    createTransaction: async () => ({ data: { id: 'should-not', transactionNumber: 'x' }, error: null }),
  })
  assert(blockedRewrite.error?.includes('Oak Street HVAC'), 'rewrite names the existing client')
  assert(blockedRewrite.error?.includes('BHP-GL-TAKEN'), 'rewrite names the existing Policy File')
  assertEq(createdPolicyIds.length, 0, 'conflicting rewrite does not create a Policy File')

  const predecessorNumber = await rewritePolicy(rewriteInput({ policyNumber: 'BHP-GL-2026-001' }), {
    bypassAuth: true,
    skipActivity: true,
    callerAgencyId: AGENCY_A,
    loadSource: async () => ({ data: source, error: null }),
    loadClientAgencyId: async () => ({ agencyProfileId: AGENCY_A, error: null }),
    lookupPolicyNumberConflict: async (_agency, number) =>
      number.trim().toLowerCase() === 'bhp-gl-2026-001'
        ? {
            owner: {
              policyId: SOURCE_POLICY_ID,
              policyNumber: source.policyNumber,
              clientId: source.clientId,
              clientName: source.clientName,
            },
            error: null,
          }
        : { owner: null, error: null },
    createPolicy: async () => {
      createdPolicyIds.push('should-not-reuse-predecessor')
      return { data: { id: 'should-not' }, error: null }
    },
    createTransaction: async () => ({ data: { id: 'should-not', transactionNumber: 'x' }, error: null }),
  })
  assert(
    predecessorNumber.error?.includes('Blue Harbor Plumbing LLC'),
    'rewrite cannot reuse the predecessor Policy File number',
  )
  assertEq(createdPolicyIds.length, 0, 'predecessor-number rewrite does not create a file')
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed`)
console.log('validate-policy-renew-rewrite-v1: ALL GREEN')
