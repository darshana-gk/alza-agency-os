/**
 * V1 Renew / Rewrite helpers.
 *
 * Renew: same policy file + Renewal transaction (new current term).
 * Rewrite: new policy file linked via rewritten_from_policy_id + New Business transaction.
 */

import { createTransaction, normalizeCommissionType, todayIsoDate, type CommissionType } from './commission'
import { createPolicy, POLICY_STATUSES, roundMoney, type PolicyStatusValue } from './directory'
import { canManagePolicies, canManageTransactions, rejectUnlessRole, type RoleInput } from './permissions'
import { validateProducerSplitPercentage } from './producerSplitValidation'
import { isoDateOnly } from './transactionDateSemantics'
import { recordActivity } from './activity'
import { supabase } from './supabase'

export type RenewRewritePolicySnapshot = {
  id: string
  clientId: string
  clientName: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  effectiveDate: string
  expirationDate: string
  status: string
  notes: string
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  producerSplitPercentage: number
  overrideSplit: boolean
  agencyProfileId: string
  premium: number
}

export function addCalendarYearsIso(isoDate: string, years: number): string {
  const raw = isoDateOnly(isoDate)
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  const year = Number(raw.slice(0, 4))
  const month = Number(raw.slice(5, 7))
  const day = Number(raw.slice(8, 10))
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(dt.getTime())) return ''
  dt.setUTCFullYear(dt.getUTCFullYear() + years)
  return dt.toISOString().slice(0, 10)
}

/** New effective = prior expiration; new expiration = one year later. */
export function defaultNextTermDates(priorExpiration: string): {
  effectiveDate: string
  expirationDate: string
} {
  const effectiveDate = isoDateOnly(priorExpiration)
  return {
    effectiveDate,
    expirationDate: effectiveDate ? addCalendarYearsIso(effectiveDate, 1) : '',
  }
}

export function assertRewriteSameAgency(
  sourceAgencyId: string | null | undefined,
  callerAgencyId: string | null | undefined,
): string | null {
  const source = String(sourceAgencyId ?? '').trim()
  const caller = String(callerAgencyId ?? '').trim()
  if (!source || !caller || source !== caller) {
    return 'Rewrite source policy must belong to the same agency.'
  }
  return null
}

export function assertNotSelfRewrite(sourcePolicyId: string, newPolicyId?: string | null): string | null {
  if (newPolicyId && sourcePolicyId.trim() === String(newPolicyId).trim()) {
    return 'A policy cannot rewrite itself.'
  }
  return null
}

export type RenewalPrefill = {
  clientId: string
  policyId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  policyEffectiveDate: string
  policyExpirationDate: string
  commissionType: CommissionType
  agencyCommissionPercentage: string
  /** Always blank — user must enter the new actual amount when flat. */
  agencyCommissionAmount: string
  brokerFee: string
  producerSplitPercentage: string
  /** Always blank — never inherit old premium. */
  premiumAmount: string
}

export function renewalPrefillFromPolicy(policy: RenewRewritePolicySnapshot): RenewalPrefill {
  const term = defaultNextTermDates(policy.expirationDate)
  return {
    clientId: policy.clientId,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    carrier: policy.carrier,
    mga: policy.mga,
    producer: policy.producer,
    csr: policy.csr,
    policyEffectiveDate: term.effectiveDate,
    policyExpirationDate: term.expirationDate,
    commissionType: normalizeCommissionType(policy.commissionType),
    agencyCommissionPercentage:
      policy.agencyCommissionPercentage === null ? '' : String(policy.agencyCommissionPercentage),
    agencyCommissionAmount: '',
    brokerFee: String(policy.brokerFee ?? 0),
    producerSplitPercentage: String(policy.producerSplitPercentage ?? ''),
    premiumAmount: '',
  }
}

/** Current Policy File setup written after a successful Renewal. Never includes rewrite lineage. */
export type RenewedPolicyCurrentSetup = {
  clientId: string
  policyId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  effectiveDate: string
  expirationDate: string
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  producerSplitPercentage: number
  overrideSplit: boolean
}

