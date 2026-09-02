/**
 * V1 Renew / Rewrite helpers.
 *
 * Renew: same policy file + Renewal transaction (new current term).
 * Rewrite: new policy file linked via rewritten_from_policy_id + New Business transaction.
 */

import { createTransaction, normalizeCommissionType, todayIsoDate, type CommissionType } from './commission'
import { createPolicy, type PolicyStatusValue } from './directory'
import { canManagePolicies, canManageTransactions, rejectUnlessRole, type RoleInput } from './permissions'
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
  effectiveDate: string
  expirationDate: string
  commissionType: CommissionType
  agencyCommissionPercentage: string
  agencyCommissionAmount: string
  brokerFee: string
  producerSplitPercentage: string
  premiumAmount: string
  rewrittenFromPolicyId: string
  rewrittenFromPolicyNumber: string
}

export function rewritePrefillFromPolicy(policy: RenewRewritePolicySnapshot): RewritePrefill {
  const term = defaultNextTermDates(policy.expirationDate)
  return {
    clientId: policy.clientId,
    clientName: policy.clientName,
    policyNumber: '',
    policyType: policy.policyType,
    carrier: policy.carrier,
    mga: policy.mga,
    producer: policy.producer,
    csr: policy.csr,
    effectiveDate: term.effectiveDate,
    expirationDate: term.expirationDate,
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

  const loadSource = deps?.loadSource ?? loadPolicySnapshot
  const source = await loadSource(sourceId)
  if (source.error || !source.data) {
    return { data: null, error: source.error || 'Source policy was not found.' }
  }

  const selfErr = assertNotSelfRewrite(sourceId)
  if (selfErr) return { data: null, error: selfErr }

  if (deps?.callerAgencyId) {
    const tenantErr = assertRewriteSameAgency(source.data.agencyProfileId, deps.callerAgencyId)
    if (tenantErr) return { data: null, error: tenantErr }
  }

  const eff = isoDateOnly(input.effectiveDate)
  const exp = isoDateOnly(input.expirationDate)
  if (!eff) return { data: null, error: 'Effective date is required.' }
  if (!exp) return { data: null, error: 'Expiration date is required.' }
  if (exp < eff) return { data: null, error: 'Expiration date must be on or after effective date.' }

  if (!Number.isFinite(input.premiumAmount) || !(input.premiumAmount > 0)) {
    return { data: null, error: 'Enter the new policy premium. It is not copied from the original policy.' }
  }

  const createPolicyFn = deps?.createPolicy ?? createPolicy
  const created = await createPolicyFn({
    clientId: input.clientId,
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
    overrideSplit: input.overrideSplit ?? source.data.overrideSplit,
    brokerFee: input.brokerFee,
    premium: 0,
    rewrittenFromPolicyId: sourceId,
  })
  if (created.error || !created.data?.id) {
    return { data: null, error: created.error?.message || 'Could not create the rewritten policy.' }
  }

  const newPolicyId = created.data.id
  const createTxnFn = deps?.createTransaction ?? createTransaction
  const txn = await createTxnFn({
    clientId: input.clientId.trim(),
    policyId: newPolicyId,
    transactionDate: todayIsoDate(),
    transactionType: 'new_policy_premium',
    description: `Rewrite of ${source.data.policyNumber}`,
    notes: '',
    remarks: '',
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
    policyEffectiveDate: eff,
    policyExpirationDate: exp,
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
        transaction_id: txn.data.id,
      },
    })
  }

  return { data: { policyId: newPolicyId, transactionId: txn.data.id }, error: null }
}
