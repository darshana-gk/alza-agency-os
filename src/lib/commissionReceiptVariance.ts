/**
 * Compare a confirmed agency-commission receipt against the transaction's
 * current expected agency commission. The live received amount is
 * transactions.amount_received (not agency_commission_receipts).
 */

export type CommissionReceiptVarianceInput = {
  agencyCommissionConfirmed: boolean
  amountReceived: number | null
  agencyCommissionAmount: number
}

export type CommissionReceiptVariance = {
  hasVariance: boolean
  variance: number
  received: number
  expected: number
}

/** Sub-penny tolerance — same as receipt-confirm variance. */
export const COMMISSION_RECEIPT_VARIANCE_TOLERANCE = 0.009

/**
 * Returns the variance between confirmed receipt and current expected commission.
 * Positive = overpaid, negative = underpaid. `null` when receipt is not yet confirmed
 * or the live received amount is missing.
 */
export function commissionReceiptVariance(
  tx: CommissionReceiptVarianceInput,
): CommissionReceiptVariance | null {
  if (!tx.agencyCommissionConfirmed || tx.amountReceived === null || tx.amountReceived === undefined) {
    return null
  }
  const variance = tx.amountReceived - tx.agencyCommissionAmount
  return {
    hasVariance: Math.abs(variance) > COMMISSION_RECEIPT_VARIANCE_TOLERANCE,
    variance,
    received: tx.amountReceived,
    expected: tx.agencyCommissionAmount,
  }
}

export function isMarkReadyBlockedByReceiptVariance(tx: CommissionReceiptVarianceInput): boolean {
  const v = commissionReceiptVariance(tx)
  return Boolean(v?.hasVariance)
}