export function buildRenewedPolicyCurrentSetup(
  source: RenewRewritePolicySnapshot,
  input: {
    clientId: string
    policyNumber: string
    policyType: string
    carrier: string
    mga: string
    producer: string
    csr: string
    effectiveDate: string
    expirationDate: string
    commissionType: CommissionType
    agencyCommissionPercentage: number | null
    agencyCommissionAmount: number | null
    brokerFee: number
    producerSplitPercentage: number
    overrideSplit?: boolean
  },
): RenewedPolicyCurrentSetup {
  const commissionType = normalizeCommissionType(input.commissionType)
  return {
    clientId: input.clientId.trim() || source.clientId,
    policyId: source.id,
    policyNumber: input.policyNumber.trim(),
    policyType: input.policyType.trim(),
    carrier: input.carrier.trim(),
    mga: input.mga.trim(),
    producer: input.producer.trim(),
    csr: input.csr.trim(),
    effectiveDate: isoDateOnly(input.effectiveDate),
    expirationDate: isoDateOnly(input.expirationDate),
    commissionType,
    agencyCommissionPercentage:
      commissionType === 'percentage' ? Number(input.agencyCommissionPercentage) : null,
    agencyCommissionAmount:
      commissionType === 'flat' ? roundMoney(Number(input.agencyCommissionAmount)) : 0,
    brokerFee: roundMoney(input.brokerFee),
    producerSplitPercentage: roundMoney(input.producerSplitPercentage),
    overrideSplit:
      input.overrideSplit ??
      (roundMoney(input.producerSplitPercentage) !== roundMoney(source.producerSplitPercentage)
        ? true
        : source.overrideSplit),
  }
}

export function renewedSetupToPolicyPatch(setup: RenewedPolicyCurrentSetup): Record<string, unknown> {
  return {
    client_id: setup.clientId,
    policy_number: setup.policyNumber,
    policy_type: setup.policyType || null,
    carrier: setup.carrier || null,
    mga: setup.mga || null,
    producer: setup.producer || null,
    csr: setup.csr || null,
    effective_date: setup.effectiveDate || null,
    expiration_date: setup.expirationDate || null,
    commission_type: setup.commissionType,
    agency_commission_percentage: setup.agencyCommissionPercentage,
    agency_commission_amount: setup.agencyCommissionAmount,
    broker_fee: setup.brokerFee,
    producer_split_percentage: setup.producerSplitPercentage,
    override_split: setup.overrideSplit,
  }
}

export function sourceSnapshotToPolicyPatch(source: RenewRewritePolicySnapshot): Record<string, unknown> {
  return {
    client_id: source.clientId,
    policy_number: source.policyNumber,
    policy_type: source.policyType || null,
    carrier: source.carrier || null,
    mga: source.mga || null,
    producer: source.producer || null,
    csr: source.csr || null,
    effective_date: source.effectiveDate || null,
    expiration_date: source.expirationDate || null,
    commission_type: source.commissionType,
    agency_commission_percentage: source.agencyCommissionPercentage,
    agency_commission_amount:
      source.commissionType === 'flat' ? roundMoney(source.agencyCommissionAmount) : 0,
    broker_fee: roundMoney(source.brokerFee),
    producer_split_percentage: roundMoney(source.producerSplitPercentage),
    override_split: source.overrideSplit,
  }
}

export type RenewPolicyInput = {
  sourcePolicyId: string
  clientId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  effectiveDate: string
  expirationDate: string
  description?: string
  notes?: string
  remarks?: string
  premiumAmount: number
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number | null
  brokerFee: number
  producerSplitPercentage: number
  overrideSplit?: boolean
  reviewerUserId?: string | null
  transactionDate?: string
  producerSplitSource?: 'producer_default' | 'policy_override' | 'transaction_override' | null
}

export type RenewPolicyDeps = {
  bypassAuth?: boolean
  skipActivity?: boolean
  callerAgencyId?: string
  loadSource?: (id: string) => Promise<{ data: RenewRewritePolicySnapshot | null; error: string | null }>
  loadClientAgencyId?: (clientId: string) => Promise<{ agencyProfileId: string | null; error: string | null }>
  hasConflictingPolicyNumber?: (
    clientId: string,
    policyNumber: string,
    excludePolicyId: string,
  ) => Promise<{ conflict: boolean; error: string | null }>
  updatePolicySetup?: (
    policyId: string,
    patch: Record<string, unknown>,
  ) => Promise<{ error: string | null }>
  freezeHistoricalPolicySnapshots?: (
    policyId: string,
    snapshot: HistoricalPolicySnapshot,
  ) => Promise<{ error: string | null }>
  createTransaction?: typeof createTransaction
}

