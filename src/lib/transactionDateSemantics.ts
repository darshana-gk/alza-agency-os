/**
 * Add Transaction date behavior by transaction type.
 * Policy-term updates apply only to New Business and Renewal.
 */

export const POLICY_TERM_UPDATING_TYPES = ['new_policy_premium', 'renewal_premium'] as const

export type PolicyTermUpdatingType = (typeof POLICY_TERM_UPDATING_TYPES)[number]

export type TransactionDateSemantics = {
  type: string
  label: string
  policyTerm: 'editable_required' | 'read_only'
  policyEffectiveLabel: string
  policyExpirationLabel: string
  updatesPolicyTerm: boolean
  snapshotTxnDatesFromPolicyTerm: boolean
  showTxnEffective: boolean
  showTxnExpiration: boolean
  txnEffectiveRequired: boolean
  txnExpirationRequired: boolean
  txnEffectiveLabel: string
  txnExpirationLabel: string
  notes: string
}

const MATRIX: Record<string, TransactionDateSemantics> = {
  new_policy_premium: {
    type: 'new_policy_premium',
    label: 'New Business',
    policyTerm: 'editable_required',
    policyEffectiveLabel: 'Policy Effective Date',
    policyExpirationLabel: 'Policy Expiration Date',
    updatesPolicyTerm: true,
    snapshotTxnDatesFromPolicyTerm: true,
    showTxnEffective: false,
    showTxnExpiration: false,
    txnEffectiveRequired: false,
    txnExpirationRequired: false,
    txnEffectiveLabel: 'Transaction Effective Date',
    txnExpirationLabel: 'Transaction Expiration Date',
    notes:
      'Establishes or updates the policy term. The transaction snapshots that same term — do not enter the dates twice.',
  },
  renewal_premium: {
    type: 'renewal_premium',
    label: 'Renewal',
    policyTerm: 'editable_required',
    policyEffectiveLabel: 'New Policy Effective Date',
    policyExpirationLabel: 'New Policy Expiration Date',
    updatesPolicyTerm: true,
    snapshotTxnDatesFromPolicyTerm: true,
    showTxnEffective: false,
    showTxnExpiration: false,
    txnEffectiveRequired: false,
    txnExpirationRequired: false,
    txnEffectiveLabel: 'Transaction Effective Date',
    txnExpirationLabel: 'Transaction Expiration Date',
    notes:
      'Establishes the renewed policy term. The transaction snapshots the renewal term — do not enter the dates twice.',
  },
  endorsement_premium: {
    type: 'endorsement_premium',
    label: 'Endorsement',
    policyTerm: 'read_only',
    policyEffectiveLabel: 'Policy Effective Date',
    policyExpirationLabel: 'Policy Expiration Date',
    updatesPolicyTerm: false,
    snapshotTxnDatesFromPolicyTerm: false,
    showTxnEffective: true,
    showTxnExpiration: true,
    txnEffectiveRequired: true,
    txnExpirationRequired: true,
    txnEffectiveLabel: 'Transaction Effective Date',
    txnExpirationLabel: 'Transaction Expiration Date',
    notes: 'Transaction effective and expiration dates apply to the endorsement only. The existing policy term is not changed.',
  },
  audit_premium: {
    type: 'audit_premium',
    label: 'Audit',
    policyTerm: 'read_only',
    policyEffectiveLabel: 'Policy Effective Date',
    policyExpirationLabel: 'Policy Expiration Date',
    updatesPolicyTerm: false,
    snapshotTxnDatesFromPolicyTerm: false,
    showTxnEffective: true,
    showTxnExpiration: true,
    txnEffectiveRequired: false,
    txnExpirationRequired: false,
    txnEffectiveLabel: 'Transaction Effective Date',
    txnExpirationLabel: 'Transaction Expiration Date',
    notes: 'Transaction dates apply to the audit. The existing policy term is not changed.',
  },
  cancellation_premium: {
    type: 'cancellation_premium',
    label: 'Cancellation',
    policyTerm: 'read_only',
    policyEffectiveLabel: 'Policy Effective Date',
    policyExpirationLabel: 'Policy Expiration Date',
    updatesPolicyTerm: false,
    snapshotTxnDatesFromPolicyTerm: false,
    showTxnEffective: true,
    showTxnExpiration: true,
    txnEffectiveRequired: true,
    txnExpirationRequired: false,
    txnEffectiveLabel: 'Cancellation Effective Date',
    txnExpirationLabel: 'Transaction Expiration Date',
    notes:
      'Cancellation effective date is stored on the transaction. Transaction expiration is optional. The original policy term is not overwritten.',
  },
  return_premium: {
    type: 'return_premium',
    label: 'Return Premium (Legacy)',
    policyTerm: 'read_only',
    policyEffectiveLabel: 'Policy Effective Date',
    policyExpirationLabel: 'Policy Expiration Date',
    updatesPolicyTerm: false,
    snapshotTxnDatesFromPolicyTerm: false,
    showTxnEffective: true,
    showTxnExpiration: true,
    txnEffectiveRequired: false,
    txnExpirationRequired: false,
    txnEffectiveLabel: 'Transaction Effective Date',
    txnExpirationLabel: 'Transaction Expiration Date',
    notes: 'Legacy return premium. Transaction dates only. Policy term is not changed.',
  },
}

