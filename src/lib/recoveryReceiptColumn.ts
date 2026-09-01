/** Display-only Receipt column for Financials recoveries. No receipt_id / client URL. */

export type RecoveryReceiptAllocationRef = {
  batchId: string
  batchNumber: string | null
}

export type RecoveryReceiptColumn = {
  label: string
  kind: 'empty' | 'direct_payment' | 'payout_batch'
  batches: Array<{ batchId: string; batchNumber: string }>
}

const EMPTY: RecoveryReceiptColumn = { label: '—', kind: 'empty', batches: [] }

function nonempty(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed || trimmed === '—') return null
  return trimmed
}

function isDirectPaymentSettlement(method: string | null | undefined): boolean {
  return (method ?? '').trim().toLowerCase() === 'direct_payment'
}

function uniqueBatches(
  allocations: RecoveryReceiptAllocationRef[] | undefined,
): Array<{ batchId: string; batchNumber: string }> {
  const seen = new Set<string>()
  const out: Array<{ batchId: string; batchNumber: string }> = []
  for (const row of allocations ?? []) {
    const batchId = nonempty(row.batchId)
    if (!batchId || seen.has(batchId)) continue
    seen.add(batchId)
    out.push({
      batchId,
      batchNumber: nonempty(row.batchNumber) ?? 'Payment batch',
    })
  }
  return out
}

/**
 * Receipt cell for a recovery.
 * Open / unapplied rows render "—". Links come only from allocation rows
 * (Deduct from Next Payout) or a confirmed Direct Payment record — never from
 * the source transaction, client, or agency_commission_receipts.receipt_id.
 */
export function formatRecoveryReceiptColumn(input: {
  settlementMethod?: string | null
  directPaidAt?: string | null
  directPaymentReference?: string | null
  directPaidPaymentMethodLabel?: string | null
  directPaidDateLabel?: string | null
  allocations?: RecoveryReceiptAllocationRef[]
}): RecoveryReceiptColumn {
  if (isDirectPaymentSettlement(input.settlementMethod)) {
    const reference = nonempty(input.directPaymentReference)
    const confirmed = Boolean(nonempty(input.directPaidAt) || reference)
    if (!confirmed) return EMPTY
    const bits = [
      reference,
      nonempty(input.directPaidPaymentMethodLabel),
      nonempty(input.directPaidDateLabel),
    ].filter((bit): bit is string => Boolean(bit))
    if (bits.length === 0) return EMPTY
    return { label: bits.join(' · '), kind: 'direct_payment', batches: [] }
  }

  const batches = uniqueBatches(input.allocations)
  if (batches.length === 0) return EMPTY
  return {
    label: batches.map((row) => row.batchNumber).join(' · '),
    kind: 'payout_batch',
    batches,
  }
}