async function loadClientAgencyId(clientId: string): Promise<{ agencyProfileId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, agency_profile_id')
    .eq('id', clientId)
    .is('archived_at', null)
    .maybeSingle()
  if (error) return { agencyProfileId: null, error: error.message }
  if (!data) return { agencyProfileId: null, error: 'Client was not found.' }
  return { agencyProfileId: String(data.agency_profile_id ?? ''), error: null }
}

async function hasConflictingPolicyNumber(
  clientId: string,
  policyNumber: string,
  excludePolicyId: string,
): Promise<{ conflict: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from('policies')
    .select('id, policy_number')
    .eq('client_id', clientId)
    .is('archived_at', null)
    .neq('id', excludePolicyId)
  if (error) return { conflict: true, error: error.message }
  const wanted = policyNumber.trim().toLowerCase()
  const conflict = (data ?? []).some(
    (row) => String(row.policy_number ?? '').trim().toLowerCase() === wanted,
  )
  return { conflict, error: null }
}

async function updatePolicySetup(
  policyId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('policies').update(patch).eq('id', policyId).is('archived_at', null)
  return { error: error?.message ?? null }
}

export type HistoricalPolicySnapshot = {
  policyNumber: string
  effectiveDate: string
  expirationDate: string
}

/**
 * Stamp create-time policy number/term onto historical rows that still lack a snapshot.
 * Must run before the Policy File is renamed on renewal. Never overwrites a non-null
 * policy_number, and never rewrites commission / carrier / producer columns.
 */
export async function freezeHistoricalPolicySnapshots(
  policyId: string,
  snapshot: HistoricalPolicySnapshot,
): Promise<{ error: string | null }> {
  const number = snapshot.policyNumber.trim()
  if (!policyId.trim() || !number) return { error: null }

  const patch: Record<string, unknown> = { policy_number: number }
  const eff = isoDateOnly(snapshot.effectiveDate)
  const exp = isoDateOnly(snapshot.expirationDate)
  if (eff) patch.policy_effective_date = eff
  if (exp) patch.policy_expiration_date = exp

  const { error } = await supabase
    .from('transactions')
    .update(patch)
    .eq('policy_id', policyId)
    .is('policy_number', null)
  return { error: error?.message ?? null }
}

/**
 * Same Policy File + Renewal transaction. Optional edits (including Policy #) update
 * current setup only. Does not create a new file or rewrite lineage.
 */
