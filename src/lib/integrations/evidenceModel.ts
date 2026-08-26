/**
 * Normalized payment / bank / accounting evidence model.
 * Multiple evidence pieces may associate to one expected commission/settlement.
 * Amount match alone must NEVER auto-confirm commission receipt.
 */

export type EvidenceKind =
  | 'payment_platform_event'
  | 'bank_deposit'
  | 'accounting_receipt'
  | 'carrier_mga_statement'

export type NormalizedSettlementEvidence = {
  id: string
  agencyId: string
  kind: EvidenceKind
  providerId: string | null
  amount: number | null
  currency: string | null
  occurredAt: string | null
  settlementDate: string | null
  paymentStatus: string | null
  invoiceOrPaymentReference: string | null
  payerName: string | null
  policyReference: string | null
  customerReference: string | null
  accountingReference: string | null
  /** Link to expected commission / settlement candidate (future). */
  expectedSettlementId: string | null
  rawExternalReference: string | null
  rawSourceMetadata: Record<string, string | number | boolean | null>
}

export const EVIDENCE_AUTO_CONFIRM_RULE =
  'Do NOT automatically mark commissions received simply because amounts match. Existing ALZA reconciliation rules must justify receipt confirmation.'

export const NORMALIZED_EVIDENCE_REQUIRED_KEYS = [
  'id',
  'agencyId',
  'kind',
  'providerId',
  'amount',
  'currency',
  'occurredAt',
  'settlementDate',
  'paymentStatus',
  'invoiceOrPaymentReference',
  'payerName',
  'policyReference',
  'customerReference',
  'accountingReference',
  'expectedSettlementId',
  'rawExternalReference',
  'rawSourceMetadata',
] as const

export function emptyNormalizedSettlementEvidence(
  partial?: Partial<NormalizedSettlementEvidence>,
): NormalizedSettlementEvidence {
  return {
    id: '',
    agencyId: '',
    kind: 'payment_platform_event',
    providerId: null,
    amount: null,
    currency: null,
    occurredAt: null,
    settlementDate: null,
    paymentStatus: null,
    invoiceOrPaymentReference: null,
    payerName: null,
    policyReference: null,
    customerReference: null,
    accountingReference: null,
    expectedSettlementId: null,
    rawExternalReference: null,
    rawSourceMetadata: {},
    ...partial,
  }
}

export function assertEvidenceDoesNotAutoConfirm(input: {
  amountsMatch: boolean
  alzaReconciliationRulesJustifyReceipt: boolean
}): { mayConfirmReceipt: boolean; reason: string } {
  if (input.amountsMatch && !input.alzaReconciliationRulesJustifyReceipt) {
    return {
      mayConfirmReceipt: false,
      reason: EVIDENCE_AUTO_CONFIRM_RULE,
    }
  }
  return {
    mayConfirmReceipt: input.alzaReconciliationRulesJustifyReceipt,
    reason: input.alzaReconciliationRulesJustifyReceipt
      ? 'Existing ALZA reconciliation rules justify confirmation'
      : 'Insufficient justification',
  }
}