export function transactionDateSemantics(type: string): TransactionDateSemantics {
  return MATRIX[type] ?? MATRIX.audit_premium
}

export function isPolicyTermUpdatingType(type: string): type is PolicyTermUpdatingType {
  return (POLICY_TERM_UPDATING_TYPES as readonly string[]).includes(type)
}

export function isoDateOnly(value: string | null | undefined): string {
  return String(value ?? '').trim().slice(0, 10)
}

export function validateTransactionDateInputs(input: {
  type: string
  policyEffectiveDate: string
  policyExpirationDate: string
  transactionEffectiveDate: string
  transactionExpirationDate: string
}): string | null {
  const semantics = transactionDateSemantics(input.type)
  const policyEff = isoDateOnly(input.policyEffectiveDate)
  const policyExp = isoDateOnly(input.policyExpirationDate)
  const txnEff = isoDateOnly(input.transactionEffectiveDate)
  const txnExp = isoDateOnly(input.transactionExpirationDate)

  if (semantics.policyTerm === 'editable_required') {
    if (!policyEff) return `${semantics.policyEffectiveLabel} is required.`
    if (!policyExp) return `${semantics.policyExpirationLabel} is required.`
    if (policyExp < policyEff) {
      return `${semantics.policyExpirationLabel} must be on or after ${semantics.policyEffectiveLabel}.`
    }
  }

  if (semantics.txnEffectiveRequired && !txnEff) {
    return `${semantics.txnEffectiveLabel} is required.`
  }
  if (semantics.txnExpirationRequired && !txnExp) {
    return `${semantics.txnExpirationLabel} is required.`
  }
  if (txnEff && txnExp && txnExp < txnEff) {
    return `${semantics.txnExpirationLabel} must be on or after ${semantics.txnEffectiveLabel}.`
  }
  return null
}

export function resolvePersistedTransactionDates(input: {
  type: string
  policyEffectiveDate: string
  policyExpirationDate: string
  transactionEffectiveDate: string
  transactionExpirationDate: string
}): { transactionEffectiveDate: string | null; transactionExpirationDate: string | null } {
  const semantics = transactionDateSemantics(input.type)
  if (semantics.snapshotTxnDatesFromPolicyTerm) {
    const policyEff = isoDateOnly(input.policyEffectiveDate)
    const policyExp = isoDateOnly(input.policyExpirationDate)
    return {
      transactionEffectiveDate: policyEff || null,
      transactionExpirationDate: policyExp || null,
    }
  }
  return {
    transactionEffectiveDate: isoDateOnly(input.transactionEffectiveDate) || null,
    transactionExpirationDate: isoDateOnly(input.transactionExpirationDate) || null,
  }
}
