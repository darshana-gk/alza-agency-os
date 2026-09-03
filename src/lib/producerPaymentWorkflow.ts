/**
 * Pure producer-payment / recovery workflow helpers.
 * Kept supabase-free so validators can import them directly.
 */

export const PRODUCER_PAYMENT_MONEY_TOLERANCE = 0.009

export const SETTLED_BY_RECOVERY_LABEL = 'Settled by Recovery'

export const NEGATIVE_PRODUCER_RECOVERY_WORKFLOW_STATUSES = [
  'Recovery Required',
  'Recovery Pending',
  'Partially Recovered',
  'Recovered / Settled',
] as const

export type NegativeProducerRecoveryWorkflowStatus =
  (typeof NEGATIVE_PRODUCER_RECOVERY_WORKFLOW_STATUSES)[number]

export const NEGATIVE_PRODUCER_RECOVERY_MARK_READY_MESSAGE =
  'This approved transaction has a negative producer commission. It cannot be marked Ready for Payment. Record a recovery/chargeback and track Recovery Required → Recovery Pending → Partially Recovered → Recovered / Settled. Recovery is never created automatically.'

export type RecoveryApplicationInput = {
  status?: string | null
  voidedAt?: string | null
  voided_at?: string | null
  appliedAmount?: number | string | null
  applied_amount?: number | string | null
  remainingAmount?: number | string | null
  remaining_amount?: number | string | null
}

export type ProducerPaymentBatchDisplayInput = {
  status?: string | null
  paymentChannel?: string | null
  voided?: boolean
  voidedAt?: string | null
  netPayment?: number | string | null
  grossCommission?: number | string | null
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function isNearZero(value: number): boolean {
  return Math.abs(value) <= PRODUCER_PAYMENT_MONEY_TOLERANCE
}

function isPositiveMoney(value: number): boolean {
  return value > PRODUCER_PAYMENT_MONEY_TOLERANCE
}

function isActiveRecovery(row: RecoveryApplicationInput): boolean {
  if (row.voidedAt || row.voided_at) return false
  return String(row.status ?? '').toLowerCase().trim() !== 'voided'
}

export function sumRecoveryApplication(recoveries: RecoveryApplicationInput[] | null | undefined): {
  applied: number
  remaining: number
  activeCount: number
} {
  let applied = 0
  let remaining = 0
  let activeCount = 0
  for (const row of recoveries ?? []) {
    if (!isActiveRecovery(row)) continue
    activeCount += 1
    applied += toNumber(row.appliedAmount ?? row.applied_amount)
    remaining += toNumber(row.remainingAmount ?? row.remaining_amount)
  }
  return {
    applied: Math.round(applied * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    activeCount,
  }
}

/** Draft batch whose gross was fully offset by recovery. Display-only — DB status stays draft. */
export function isBatchSettledByRecovery(batch: ProducerPaymentBatchDisplayInput): boolean {
  if (batch.voided || batch.voidedAt) return false
  const status = String(batch.status ?? '').toLowerCase().trim()
  if (status !== 'draft') return false
  return isPositiveMoney(toNumber(batch.grossCommission)) && isNearZero(toNumber(batch.netPayment))
}

export function formatPaidOrDraftBatchStatusLabel(
  status: string | null | undefined,
  paymentChannel?: string | null,
): string {
  const normalized = String(status ?? '').toLowerCase().trim()
  if (normalized === 'draft') return 'Ready to Pay'
  if (normalized === 'paid') {
    const channel = (paymentChannel ?? '').trim()
    if (channel === 'alza_flow_pay') return 'Paid via ALZA Flow Pay'
    if (channel === 'outside_alza_flow') return 'Paid Outside ALZA Flow'
    return 'Paid (Historical)'
  }
  if (!normalized) return 'Unknown'
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatProducerPaymentBatchStatus(batch: ProducerPaymentBatchDisplayInput): string {
  if (isBatchSettledByRecovery(batch)) return SETTLED_BY_RECOVERY_LABEL
  return formatPaidOrDraftBatchStatusLabel(batch.status, batch.paymentChannel)
}

export function canConfirmProducerPaidBatch(batch: {
  status: string
  voided: boolean
  itemCount: number
  netPayment: number
  grossCommission?: number
}): boolean {
  return (
    batch.status === 'draft' &&
    !batch.voided &&
    batch.itemCount >= 1 &&
    isPositiveMoney(batch.netPayment) &&
    !isBatchSettledByRecovery(batch)
  )
}

/**
 * Recovery workflow from actual application, not mere existence of a recovery row.
 * Positive producer commission returns null (payout path unchanged).
 */
export function getNegativeProducerRecoveryWorkflowStatus(
  producerCommissionAmount: number | string | null | undefined,
  recoveries: RecoveryApplicationInput[] | null | undefined,
): NegativeProducerRecoveryWorkflowStatus | null {
  if (!(toNumber(producerCommissionAmount) < 0)) return null
  const { applied, remaining, activeCount } = sumRecoveryApplication(recoveries)
  if (activeCount === 0) return 'Recovery Required'
  if (remaining <= PRODUCER_PAYMENT_MONEY_TOLERANCE) return 'Recovered / Settled'
  if (isPositiveMoney(applied)) return 'Partially Recovered'
  return 'Recovery Pending'
}

export function isNegativeProducerRecoveryWorkflowStatus(
  status: string | null | undefined,
): status is NegativeProducerRecoveryWorkflowStatus {
  return (NEGATIVE_PRODUCER_RECOVERY_WORKFLOW_STATUSES as readonly string[]).includes(status ?? '')
}

export function hasNegativeProducerCommission(
  producerCommissionAmount: number | string | null | undefined,
): boolean {
  return toNumber(producerCommissionAmount) < 0
}