export async function renewPolicy(
  input: RenewPolicyInput,
  deps?: RenewPolicyDeps,
): Promise<{ data: { policyId: string; transactionId: string } | null; error: string | null }> {
  if (!deps?.bypassAuth) {
    const authz = await rejectUnlessRole(
      (role: RoleInput) => canManagePolicies(role) && canManageTransactions(role),
      'You do not have permission to renew a policy.',
    )
    if (!authz.ok) return { data: null, error: authz.message }
  }

  const sourceId = input.sourcePolicyId.trim()
  if (!sourceId) return { data: null, error: 'Source policy is required.' }
  const policyNumber = input.policyNumber.trim()
  if (!policyNumber) return { data: null, error: 'Policy number is required.' }
  const clientId = input.clientId.trim()
  if (!clientId) return { data: null, error: 'Client is required.' }

  const loadSource = deps?.loadSource ?? loadPolicySnapshot
  const source = await loadSource(sourceId)
  if (source.error || !source.data) {
    return { data: null, error: source.error || 'Source policy was not found.' }
  }

  const loadClient = deps?.loadClientAgencyId ?? loadClientAgencyId
  const clientAgency = await loadClient(clientId)
  if (clientAgency.error) return { data: null, error: clientAgency.error }
  const tenantErr = assertRewriteSameAgency(source.data.agencyProfileId, clientAgency.agencyProfileId)
  if (tenantErr) return { data: null, error: tenantErr }
  if (deps?.callerAgencyId) {
    const callerErr = assertRewriteSameAgency(source.data.agencyProfileId, deps.callerAgencyId)
    if (callerErr) return { data: null, error: callerErr }
  }

  const splitError = validateProducerSplitPercentage(input.producerSplitPercentage)
  if (splitError) return { data: null, error: splitError }

  const setup = buildRenewedPolicyCurrentSetup(source.data, { ...input, policyNumber, clientId })
  if ('rewritten_from_policy_id' in setup || 'rewrittenFromPolicyId' in setup) {
    return { data: null, error: 'Renewal cannot create rewrite lineage.' }
  }
  if (setup.policyId !== sourceId) {
    return { data: null, error: 'Renewal must keep the existing Policy File.' }
  }

  const eff = setup.effectiveDate
  const exp = setup.expirationDate
  if (!eff) return { data: null, error: 'Effective date is required.' }
  if (!exp) return { data: null, error: 'Expiration date is required.' }
  if (exp < eff) return { data: null, error: 'Expiration date must be on or after effective date.' }

  if (!Number.isFinite(input.premiumAmount) || !(input.premiumAmount > 0)) {
    return { data: null, error: 'Enter the new renewal premium. It is not copied from the original policy.' }
  }

  const commissionType = setup.commissionType
  if (commissionType === 'percentage') {
    if (
      setup.agencyCommissionPercentage === null ||
      !Number.isFinite(setup.agencyCommissionPercentage) ||
      setup.agencyCommissionPercentage < 0
    ) {
      return { data: null, error: 'Agency commission % must be zero or greater.' }
    }
  } else if (!Number.isFinite(Number(input.agencyCommissionAmount))) {
    return { data: null, error: 'Enter the new flat agency commission amount. It is not copied from the original policy.' }
  }

  const dupCheck = deps?.hasConflictingPolicyNumber ?? hasConflictingPolicyNumber
  const dup = await dupCheck(clientId, policyNumber, sourceId)
  if (dup.error) return { data: null, error: dup.error }
  if (dup.conflict) {
    return { data: null, error: 'A policy with this policy number already exists for this client.' }
  }

  const patch = renewedSetupToPolicyPatch(setup)
  if (Object.prototype.hasOwnProperty.call(patch, 'rewritten_from_policy_id')) {
    return { data: null, error: 'Renewal cannot create rewrite lineage.' }
  }

  const updateSetup = deps?.updatePolicySetup ?? updatePolicySetup
  const freezeHistory = deps?.freezeHistoricalPolicySnapshots ?? freezeHistoricalPolicySnapshots
  const frozen = await freezeHistory(sourceId, {
    policyNumber: source.data.policyNumber,
    effectiveDate: source.data.effectiveDate,
    expirationDate: source.data.expirationDate,
  })
  if (frozen.error) return { data: null, error: frozen.error }

  const updated = await updateSetup(sourceId, patch)
  if (updated.error) return { data: null, error: updated.error }

  const createTxnFn = deps?.createTransaction ?? createTransaction
  const txn = await createTxnFn({
    clientId,
    policyId: sourceId,
    transactionDate: (input.transactionDate || todayIsoDate()).trim(),
    transactionType: 'renewal_premium',
    description: (input.description ?? '').trim() || `Renewal of ${source.data.policyNumber}`,
    notes: input.notes ?? '',
    remarks: input.remarks ?? '',
    producer: setup.producer,
    csr: setup.csr,
    carrier: setup.carrier,
    mga: setup.mga,
    premiumAmount: input.premiumAmount,
    commissionType,
    agencyCommissionPercentage: setup.agencyCommissionPercentage,
    agencyCommissionAmount: commissionType === 'flat' ? Number(input.agencyCommissionAmount) : null,
    brokerFee: setup.brokerFee,
    producerSplitPercentage: setup.producerSplitPercentage,
    reviewerUserId: input.reviewerUserId ?? null,
    producerSplitSource: input.producerSplitSource ?? null,
    policyNumber,
    policyEffectiveDate: eff,
    policyExpirationDate: exp,
  })

  if (txn.error || !txn.data?.id) {
    await updateSetup(sourceId, sourceSnapshotToPolicyPatch(source.data))
    return {
      data: null,
      error: txn.error?.message || 'Renewal transaction could not be saved. The Policy File was left unchanged.',
    }
  }

  if (!deps?.skipActivity) {
    await recordActivity({
      action: 'policy_renew',
      entityType: 'policy',
      entityId: sourceId,
      recordReference: policyNumber,
      clientId,
      policyId: sourceId,
      transactionId: txn.data.id,
      newValue: {
        policy_number: policyNumber,
        previous_policy_number: source.data.policyNumber,
        transaction_id: txn.data.id,
      },
    })
  }

  return { data: { policyId: sourceId, transactionId: txn.data.id }, error: null }
}

export type RewritePrefill = {
  clientId: string
  clientName: string
  /** Blank — user must enter/confirm a new number. */
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  /** Copied from the source file; not rolled to the next renewal term. */
  effectiveDate: string
  expirationDate: string
  status: PolicyStatusValue
  notes: string
  remarks: string
  commissionType: CommissionType
  agencyCommissionPercentage: string
  agencyCommissionAmount: string
  brokerFee: string
  producerSplitPercentage: string
  premiumAmount: string
  rewrittenFromPolicyId: string
  rewrittenFromPolicyNumber: string
}

export function rewriteStatusFromPolicy(status: string | null | undefined): PolicyStatusValue {
  const value = String(status ?? '').trim().toLowerCase()
  return (POLICY_STATUSES as readonly string[]).includes(value)
    ? (value as PolicyStatusValue)
    : 'active'
}

/**
 * Prefill replacement setup from the existing Policy File.
 * Dates stay on the source term (mid-term rewrite is allowed) and are independently editable.
 * New Policy #, premium, and actual commission amount stay blank.
 */
export function rewritePrefillFromPolicy(policy: RenewRewritePolicySnapshot): RewritePrefill {
  return {
    clientId: policy.clientId,
    clientName: policy.clientName,
    policyNumber: '',
    policyType: policy.policyType,
    carrier: policy.carrier,
    mga: policy.mga,
    producer: policy.producer,
    csr: policy.csr,
    effectiveDate: isoDateOnly(policy.effectiveDate),
    expirationDate: isoDateOnly(policy.expirationDate),
    status: rewriteStatusFromPolicy(policy.status),
    notes: policy.notes,
    remarks: '',
    commissionType: normalizeCommissionType(policy.commissionType),
    agencyCommissionPercentage:
      policy.agencyCommissionPercentage === null ? '' : String(policy.agencyCommissionPercentage),
    agencyCommissionAmount: '',
    brokerFee: String(policy.brokerFee ?? 0),
    producerSplitPercentage: String(policy.producerSplitPercentage ?? ''),
    premiumAmount: '',
    rewrittenFromPolicyId: policy.id,
    rewrittenFromPolicyNumber: policy.policyNumber,
  }
}

export type PolicyLineageLink = {
  id: string
  policyNumber: string
}

export function mapPolicySnapshot(row: Record<string, unknown>, clientName = ''): RenewRewritePolicySnapshot {
  const pctRaw = row.agency_commission_percentage
  return {
    id: String(row.id ?? ''),
    clientId: String(row.client_id ?? ''),
    clientName,
    policyNumber: String(row.policy_number ?? '').trim(),
    policyType: String(row.policy_type ?? '').trim(),
    carrier: String(row.carrier ?? '').trim(),
    mga: String(row.mga ?? '').trim(),
    producer: String(row.producer ?? '').trim(),
    csr: String(row.csr ?? '').trim(),
    effectiveDate: isoDateOnly(String(row.effective_date ?? '')),
    expirationDate: isoDateOnly(String(row.expiration_date ?? '')),
    status: String(row.status ?? 'pending'),
    notes: String(row.notes ?? ''),
    commissionType: normalizeCommissionType(row.commission_type as string | null),
    agencyCommissionPercentage:
      pctRaw === null || pctRaw === undefined || pctRaw === '' ? null : Number(pctRaw),
    agencyCommissionAmount: Number(row.agency_commission_amount ?? 0) || 0,
    brokerFee: Number(row.broker_fee ?? 0) || 0,
    producerSplitPercentage: Number(row.producer_split_percentage ?? 0) || 0,
    overrideSplit: Boolean(row.override_split),
    agencyProfileId: String(row.agency_profile_id ?? ''),
    premium: Number(row.premium ?? 0) || 0,
  }
}

export async function loadPolicySnapshot(
  policyId: string,
): Promise<{ data: RenewRewritePolicySnapshot | null; error: string | null }> {
  const { data, error } = await supabase
    .from('policies')
    .select(
      `
      id,
      client_id,
      policy_number,
      policy_type,
      carrier,
      mga,
      producer,
      csr,
      effective_date,
      expiration_date,
      status,
      notes,
      commission_type,
      agency_commission_percentage,
      agency_commission_amount,
      broker_fee,
      producer_split_percentage,
      override_split,
      agency_profile_id,
      premium,
      rewritten_from_policy_id,
      clients!policies_client_id_fkey ( business_name )
    `,
    )
    .eq('id', policyId)
    .is('archived_at', null)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Source policy was not found.' }
  const client = Array.isArray(data.clients) ? data.clients[0] : data.clients
  return {
    data: mapPolicySnapshot(data as Record<string, unknown>, String(client?.business_name ?? '')),
    error: null,
  }
}

export async function loadPolicyRewriteLineage(policyId: string): Promise<{
  rewrittenFrom: PolicyLineageLink | null
  rewrittenTo: PolicyLineageLink[]
  error: string | null
}> {
  const { data: row, error: fromError } = await supabase
    .from('policies')
    .select('id, rewritten_from_policy_id')
    .eq('id', policyId)
    .maybeSingle()
  if (fromError) {
    return { rewrittenFrom: null, rewrittenTo: [], error: fromError.message }
  }

  let rewrittenFrom: PolicyLineageLink | null = null
  const fromId = String(row?.rewritten_from_policy_id ?? '').trim()
  if (fromId) {
    const { data: pred, error: predError } = await supabase
      .from('policies')
      .select('id, policy_number')
      .eq('id', fromId)
      .maybeSingle()
    if (predError) {
      return { rewrittenFrom: null, rewrittenTo: [], error: predError.message }
    }
    if (pred) {
      rewrittenFrom = {
        id: String(pred.id),
        policyNumber: String(pred.policy_number ?? '').trim() || pred.id,
      }
    }
  }

  const { data: successors, error: toError } = await supabase
    .from('policies')
    .select('id, policy_number')
    .eq('rewritten_from_policy_id', policyId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (toError) {
    return { rewrittenFrom, rewrittenTo: [], error: toError.message }
  }

  return {
    rewrittenFrom,
    rewrittenTo: (successors ?? []).map((p) => ({
      id: String(p.id),
      policyNumber: String(p.policy_number ?? '').trim() || String(p.id),
    })),
    error: null,
  }
}

export type RewritePolicyInput = {
  sourcePolicyId: string
  clientId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  effectiveDate: string
  expirationDate: string
  status?: PolicyStatusValue
  notes?: string
  remarks?: string
  premiumAmount: number
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number | null
  brokerFee: number
  producerSplitPercentage: number
  overrideSplit?: boolean
  reviewerUserId?: string | null
}

export type RewritePolicyDeps = {
  bypassAuth?: boolean
  skipActivity?: boolean
  callerAgencyId?: string
  loadSource?: (id: string) => Promise<{ data: RenewRewritePolicySnapshot | null; error: string | null }>
  loadClientAgencyId?: (clientId: string) => Promise<{ agencyProfileId: string | null; error: string | null }>
  createPolicy?: typeof createPolicy
  createTransaction?: typeof createTransaction
}

export async function rewritePolicy(
  input: RewritePolicyInput,
  deps?: RewritePolicyDeps,
): Promise<{ data: { policyId: string; transactionId: string } | null; error: string | null }> {
  if (!deps?.bypassAuth) {
    const authz = await rejectUnlessRole(
      (role: RoleInput) => canManagePolicies(role) && canManageTransactions(role),
      'You do not have permission to rewrite a policy.',
    )
    if (!authz.ok) return { data: null, error: authz.message }
  }

  const sourceId = input.sourcePolicyId.trim()
  if (!sourceId) return { data: null, error: 'Source policy is required.' }
  const policyNumber = input.policyNumber.trim()
  if (!policyNumber) return { data: null, error: 'New policy number is required.' }
  const clientId = input.clientId.trim()
  if (!clientId) return { data: null, error: 'Client is required.' }

  const loadSource = deps?.loadSource ?? loadPolicySnapshot
  const source = await loadSource(sourceId)
  if (source.error || !source.data) {
    return { data: null, error: source.error || 'Source policy was not found.' }
  }

  const selfErr = assertNotSelfRewrite(sourceId)
  if (selfErr) return { data: null, error: selfErr }

  const loadClient = deps?.loadClientAgencyId ?? loadClientAgencyId
  const clientAgency = await loadClient(clientId)
  if (clientAgency.error) return { data: null, error: clientAgency.error }
  const clientTenantErr = assertRewriteSameAgency(source.data.agencyProfileId, clientAgency.agencyProfileId)
  if (clientTenantErr) return { data: null, error: clientTenantErr }
  if (deps?.callerAgencyId) {
    const tenantErr = assertRewriteSameAgency(source.data.agencyProfileId, deps.callerAgencyId)
    if (tenantErr) return { data: null, error: tenantErr }
  }

  const splitError = validateProducerSplitPercentage(input.producerSplitPercentage)
  if (splitError) return { data: null, error: splitError }

  const eff = isoDateOnly(input.effectiveDate)
  const exp = isoDateOnly(input.expirationDate)
  if (!eff) return { data: null, error: 'Effective date is required.' }
  if (!exp) return { data: null, error: 'Expiration date is required.' }
  if (exp < eff) return { data: null, error: 'Expiration date must be on or after effective date.' }

  if (!Number.isFinite(input.premiumAmount) || !(input.premiumAmount > 0)) {
    return { data: null, error: 'Enter the new policy premium. It is not copied from the original policy.' }
  }

  const splitChanged =
    roundMoney(input.producerSplitPercentage) !== roundMoney(source.data.producerSplitPercentage)
  const overrideSplit = input.overrideSplit ?? (splitChanged ? true : source.data.overrideSplit)

  const createPolicyFn = deps?.createPolicy ?? createPolicy
  const created = await createPolicyFn({
    clientId,
    policyNumber,
    policyType: input.policyType,
    carrier: input.carrier,
    mga: input.mga,
    producer: input.producer,
    csr: input.csr,
    effectiveDate: eff,
    expirationDate: exp,
    status: input.status ?? 'active',
    notes: input.notes ?? '',
    commissionType: input.commissionType,
    agencyCommissionPercentage: input.agencyCommissionPercentage,
    agencyCommissionAmount: input.agencyCommissionAmount,
    producerSplitPercentage: input.producerSplitPercentage,
    overrideSplit,
    brokerFee: input.brokerFee,
    premium: 0,
    rewrittenFromPolicyId: sourceId,
  })
  if (created.error || !created.data?.id) {
    return { data: null, error: created.error?.message || 'Could not create the rewritten policy.' }
  }

  const newPolicyId = created.data.id
  const newIdErr = assertNotSelfRewrite(sourceId, newPolicyId)
  if (newIdErr) {
    await supabase
      .from('policies')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', newPolicyId)
    return { data: null, error: newIdErr }
  }

  const createTxnFn = deps?.createTransaction ?? createTransaction
  const txn = await createTxnFn({
    clientId,
    policyId: newPolicyId,
    transactionDate: todayIsoDate(),
    transactionType: 'new_policy_premium',
    description: `Rewrite of ${source.data.policyNumber}`,
    notes: input.notes ?? '',
    remarks: input.remarks ?? '',
    producer: input.producer,
    csr: input.csr,
    carrier: input.carrier,
    mga: input.mga,
    premiumAmount: input.premiumAmount,
    commissionType: input.commissionType,
    agencyCommissionPercentage: input.agencyCommissionPercentage,
    agencyCommissionAmount: input.agencyCommissionAmount,
    brokerFee: input.brokerFee,
    producerSplitPercentage: input.producerSplitPercentage,
    reviewerUserId: input.reviewerUserId ?? null,
    policyNumber,
    policyEffectiveDate: eff,
    policyExpirationDate: exp,
    transactionEffectiveDate: eff,
    transactionExpirationDate: exp,
  })

  if (txn.error || !txn.data?.id) {
    await supabase
      .from('policies')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', newPolicyId)
    return {
      data: null,
      error: txn.error?.message || 'Rewritten policy was created but the opening transaction failed.',
    }
  }

  if (!deps?.skipActivity) {
    await recordActivity({
      action: 'policy_rewrite',
      entityType: 'policy',
      entityId: newPolicyId,
      recordReference: policyNumber,
      clientId: input.clientId,
      policyId: newPolicyId,
      newValue: {
        rewritten_from_policy_id: sourceId,
        rewritten_from_policy_number: source.data.policyNumber,
        rewritten_to_policy_id: newPolicyId,
        rewritten_to_policy_number: policyNumber,
        transaction_id: txn.data.id,
      },
    })
  }

  return { data: { policyId: newPolicyId, transactionId: txn.data.id }, error: null }
}
