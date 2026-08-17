import { supabase } from './supabase'
import { recordActivity } from './activity'
import {
  canApproveTransactions,
  canActOnAssignedReview,
  canConfirmReceipts,
  canManageProducerPayments,
  canManageRecoveries,
  canManageTransactions,
  canMarkProducerReady,
  canSubmitTransactionReview,
  csrAssignmentMatches,
  csrIdentityMatches,
  normalizeProducerKey,
  rejectUnlessRole,
  toAppRoles,
  type RoleInput,
} from './permissions'

export { isOpsMutatorRole } from './permissions'

/** Confirmed from live data — do not invent additional statuses. */
export const PRODUCER_PAYMENT_STATUSES = ['not_ready', 'ready', 'paid'] as const
export type ProducerPaymentStatus = (typeof PRODUCER_PAYMENT_STATUSES)[number]

export const REVIEW_STATUSES = ['expected', 'matched', 'approved'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Supported transaction_type values (DB CHECK + filters/history). */
export const TRANSACTION_TYPES = [
  'new_policy_premium',
  'renewal_premium',
  'endorsement_premium',
  'audit_premium',
  'cancellation_premium',
  'return_premium',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** Types offered on Add Transaction (excludes legacy return_premium). */
export const TRANSACTION_TYPES_FOR_CREATE = [
  'new_policy_premium',
  'renewal_premium',
  'endorsement_premium',
  'audit_premium',
  'cancellation_premium',
] as const

/** Commission basis — stored on policy (default) and transaction (snapshot). */
export const COMMISSION_TYPES = ['percentage', 'flat'] as const
export type CommissionType = (typeof COMMISSION_TYPES)[number]

export function normalizeCommissionType(value: string | null | undefined): CommissionType {
  const v = (value ?? 'percentage').trim().toLowerCase()
  return v === 'flat' ? 'flat' : 'percentage'
}

export function formatCommissionTypeLabel(type: CommissionType | string | null | undefined): string {
  return normalizeCommissionType(type) === 'flat' ? 'Flat Amount' : 'Percentage'
}

export const typeLabels: Record<string, string> = {
  new_policy_premium: 'New Business',
  renewal_premium: 'Renewal',
  endorsement_premium: 'Endorsement',
  audit_premium: 'Audit',
  cancellation_premium: 'Cancellation',
  return_premium: 'Return Premium (Legacy)',
}

/** Compact list-style type chip — subtle, not a large pill. */
export const typeStyles: Record<string, string> = {
  new_policy_premium: 'bg-emerald-50/80 text-emerald-700',
  renewal_premium: 'bg-sky-50/80 text-sky-700',
  endorsement_premium: 'bg-violet-50/80 text-violet-700',
  audit_premium: 'bg-alza-blue-50/80 text-alza-blue-700',
  cancellation_premium: 'bg-rose-50/80 text-rose-700',
  return_premium: 'bg-orange-50/80 text-orange-700',
}

export const paymentStatusStyles: Record<string, string> = {
  not_ready: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  ready: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
}

export const reviewStatusStyles: Record<string, string> = {
  expected: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  matched: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
}

/**
 * Final display workflow (derived from existing fields).
 * DB review_status remains: expected | matched | approved
 * — matched = Submitted for Review (no new enum value).
 * — Returned for Correction = expected + return reason after Owner/Admin return.
 */
export const WORKFLOW_STATUSES = [
  'Archived',
  'Paid',
  'In Payment Batch',
  'Ready for Payout',
  'Approved',
  'Submitted for Review',
  'Returned for Correction',
  'Receipt Confirmed',
  'Awaiting Receipt',
  'Entered',
] as const
export type TransactionWorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

/** Ordered stages for the transaction detail timeline (excludes Archived). */
export const FINAL_WORKFLOW_STAGES = [
  'Entered',
  'Awaiting Receipt',
  'Receipt Confirmed',
  'Returned for Correction',
  'Submitted for Review',
  'Approved',
  'Ready for Payout',
  'In Payment Batch',
  'Paid',
] as const
export type FinalWorkflowStage = (typeof FINAL_WORKFLOW_STAGES)[number]

export type WorkflowTimelinePhase = 'Entered' | 'Receipt' | 'Review' | 'Payout' | 'Payment'

export const workflowStatusStyles: Record<TransactionWorkflowStatus, string> = {
  Entered: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'Awaiting Receipt': 'bg-orange-50 text-orange-700 ring-orange-600/20',
  'Receipt Confirmed': 'bg-alza-teal-50 text-alza-teal-700 ring-alza-teal-600/20',
  'Returned for Correction': 'bg-orange-50 text-orange-800 ring-orange-600/25',
  'Submitted for Review': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Approved: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
  'Ready for Payout': 'bg-amber-50 text-amber-800 ring-amber-600/20',
  'In Payment Batch': 'bg-violet-50 text-violet-700 ring-violet-600/20',
  Paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  Archived: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export function formatReviewStatusLabel(
  status: string | null | undefined,
  correctionRequired = false,
): string {
  if (correctionRequired) return 'Returned for Correction'
  const normalized = normalizeReviewStatus(status)
  if (normalized === 'matched') return 'Submitted for Review'
  if (normalized === 'approved') return 'Approved'
  return 'Expected'
}

export function getTransactionWorkflowStatus(tx: {
  archived: boolean
  producerPaymentStatus: string
  paidDate: string | null
  paymentBatchId: string | null
  agencyCommissionConfirmed: boolean
  reviewStatus: string
  reviewReturnedAt?: string | null
  reviewReturnReason?: string
}): TransactionWorkflowStatus {
  if (tx.archived) return 'Archived'
  if (tx.producerPaymentStatus === 'paid' || Boolean(tx.paidDate)) return 'Paid'
  if (tx.paymentBatchId) return 'In Payment Batch'
  if (tx.producerPaymentStatus === 'ready') return 'Ready for Payout'
  if (tx.agencyCommissionConfirmed && tx.reviewStatus === 'approved') return 'Approved'
  if (tx.agencyCommissionConfirmed && tx.reviewStatus === 'matched') return 'Submitted for Review'
  if (
    tx.agencyCommissionConfirmed &&
    tx.reviewStatus === 'expected' &&
    (Boolean(tx.reviewReturnedAt) || Boolean(tx.reviewReturnReason?.trim()))
  ) {
    return 'Returned for Correction'
  }
  if (tx.agencyCommissionConfirmed) return 'Receipt Confirmed'
  return 'Awaiting Receipt'
}

function stageIndex(stage: FinalWorkflowStage): number {
  return FINAL_WORKFLOW_STAGES.indexOf(stage)
}

const STAGE_PHASE: Record<FinalWorkflowStage, WorkflowTimelinePhase> = {
  Entered: 'Entered',
  'Awaiting Receipt': 'Receipt',
  'Receipt Confirmed': 'Receipt',
  'Returned for Correction': 'Review',
  'Submitted for Review': 'Review',
  Approved: 'Review',
  'Ready for Payout': 'Payout',
  'In Payment Batch': 'Payment',
  Paid: 'Payment',
}

/** Timeline for drawer: Entered → … → Paid with completed / current / future. */
export function getTransactionWorkflowTimeline(tx: {
  archived: boolean
  producerPaymentStatus: string
  paidDate: string | null
  paymentBatchId: string | null
  agencyCommissionConfirmed: boolean
  reviewStatus: string
  reviewReturnedAt?: string | null
  reviewReturnReason?: string
}): {
  current: FinalWorkflowStage
  phases: WorkflowTimelinePhase[]
  stages: Array<{
    stage: FinalWorkflowStage
    phase: WorkflowTimelinePhase
    state: 'completed' | 'current' | 'future'
  }>
} {
  const workflow = getTransactionWorkflowStatus(tx)
  const current: FinalWorkflowStage =
    workflow === 'Archived'
      ? 'Entered'
      : (FINAL_WORKFLOW_STAGES as readonly string[]).includes(workflow)
        ? (workflow as FinalWorkflowStage)
        : 'Awaiting Receipt'
  const currentIdx = stageIndex(current)
  const visibleStages = FINAL_WORKFLOW_STAGES.filter((stage) => {
    if (stage === 'Returned for Correction') {
      return current === 'Returned for Correction'
    }
    return true
  })
  const stages = visibleStages.map((stage) => {
    const idx = stageIndex(stage)
    let state: 'completed' | 'current' | 'future' = 'future'
    if (stage === 'Entered') {
      state = current === 'Entered' ? 'current' : 'completed'
    } else if (stage === current) {
      state = 'current'
    } else if (idx < currentIdx) {
      state = 'completed'
    }
    if (current === 'Returned for Correction' && stage === 'Submitted for Review') {
      state = 'future'
    }
    if (
      current === 'Returned for Correction' &&
      (stage === 'Receipt Confirmed' || stage === 'Awaiting Receipt')
    ) {
      state = 'completed'
    }
    return { stage, phase: STAGE_PHASE[stage], state }
  })
  return {
    current,
    phases: ['Entered', 'Receipt', 'Review', 'Payout', 'Payment'],
    stages,
  }
}

export const statusBadgeStyles: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  approved: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
  payment_pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  matched: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
  reconciled: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  unmatched: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  open: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  applied: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  void: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  voided: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  cancelled: 'bg-red-50 text-red-700 ring-red-600/20',
  expected: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  not_ready: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  ready: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

/** Confirmed DB CHECK values for producer_payment_batches.status */
export const BATCH_PAYMENT_STATUSES = [
  'draft',
  'approved',
  'payment_pending',
  'paid',
  'failed',
  'voided',
] as const
export type BatchPaymentStatus = (typeof BATCH_PAYMENT_STATUSES)[number]

export function normalizeBatchStatus(value: string | null | undefined): string {
  const v = (value ?? '').toLowerCase().trim()
  if ((BATCH_PAYMENT_STATUSES as readonly string[]).includes(v)) return v
  return 'unknown'
}

export function formatBatchStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeBatchStatus(status)
  if (normalized === 'unknown') return 'Unknown'
  return formatLabel(normalized)
}

/**
 * Payment methods for Confirm Producer Paid.
 * Stored values must match producer_payment_batches.payment_method CHECK.
 */
export const PRODUCER_PAYMENT_METHODS = [
  { value: 'ach', label: 'ACH / Bank Transfer' },
  { value: 'check', label: 'Check' },
  { value: 'wire', label: 'Wire' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
] as const

export type ProducerPaymentMethodValue = (typeof PRODUCER_PAYMENT_METHODS)[number]['value']

export function formatProducerPaymentMethodLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw || raw === '—') return '—'
  const match = PRODUCER_PAYMENT_METHODS.find((m) => m.value === raw)
  if (match) return match.label
  // Legacy stored values (display only; do not rewrite historical rows).
  const legacy: Record<string, string> = {
    ach_bank_transfer: 'ACH / Bank Transfer',
    manual: 'Manual',
  }
  const key = raw.toLowerCase()
  if (legacy[key]) return legacy[key]
  return formatLabel(raw)
}

export function isValidProducerPaymentMethod(value: string | null | undefined): boolean {
  const v = (value ?? '').trim()
  return PRODUCER_PAYMENT_METHODS.some((m) => m.value === v)
}

export function canConfirmProducerPaid(batch: {
  status: string
  voided: boolean
  itemCount: number
  netPayment: number
}): boolean {
  return (
    batch.status === 'draft' &&
    !batch.voided &&
    batch.itemCount >= 1 &&
    batch.netPayment >= 0
  )
}

/** Live recovery statuses (CHECK: open | applied | voided). Never use pending. */
export const RECOVERY_STATUSES = ['open', 'applied', 'voided'] as const
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number]

export type RecoverySettlementMethod = 'next_payout' | 'direct_payment'

/** True when recovery auto-applies against future producer payout batches. */
export function isPayoutAppliedSettlement(method: string | null | undefined): boolean {
  // NULL / empty / unknown → next_payout (legacy rows + safe default)
  return (method ?? '').trim().toLowerCase() !== 'direct_payment'
}

export function isDirectPaymentSettlement(method: string | null | undefined): boolean {
  return (method ?? '').trim().toLowerCase() === 'direct_payment'
}

export function formatRecoverySettlementLabel(method: string | null | undefined): string {
  if (isDirectPaymentSettlement(method)) return 'Direct payment'
  return 'Next payout'
}

export function normalizeRecoveryStatus(value: string | null | undefined): RecoveryStatus | string {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'open' || v === 'applied' || v === 'voided') return v
  return v || 'open'
}

export function formatRecoveryStatusLabel(status: string | null | undefined): string {
  const v = normalizeRecoveryStatus(status)
  if (v === 'open') return 'Open'
  if (v === 'applied') return 'Recovered / Settled'
  if (v === 'voided') return 'Voided'
  return formatLabel(String(v))
}

/** Business-facing recovery outcome using balances (OPEN / PARTIALLY RECOVERED / RECOVERED). */
export function formatRecoveryOutcomeLabel(row: {
  status?: string | null
  applied_amount?: number | null
  remaining_amount?: number | null
  voided_at?: string | null
}): string {
  if (row.voided_at || normalizeRecoveryStatus(row.status) === 'voided') return 'Voided'
  if (normalizeRecoveryStatus(row.status) === 'applied' || toNumber(row.remaining_amount) <= 0) {
    return 'Recovered / Settled'
  }
  if (toNumber(row.applied_amount) > 0) return 'Partially Recovered'
  return 'Open'
}

/**
 * Producer-level open recovery balance (sum remaining_amount).
 * Default scope: next_payout only (amounts that reduce future payouts).
 * Pass settlement: 'direct_payment' | 'all' for other KPIs.
 */
export function sumOpenRecoveryRemaining(
  rows: Array<{
    producer?: string | null
    status?: string | null
    remaining_amount?: number | string | null
    settlement_method?: string | null
  }>,
  producer: string,
  settlement: 'next_payout' | 'direct_payment' | 'all' = 'next_payout',
): number {
  const key = producer.trim()
  let sum = 0
  for (const row of rows) {
    if ((row.producer ?? '').trim() !== key) continue
    if (normalizeRecoveryStatus(row.status) !== 'open') continue
    if (settlement === 'next_payout' && !isPayoutAppliedSettlement(row.settlement_method)) continue
    if (settlement === 'direct_payment' && !isDirectPaymentSettlement(row.settlement_method)) continue
    sum += toNumber(row.remaining_amount)
  }
  return Math.max(0, sum)
}

/** Net producer payment after applying open recoveries to gross (never negative). */
export function netAfterRecoveries(gross: number, openRecoveries: number): number {
  return Math.max(0, toNumber(gross) - Math.max(0, toNumber(openRecoveries)))
}

/** Absolute negative producer commission that can be recovered for a transaction. */
export function transactionRecoveryObligation(producerCommissionAmount: number): number {
  const amount = toNumber(producerCommissionAmount)
  return amount < 0 ? Math.abs(amount) : 0
}

/** Sum of non-voided recovery amounts already created against a transaction. */
export function sumCreatedRecoveryAmounts(
  recoveries: Array<{
    amount?: number | string | null
    status?: string | null
    voidedAt?: string | null
    voided_at?: string | null
  }>,
): number {
  let sum = 0
  for (const row of recoveries) {
    if (row.voidedAt || row.voided_at) continue
    if (normalizeRecoveryStatus(row.status) === 'voided') continue
    sum += toNumber(row.amount)
  }
  return Math.max(0, Math.round(sum * 100) / 100)
}

/**
 * Remaining amount that may still be recorded as a new recovery for a negative
 * producer-commission transaction. Positive-commission transactions are uncapped here
 * (existing open-duplicate / business rules still apply).
 */
export function availableRecoveryAmount(
  producerCommissionAmount: number,
  recoveries: Array<{
    amount?: number | string | null
    status?: string | null
    voidedAt?: string | null
    voided_at?: string | null
  }>,
): number {
  const obligation = transactionRecoveryObligation(producerCommissionAmount)
  if (obligation <= 0) return 0
  const created = sumCreatedRecoveryAmounts(recoveries)
  return Math.max(0, Math.round((obligation - created) * 100) / 100)
}

export function formatTransactionRecoverySettledLabel(
  producerCommissionAmount: number,
  recoveries: Array<{
    amount?: number | string | null
    status?: string | null
    voidedAt?: string | null
    voided_at?: string | null
  }>,
): string | null {
  const obligation = transactionRecoveryObligation(producerCommissionAmount)
  if (obligation <= 0) return null
  const created = sumCreatedRecoveryAmounts(recoveries)
  if (created <= 0) return null
  if (created + 0.009 >= obligation) {
    return `Recovered / Settled — ${formatCurrency(obligation)} of ${formatCurrency(obligation)}`
  }
  return `Partially recovered — ${formatCurrency(created)} of ${formatCurrency(obligation)}`
}

async function currentAppUserId(): Promise<string | null> {
  const { data: authData } = await supabase.auth.getUser()
  const authUserId = authData.user?.id
  if (!authUserId) return null
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .is('archived_at', null)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${toNumber(value).toFixed(2)}%`
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const day = dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr
  const date = new Date(`${day}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatLabel(value: string | null | undefined): string {
  if (!value) return '—'
  if (value === 'not_ready') return 'Not Ready'
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatTypeLabel(type: string): string {
  if (typeLabels[type]) return typeLabels[type]
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Frontend/DB-friendly premium sign rules by transaction type.
 * Returns null when valid; otherwise a user-facing error message.
 */
export function validateTransactionPremiumAmount(
  type: string,
  amount: number,
): string | null {
  if (!Number.isFinite(amount)) return 'Enter a valid transaction amount.'
  if (amount === 0) {
    if (type === 'audit_premium') {
      return 'Audit premium may be positive or negative, but cannot be zero.'
    }
    if (type === 'endorsement_premium') {
      return 'Endorsement premium may be positive or negative, but cannot be zero.'
    }
    return 'Transaction amount cannot be zero.'
  }
  if (type === 'new_policy_premium' && !(amount > 0)) {
    return 'New Business premium must be positive.'
  }
  if (type === 'renewal_premium' && !(amount > 0)) {
    return 'Renewal premium must be positive.'
  }
  if (type === 'cancellation_premium' && !(amount < 0)) {
    return 'Cancellation premium must be negative.'
  }
  if (type === 'return_premium' && !(amount < 0)) {
    return 'Return Premium (legacy) must be negative.'
  }
  if (
    type !== 'new_policy_premium' &&
    type !== 'renewal_premium' &&
    type !== 'endorsement_premium' &&
    type !== 'audit_premium' &&
    type !== 'cancellation_premium' &&
    type !== 'return_premium' &&
    amount < 0
  ) {
    return 'This transaction type does not allow a negative amount.'
  }
  return null
}

/** Normalize UI entry to signed premium (cancellation / legacy return may enter absolute). */
export function normalizePremiumAmountForType(type: string, rawAmount: number): number {
  if (!Number.isFinite(rawAmount)) return rawAmount
  if (type === 'cancellation_premium' || type === 'return_premium') {
    return -Math.abs(rawAmount)
  }
  return rawAmount
}

/** Operational "Pending" KPI: not paid, not voided, not archived. */
export function isOperationallyPendingTransaction(tx: {
  archived: boolean
  voidedAt?: string | null
  producerPaymentStatus: string
  paidDate: string | null
}): boolean {
  if (tx.archived) return false
  if (tx.voidedAt) return false
  if (tx.producerPaymentStatus === 'paid' || Boolean(tx.paidDate)) return false
  return true
}

export function badgeClass(status: string | null | undefined): string {
  if (!status) return 'bg-slate-100 text-slate-600 ring-slate-500/20'
  return statusBadgeStyles[status.toLowerCase()] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
}

export function todayIsoDate(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export function normalizePaymentStatus(value: string | null | undefined): ProducerPaymentStatus {
  const v = (value ?? 'not_ready').toLowerCase()
  if (v === 'ready' || v === 'paid' || v === 'not_ready') return v
  return 'not_ready'
}

export function normalizeReviewStatus(value: string | null | undefined): ReviewStatus {
  const v = (value ?? 'expected').toLowerCase()
  if (v === 'matched' || v === 'approved' || v === 'expected') return v
  return 'expected'
}

export const TRANSACTION_COMMISSION_SELECT = `
  id,
  transaction_number,
  transaction_type,
  transaction_date,
  status,
  description,
  notes,
  remarks,
  client_id,
  policy_id,
  producer,
  csr,
  carrier,
  mga,
  amount,
  premium_amount,
  carrier_commission_percentage,
  commission_type,
  agency_commission_percentage,
  agency_commission_amount,
  broker_fee,
  expected_amount,
  amount_received,
  received_date,
  agency_commission_confirmed,
  agency_commission_receipt_id,
  producer_split_percentage,
  producer_commission_amount,
  agency_net_commission,
  producer_payment_status,
  payment_batch_id,
  scheduled_payment_date,
  paid_amount,
  paid_date,
  payment_method,
  payment_reference,
  review_status,
  reviewer_user_id,
  review_return_reason,
  review_returned_at,
  review_returned_by,
  reviewed_by,
  reviewed_date,
  original_transaction_id,
  voided_at,
  voided_by,
  void_reason,
  producer_split_source,
  transaction_effective_date,
  transaction_expiration_date,
  csr_user_id,
  archived_at,
  created_at,
  clients (
    business_name,
    client_number
  ),
  policies (
    policy_number,
    policy_type,
    effective_date,
    expiration_date
  ),
  producer_payment_batches (
    id,
    batch_number,
    status
  ),
  reviewer:users!reviewer_user_id (
    id,
    full_name,
    email,
    role
  ),
  returned_by_user:users!review_returned_by (
    id,
    full_name,
    email,
    role
  )
`

export interface TransactionCommissionRow {
  id: string
  transaction_number: string | null
  transaction_type: string
  transaction_date: string
  status: string | null
  description: string | null
  notes: string | null
  remarks: string | null
  client_id: string | null
  policy_id: string | null
  producer: string | null
  csr: string | null
  carrier: string | null
  mga: string | null
  amount: number | string | null
  premium_amount: number | string | null
  carrier_commission_percentage: number | string | null
  commission_type: string | null
  agency_commission_percentage: number | string | null
  agency_commission_amount: number | string | null
  broker_fee: number | string | null
  expected_amount: number | string | null
  amount_received: number | string | null
  received_date: string | null
  agency_commission_confirmed: boolean | null
  agency_commission_receipt_id: string | null
  producer_split_percentage: number | string | null
  producer_commission_amount: number | string | null
  agency_net_commission: number | string | null
  producer_payment_status: string | null
  payment_batch_id: string | null
  scheduled_payment_date: string | null
  paid_amount: number | string | null
  paid_date: string | null
  payment_method: string | null
  payment_reference: string | null
  review_status: string | null
  reviewer_user_id: string | null
  review_return_reason: string | null
  review_returned_at: string | null
  review_returned_by: string | null
  csr_user_id?: string | null
  reviewed_by: string | null
  reviewed_date: string | null
  original_transaction_id: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  producer_split_source: string | null
  transaction_effective_date: string | null
  transaction_expiration_date: string | null
  archived_at: string | null
  created_at?: string | null
  clients:
    | { business_name: string | null; client_number: string | null }
    | { business_name: string | null; client_number: string | null }[]
    | null
  policies:
    | {
        policy_number: string | null
        policy_type: string | null
        effective_date: string | null
        expiration_date: string | null
      }
    | {
        policy_number: string | null
        policy_type: string | null
        effective_date: string | null
        expiration_date: string | null
      }[]
    | null
  producer_payment_batches:
    | { id: string; batch_number: string | null; status: string | null }
    | { id: string; batch_number: string | null; status: string | null }[]
    | null
  reviewer:
    | { id: string; full_name: string | null; email: string | null; role: string | null }
    | { id: string; full_name: string | null; email: string | null; role: string | null }[]
    | null
  returned_by_user:
    | { id: string; full_name: string | null; email: string | null; role: string | null }
    | { id: string; full_name: string | null; email: string | null; role: string | null }[]
    | null
}

export interface CommissionTransaction {
  id: string
  transactionNumber: string
  type: string
  transactionDate: string
  status: string
  description: string
  notes: string
  remarks: string
  clientId: string
  clientName: string
  clientNumber: string
  policyId: string
  policyNumber: string
  policyType: string
  policyEffectiveDate: string
  policyExpirationDate: string
  transactionEffectiveDate: string
  transactionExpirationDate: string
  producer: string
  csr: string
  /** Stable CSR assignee (public.users.id) when known. */
  csrUserId: string | null
  carrier: string
  mga: string
  amount: number
  premiumAmount: number
  carrierCommissionPercentage: number | null
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  commissionPool: number
  expectedAmount: number
  amountReceived: number | null
  receivedDate: string | null
  agencyCommissionConfirmed: boolean
  agencyCommissionReceiptId: string | null
  producerSplitPercentage: number | null
  producerCommissionAmount: number
  agencyNetCommission: number
  producerPaymentStatus: ProducerPaymentStatus
  paymentBatchId: string | null
  paymentBatchNumber: string
  paymentBatchStatus: string
  scheduledPaymentDate: string | null
  paidAmount: number | null
  paidDate: string | null
  paymentMethod: string
  paymentReference: string
  reviewStatus: ReviewStatus
  reviewerUserId: string | null
  reviewerName: string
  reviewerRole: string
  reviewerEmail: string
  reviewReturnReason: string
  reviewReturnedAt: string | null
  reviewReturnedBy: string | null
  reviewReturnedByName: string
  reviewedBy: string | null
  reviewedDate: string | null
  originalTransactionId: string | null
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string
  producerSplitSource: 'producer_default' | 'policy_override' | 'transaction_override' | null
  archived: boolean
}

export function mapCommissionTransaction(row: TransactionCommissionRow): CommissionTransaction {
  const client = firstEmbed(row.clients)
  const policy = firstEmbed(row.policies)
  const batch = firstEmbed(row.producer_payment_batches)
  const reviewer = firstEmbed(row.reviewer)
  const returnedBy = firstEmbed(row.returned_by_user)
  const amountReceivedRaw = row.amount_received

  return {
    id: row.id,
    transactionNumber: row.transaction_number ?? '',
    type: row.transaction_type,
    transactionDate: row.transaction_date,
    status: (row.status ?? 'pending').toLowerCase(),
    description: row.description?.trim() || '',
    notes: row.notes?.trim() || '',
    remarks: row.remarks?.trim() || '',
    clientId: row.client_id ?? '',
    clientName: client?.business_name?.trim() || 'Unknown client',
    clientNumber: client?.client_number?.trim() || '',
    policyId: row.policy_id ?? '',
    policyNumber: policy?.policy_number?.trim() || '—',
    policyType: policy?.policy_type?.trim() || '—',
    policyEffectiveDate: policy?.effective_date?.trim() || '',
    policyExpirationDate: policy?.expiration_date?.trim() || '',
    transactionEffectiveDate: row.transaction_effective_date?.trim() || '',
    transactionExpirationDate: row.transaction_expiration_date?.trim() || '',
    producer: row.producer?.trim() || '—',
    csr: row.csr?.trim() || '—',
    csrUserId: row.csr_user_id?.trim() || null,
    carrier: row.carrier?.trim() || '—',
    mga: row.mga?.trim() || '—',
    amount: toNumber(row.amount),
    premiumAmount: toNumber(row.premium_amount ?? row.amount),
    carrierCommissionPercentage:
      row.carrier_commission_percentage === null || row.carrier_commission_percentage === undefined
        ? null
        : toNumber(row.carrier_commission_percentage),
    commissionType: normalizeCommissionType(row.commission_type),
    agencyCommissionPercentage:
      row.agency_commission_percentage === null || row.agency_commission_percentage === undefined
        ? null
        : toNumber(row.agency_commission_percentage),
    agencyCommissionAmount: toNumber(row.agency_commission_amount),
    brokerFee: toNumber(row.broker_fee),
    commissionPool: roundMoney(toNumber(row.agency_commission_amount) + toNumber(row.broker_fee)),
    expectedAmount: toNumber(row.expected_amount ?? row.agency_commission_amount),
    amountReceived:
      amountReceivedRaw === null || amountReceivedRaw === undefined
        ? null
        : toNumber(amountReceivedRaw),
    receivedDate: row.received_date,
    agencyCommissionConfirmed: Boolean(row.agency_commission_confirmed),
    agencyCommissionReceiptId: row.agency_commission_receipt_id,
    producerSplitPercentage:
      row.producer_split_percentage === null || row.producer_split_percentage === undefined
        ? null
        : toNumber(row.producer_split_percentage),
    producerCommissionAmount: toNumber(row.producer_commission_amount),
    agencyNetCommission: toNumber(row.agency_net_commission),
    producerPaymentStatus: normalizePaymentStatus(row.producer_payment_status),
    paymentBatchId: row.payment_batch_id,
    paymentBatchNumber: batch?.batch_number?.trim() || '',
    paymentBatchStatus: (batch?.status ?? '').toLowerCase(),
    scheduledPaymentDate: row.scheduled_payment_date,
    paidAmount:
      row.paid_amount === null || row.paid_amount === undefined ? null : toNumber(row.paid_amount),
    paidDate: row.paid_date,
    paymentMethod: row.payment_method?.trim() || '',
    paymentReference: row.payment_reference?.trim() || '',
    reviewStatus: normalizeReviewStatus(row.review_status),
    reviewerUserId: row.reviewer_user_id,
    reviewerName: reviewer?.full_name?.trim() || '—',
    reviewerRole: (reviewer?.role ?? '').trim().toLowerCase(),
    reviewerEmail: reviewer?.email?.trim() || '',
    reviewReturnReason: row.review_return_reason?.trim() || '',
    reviewReturnedAt: row.review_returned_at,
    reviewReturnedBy: row.review_returned_by,
    reviewReturnedByName: returnedBy?.full_name?.trim() || '—',
    reviewedBy: row.reviewed_by,
    reviewedDate: row.reviewed_date,
    originalTransactionId: row.original_transaction_id,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason?.trim() || '',
    producerSplitSource:
      row.producer_split_source === 'producer_default' ||
      row.producer_split_source === 'policy_override' ||
      row.producer_split_source === 'transaction_override'
        ? row.producer_split_source
        : null,
    archived: Boolean(row.archived_at),
  }
}

export async function fetchCommissionTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_COMMISSION_SELECT)
    .is('archived_at', null)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return { data: [] as CommissionTransaction[], error }
  const rows = (data ?? []) as unknown as TransactionCommissionRow[]
  return { data: rows.map(mapCommissionTransaction), error: null }
}

/** Live related transactions for one policy (UUID join on transactions.policy_id). */
export async function fetchCommissionTransactionsByPolicy(policyId: string) {
  if (!policyId) return { data: [] as CommissionTransaction[], error: null }
  const { data, error } = await supabase
    .from('transactions')
    .select(TRANSACTION_COMMISSION_SELECT)
    .eq('policy_id', policyId)
    .is('archived_at', null)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return { data: [] as CommissionTransaction[], error }
  const rows = (data ?? []) as unknown as TransactionCommissionRow[]
  return { data: rows.map(mapCommissionTransaction), error: null }
}

export interface PolicyTransactionSummary {
  policyId: string
  transactionCount: number
  /** SUM(transactions.amount) — signed premium movement; return premiums reduce total. */
  totalPremium: number
  /** @deprecated Prefer totalPremium — same value (historical alias). */
  totalVolume: number
  latestTransactionDate: string | null
}

/** Aggregate live transaction counts/premium per policy UUID (no denormalization). */
export async function fetchPolicyTransactionSummaries(policyIds: string[]) {
  const ids = [...new Set(policyIds.filter(Boolean))]
  const empty = {
    data: {} as Record<string, PolicyTransactionSummary>,
    error: null as { message: string } | null,
  }
  if (ids.length === 0) return empty

  const { data, error } = await supabase
    .from('transactions')
    .select('id, policy_id, amount, transaction_date')
    .in('policy_id', ids)
    .is('archived_at', null)

  if (error) return { data: {} as Record<string, PolicyTransactionSummary>, error }

  const summaries: Record<string, PolicyTransactionSummary> = {}
  for (const id of ids) {
    summaries[id] = {
      policyId: id,
      transactionCount: 0,
      totalPremium: 0,
      totalVolume: 0,
      latestTransactionDate: null,
    }
  }

  for (const row of data ?? []) {
    const policyId = String(row.policy_id ?? '')
    if (!policyId || !summaries[policyId]) continue
    const summary = summaries[policyId]
    summary.transactionCount += 1
    const amount = toNumber(row.amount as number | string | null)
    summary.totalPremium += amount
    summary.totalVolume += amount
    const date = String(row.transaction_date ?? '').trim()
    if (date && (!summary.latestTransactionDate || date > summary.latestTransactionDate)) {
      summary.latestTransactionDate = date
    }
  }

  return { data: summaries, error: null }
}

function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

export interface DeriveCommissionInput {
  commissionType: CommissionType
  /** Policy premium or signed transaction amount. */
  baseAmount: number
  /** Required when commissionType === 'percentage'. */
  agencyCommissionPercentage: number | null
  /** Required when commissionType === 'flat' (entered flat agency commission). */
  agencyCommissionAmount: number | null
  brokerFee: number
  producerSplitPercentage: number
}

export interface DerivedCommission {
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  commissionPool: number
  producerSplitPercentage: number
  producerCommissionAmount: number
  agencyNetCommission: number
}

/**
 * Locked product math:
 * percentage → agency = base × % / 100
 * flat → agency = entered flat amount
 * pool = agency + broker_fee
 * producer = pool × split% / 100
 * agency_net = pool − producer
 *
 * Broker fee is explicit (may be 0 / + / −). Never auto-reversed for return_premium.
 */
export function deriveCommission(input: DeriveCommissionInput): DerivedCommission {
  const commissionType = normalizeCommissionType(input.commissionType)
  const split = Number(input.producerSplitPercentage)
  const brokerFee = roundMoney(Number(input.brokerFee) || 0)

  let agencyCommissionPercentage: number | null = null
  let agencyCommissionAmount = 0

  if (commissionType === 'percentage') {
    const pct = Number(input.agencyCommissionPercentage)
    agencyCommissionPercentage = Number.isFinite(pct) ? pct : 0
    agencyCommissionAmount = roundMoney((Number(input.baseAmount) * agencyCommissionPercentage) / 100)
  } else {
    agencyCommissionPercentage = null
    agencyCommissionAmount = roundMoney(Number(input.agencyCommissionAmount) || 0)
  }

  const commissionPool = roundMoney(agencyCommissionAmount + brokerFee)
  const producerCommissionAmount = roundMoney((commissionPool * (Number.isFinite(split) ? split : 0)) / 100)
  const agencyNetCommission = roundMoney(commissionPool - producerCommissionAmount)

  return {
    commissionType,
    agencyCommissionPercentage,
    agencyCommissionAmount,
    brokerFee,
    commissionPool,
    producerSplitPercentage: Number.isFinite(split) ? split : 0,
    producerCommissionAmount,
    agencyNetCommission,
  }
}

/** @deprecated Prefer deriveCommission — kept for call-site compatibility during migration. */
export function deriveTransactionCommission(
  premiumAmount: number,
  agencyCommissionPercentage: number,
  producerSplitPercentage: number,
  brokerFee = 0,
  commissionType: CommissionType = 'percentage',
  flatAgencyAmount: number | null = null,
) {
  return deriveCommission({
    commissionType,
    baseAmount: premiumAmount,
    agencyCommissionPercentage:
      commissionType === 'percentage' ? agencyCommissionPercentage : null,
    agencyCommissionAmount: commissionType === 'flat' ? flatAgencyAmount : null,
    brokerFee,
    producerSplitPercentage,
  })
}

export interface CreateTransactionInput {
  clientId: string
  policyId: string
  transactionDate: string
  transactionType: TransactionType
  description: string
  notes: string
  remarks: string
  producer: string
  csr: string
  carrier: string
  mga: string
  /** Signed premium / transaction amount (negative for return_premium per live data). */
  premiumAmount: number
  commissionType: CommissionType
  /** Percentage basis only. */
  agencyCommissionPercentage: number | null
  /** Flat basis: entered agency commission amount. Percentage basis: ignored (derived). */
  agencyCommissionAmount: number | null
  brokerFee: number
  producerSplitPercentage: number
  /** Assigned Owner/Admin reviewer (public.users.id). */
  reviewerUserId?: string | null
  /** Return Premium link to original positive premium transaction. */
  originalTransactionId?: string | null
  /** Snapshot source for producer split. */
  producerSplitSource?: 'producer_default' | 'policy_override' | 'transaction_override' | null
  /** Transaction-level date snapshot (defaults from policy when omitted). */
  transactionEffectiveDate?: string | null
  transactionExpirationDate?: string | null
}

/**
 * Creates a transaction.
 * Transaction number is assigned by the database BEFORE INSERT trigger
 * (transactions_set_number → set_transaction_number_if_missing).
 * Do not call next_transaction_number() from the frontend.
 */
export async function createTransaction(input: CreateTransactionInput) {
  const authz = await rejectUnlessRole(canManageTransactions)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
    }
  }
  if (!input.clientId.trim()) {
    return {
      error: { message: 'Client is required.', table: 'transactions', operation: 'validate' },
    }
  }
  if (!input.policyId.trim()) {
    return {
      error: { message: 'Policy is required.', table: 'transactions', operation: 'validate' },
    }
  }
  if (!input.transactionDate.trim()) {
    return {
      error: { message: 'Transaction date is required.', table: 'transactions', operation: 'validate' },
    }
  }
  if (!TRANSACTION_TYPES.includes(input.transactionType)) {
    return {
      error: { message: 'Invalid transaction type.', table: 'transactions', operation: 'validate' },
    }
  }
  if (!Number.isFinite(input.premiumAmount)) {
    return {
      error: { message: 'Enter a valid premium / transaction amount.', table: 'transactions', operation: 'validate' },
    }
  }

  let premiumAmount = normalizePremiumAmountForType(input.transactionType, input.premiumAmount)
  const signError = validateTransactionPremiumAmount(input.transactionType, premiumAmount)
  if (signError) {
    return {
      error: { message: signError, table: 'transactions', operation: 'validate' },
    }
  }

  // original_transaction_id is optional (not required for Audit/Endorsement/Cancellation/negatives).
  if (input.originalTransactionId?.trim()) {
    const { data: original, error: originalError } = await supabase
      .from('transactions')
      .select('id, transaction_type, client_id, policy_id, archived_at, voided_at')
      .eq('id', input.originalTransactionId.trim())
      .maybeSingle()
    if (originalError) {
      return {
        error: {
          message: originalError.message,
          table: 'transactions',
          operation: 'original_lookup',
          details: originalError,
        },
      }
    }
    if (!original || original.archived_at || original.voided_at) {
      return {
        error: {
          message: 'Related transaction was not found or is archived/voided.',
          table: 'transactions',
          operation: 'validate',
        },
      }
    }
    if (
      original.client_id !== input.clientId.trim() ||
      original.policy_id !== input.policyId.trim()
    ) {
      return {
        error: {
          message: 'Related transaction must belong to the same client and policy.',
          table: 'transactions',
          operation: 'validate',
        },
      }
    }
  }

  const commissionType = normalizeCommissionType(input.commissionType)
  if (commissionType === 'percentage') {
    if (
      input.agencyCommissionPercentage === null ||
      !Number.isFinite(input.agencyCommissionPercentage) ||
      input.agencyCommissionPercentage < 0
    ) {
      return {
        error: {
          message: 'Agency commission % must be zero or greater.',
          table: 'transactions',
          operation: 'validate',
        },
      }
    }
  } else if (input.agencyCommissionAmount === null || !Number.isFinite(input.agencyCommissionAmount)) {
    return {
      error: {
        message: 'Enter a valid flat agency commission amount.',
        table: 'transactions',
        operation: 'validate',
      },
    }
  }

  if (!Number.isFinite(input.brokerFee)) {
    return {
      error: { message: 'Enter a valid broker fee (0, positive, or negative).', table: 'transactions', operation: 'validate' },
    }
  }
  if (!Number.isFinite(input.producerSplitPercentage) || input.producerSplitPercentage < 0) {
    return {
      error: {
        message: 'Producer split % must be zero or greater.',
        table: 'transactions',
        operation: 'validate',
      },
    }
  }

  const derived = deriveCommission({
    commissionType,
    baseAmount: premiumAmount,
    agencyCommissionPercentage: input.agencyCommissionPercentage,
    agencyCommissionAmount: input.agencyCommissionAmount,
    brokerFee: input.brokerFee,
    producerSplitPercentage: input.producerSplitPercentage,
  })

  const csrName = input.csr.trim()
  const csrUserId = csrName ? await resolveCsrUserIdByName(csrName) : null

  const payload = {
    client_id: input.clientId.trim(),
    policy_id: input.policyId.trim(),
    transaction_date: input.transactionDate.trim(),
    transaction_type: input.transactionType,
    description: input.description.trim() || null,
    notes: input.notes.trim() || null,
    remarks: input.remarks.trim() || null,
    producer: input.producer.trim() || null,
    csr: csrName || null,
    csr_user_id: csrUserId,
    carrier: input.carrier.trim() || null,
    mga: input.mga.trim() || null,
    amount: premiumAmount,
    premium_amount: premiumAmount,
    commission_type: derived.commissionType,
    // Legacy alias: only mirror percentage basis; flat does not invent a %.
    carrier_commission_percentage:
      derived.commissionType === 'percentage' ? derived.agencyCommissionPercentage : null,
    agency_commission_percentage: derived.agencyCommissionPercentage,
    agency_commission_amount: derived.agencyCommissionAmount,
    broker_fee: derived.brokerFee,
    producer_split_percentage: derived.producerSplitPercentage,
    producer_commission_amount: derived.producerCommissionAmount,
    agency_net_commission: derived.agencyNetCommission,
    expected_amount: derived.agencyCommissionAmount,
    status: 'pending',
    review_status: 'expected',
    producer_payment_status: 'not_ready',
    agency_commission_confirmed: false,
    amount_received: null,
    received_date: null,
    agency_commission_receipt_id: null,
    payment_batch_id: null,
    paid_amount: null,
    paid_date: null,
    archived_at: null,
    reviewer_user_id: input.reviewerUserId?.trim() || null,
    review_return_reason: null,
    review_returned_at: null,
    review_returned_by: null,
    original_transaction_id: input.originalTransactionId?.trim() || null,
    producer_split_source: input.producerSplitSource ?? null,
    transaction_effective_date: input.transactionEffectiveDate?.trim() || null,
    transaction_expiration_date: input.transactionExpirationDate?.trim() || null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert(payload)
    .select('id, transaction_number')
    .single()

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'insert',
        details: error,
      },
    }
  }

  await recordActivity({
    action: 'transaction_create',
    entityType: 'transaction',
    entityId: data.id as string,
    recordReference: String(data.transaction_number ?? ''),
    clientId: input.clientId.trim(),
    policyId: input.policyId.trim(),
    transactionId: data.id as string,
    newValue: {
      type: input.transactionType,
      amount: premiumAmount,
      producer: input.producer,
      producerSplitPercentage: derived.producerSplitPercentage,
      producerSplitSource: input.producerSplitSource ?? null,
      originalTransactionId: payload.original_transaction_id,
    },
  })

  return {
    data: { id: data.id as string, transactionNumber: data.transaction_number as string },
    error: null,
  }
}

export function formatProducerSplitSourceLabel(
  source: string | null | undefined,
  splitPercentage: number | null | undefined,
): string {
  const pct =
    splitPercentage === null || splitPercentage === undefined || Number.isNaN(Number(splitPercentage))
      ? '—'
      : `${Number(splitPercentage).toFixed(2)}%`
  if (source === 'producer_default') return `${pct} — Producer Default`
  if (source === 'policy_override') return `${pct} — Policy Override`
  if (source === 'transaction_override') return `${pct} — Transaction Override`
  return pct
}

export function canVoidTransaction(tx: CommissionTransaction, recoveryCount: number): boolean {
  if (tx.archived || tx.voidedAt) return false
  if (tx.producerPaymentStatus === 'paid' || tx.paidDate) return false
  if (tx.paymentBatchId) return false
  if (recoveryCount > 0) return false
  // Financially progressed but reversible via VOID (not hard delete)
  return (
    tx.agencyCommissionConfirmed ||
    tx.reviewStatus === 'matched' ||
    tx.reviewStatus === 'approved' ||
    tx.producerPaymentStatus === 'ready'
  )
}

export function canHardArchiveTransaction(
  tx: CommissionTransaction,
  recoveryCount: number,
): boolean {
  return canArchiveTransaction(tx, recoveryCount) && !tx.voidedAt
}

/** VOID a financially progressed (but not paid/batched/recovery-linked) transaction. */
export async function voidTransaction(transactionId: string, reason: string) {
  const authz = await rejectUnlessRole(canApproveTransactions)
  if (!authz.ok) {
    return { error: { message: authz.message, table: 'transactions', operation: 'authorize' } }
  }
  const trimmed = reason.trim()
  if (!trimmed) {
    return {
      error: {
        message: 'Void reason is required.',
        table: 'transactions',
        operation: 'void_validation',
      },
    }
  }

  const actorId = authz.profileId ?? (await currentAppUserId())
  const { data: row, error: fetchError } = await supabase
    .from('transactions')
    .select(
      `
      id, transaction_number, producer_payment_status, payment_batch_id, paid_date,
      archived_at, voided_at, agency_commission_confirmed, review_status, client_id, policy_id
    `,
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'transactions',
        operation: 'void_fetch',
        details: fetchError,
      },
    }
  }
  if (!row || row.archived_at || row.voided_at) {
    return {
      error: {
        message: 'Transaction not found or already archived/voided.',
        table: 'transactions',
        operation: 'void_validation',
      },
    }
  }
  if (row.payment_batch_id || row.paid_date || row.producer_payment_status === 'paid') {
    return {
      error: {
        message:
          'Cannot void a paid or batched transaction. Create a Return Premium / Recovery instead to preserve ledger integrity.',
        table: 'transactions',
        operation: 'void_validation',
      },
    }
  }

  const { count: recoveryCount } = await supabase
    .from('producer_commission_recoveries')
    .select('id', { count: 'exact', head: true })
    .eq('transaction_id', transactionId)
    .is('voided_at', null)

  if ((recoveryCount ?? 0) > 0) {
    return {
      error: {
        message:
          'Cannot void a transaction linked to recoveries. Settle or void recoveries first, or use a reversal transaction.',
        table: 'transactions',
        operation: 'void_validation',
      },
    }
  }

  const voidedAt = new Date().toISOString()
  const { data: updated, error } = await supabase
    .from('transactions')
    .update({
      voided_at: voidedAt,
      voided_by: actorId,
      void_reason: trimmed,
      producer_payment_status: 'not_ready',
    })
    .eq('id', transactionId)
    .is('voided_at', null)
    .is('payment_batch_id', null)
    .is('paid_date', null)
    .select('id, transaction_number')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'void_update',
        details: error,
      },
    }
  }
  if (!updated?.length) {
    return {
      error: {
        message: 'Void did not update any row.',
        table: 'transactions',
        operation: 'void_validation',
      },
    }
  }

  await recordActivity({
    action: 'transaction_void',
    entityType: 'transaction',
    entityId: transactionId,
    recordReference: String(updated[0].transaction_number ?? ''),
    clientId: row.client_id as string | null,
    policyId: row.policy_id as string | null,
    transactionId,
    oldValue: { voided: false },
    newValue: { voided: true, reason: trimmed, voidedAt },
  })

  return { data: { id: updated[0].id as string }, error: null }
}

export function isAssignableProducer(producer: string | null | undefined): boolean {
  const value = (producer ?? '').trim()
  return value !== '' && value !== '—'
}

export function canMarkProducerCommissionReady(tx: CommissionTransaction): boolean {
  return (
    !tx.voidedAt &&
    tx.agencyCommissionConfirmed &&
    tx.reviewStatus === 'approved' &&
    isAssignableProducer(tx.producer) &&
    tx.producerCommissionAmount > 0 &&
    tx.producerPaymentStatus === 'not_ready' &&
    !tx.paymentBatchId &&
    !tx.archived &&
    !tx.paidDate
  )
}

/** Explain why Mark Ready is hidden for an otherwise approved transaction. */
export function markReadyBlockedReason(tx: CommissionTransaction): string | null {
  if (tx.voidedAt) return 'Voided transactions cannot be marked ready for payout.'
  if (tx.archived) return 'Archived transactions cannot be marked ready for payout.'
  if (!tx.agencyCommissionConfirmed) return 'Confirm agency commission receipt before Mark Ready.'
  if (tx.reviewStatus !== 'approved') return 'Approve the transaction before Mark Ready for Payout.'
  if (!isAssignableProducer(tx.producer)) return 'Assign an active producer before Mark Ready.'
  if (!(tx.producerCommissionAmount > 0)) {
    return `Producer commission is ${formatCurrency(tx.producerCommissionAmount)}. Mark Ready requires a positive producer commission (batch payouts exclude $0 / negative).`
  }
  if (tx.producerPaymentStatus === 'ready') return null
  if (tx.producerPaymentStatus === 'paid' || tx.paidDate) return 'This transaction is already paid.'
  if (tx.paymentBatchId) return 'This transaction is already in a payment batch.'
  if (tx.producerPaymentStatus !== 'not_ready') {
    return `Producer payment status is ${formatLabel(tx.producerPaymentStatus)}.`
  }
  return null
}

export function isReadyForPayout(tx: CommissionTransaction): boolean {
  return (
    tx.agencyCommissionConfirmed &&
    tx.reviewStatus === 'approved' &&
    isAssignableProducer(tx.producer) &&
    tx.producerCommissionAmount > 0 &&
    tx.producerPaymentStatus === 'ready' &&
    !tx.paymentBatchId &&
    !tx.archived &&
    !tx.paidDate
  )
}

/**
 * Who may correct a Returned-for-Correction transaction.
 * Owner/Admin: agency-wide. CSR: assignment-scoped (csr_user_id preferred).
 */
export function canCorrectReturnedTransaction(
  tx: {
    agencyCommissionConfirmed: boolean
    reviewStatus: string
    reviewReturnedAt: string | null
    reviewReturnReason: string
    csrUserId?: string | null
    csr?: string | null
    archived?: boolean
    voidedAt?: string | null
    producerPaymentStatus?: string
    paymentBatchId?: string | null
    paidDate?: string | null
  },
  role: RoleInput,
  profile?: { id?: string | null; fullName?: string | null; email?: string | null } | null,
): boolean {
  if (!isCorrectionRequired(tx)) return false
  if (tx.archived || tx.voidedAt) return false
  if (tx.producerPaymentStatus === 'paid' || tx.paidDate || tx.paymentBatchId) return false
  if (tx.producerPaymentStatus && tx.producerPaymentStatus !== 'not_ready') return false

  const roles = toAppRoles(role)
  if (roles.includes('owner') || roles.includes('admin')) return true
  if (!roles.includes('csr')) return false
  return csrAssignmentMatches({
    csrUserId: tx.csrUserId,
    csrName: tx.csr,
    profileId: profile?.id,
    profileFullName: profile?.fullName,
    profileEmail: profile?.email,
  })
}

/** Metadata/identity edit — never paid/batched/archived. */
export function canEditTransaction(tx: CommissionTransaction): boolean {
  return (
    !tx.archived &&
    !tx.voidedAt &&
    tx.producerPaymentStatus !== 'paid' &&
    !tx.paidDate &&
    !tx.paymentBatchId
  )
}

/**
 * Commission money edit — unlocked when:
 * - not paid/batched/archived, and
 * - either not yet receipt-confirmed, OR currently Returned for Correction
 *   (Owner/Admin or assigned CSR — receipt confirmation alone must not block).
 */
export function canEditTransactionCommission(
  tx: CommissionTransaction,
  role?: RoleInput,
  profile?: { id?: string | null; fullName?: string | null; email?: string | null } | null,
): boolean {
  if (!canEditTransaction(tx)) return false
  if (tx.producerPaymentStatus !== 'not_ready') return false
  if (isCorrectionRequired(tx)) {
    // When role/profile provided, enforce correction actor rule; otherwise allow
    // (drawer/open checks pass role; server re-validates returned state).
    if (role !== undefined) {
      return canCorrectReturnedTransaction(tx, role, profile)
    }
    return true
  }
  return !tx.agencyCommissionConfirmed && !tx.agencyCommissionReceiptId
}

export function isCorrectionRequired(tx: {
  agencyCommissionConfirmed: boolean
  reviewStatus: string
  reviewReturnedAt: string | null
  reviewReturnReason: string
}): boolean {
  return (
    tx.agencyCommissionConfirmed &&
    tx.reviewStatus === 'expected' &&
    (Boolean(tx.reviewReturnedAt) || Boolean(tx.reviewReturnReason?.trim()))
  )
}

/**
 * Approve review_status → approved (Owner/Admin only via permissions).
 * Requires CSR Submit for Review first (review_status = matched).
 * Does not mark ready/paid or touch commissions.
 */
export function canApproveTransactionReview(tx: CommissionTransaction): boolean {
  return (
    !tx.archived &&
    tx.producerPaymentStatus !== 'paid' &&
    !tx.paidDate &&
    !tx.paymentBatchId &&
    tx.agencyCommissionConfirmed &&
    tx.reviewStatus === 'matched' &&
    Boolean(tx.reviewerUserId?.trim())
  )
}

/**
 * CSR Submit for Review — maps to review_status = matched (existing enum).
 * Requires receipt confirmed, reviewer assigned, and required identity/commission fields.
 */
export function canSubmitTransactionForReview(tx: CommissionTransaction): boolean {
  const premiumOk = Number.isFinite(tx.premiumAmount) && tx.premiumAmount !== 0
  const amountOk = Number.isFinite(tx.amount) && tx.amount !== 0
  return (
    !tx.archived &&
    tx.agencyCommissionConfirmed &&
    tx.reviewStatus === 'expected' &&
    tx.producerPaymentStatus === 'not_ready' &&
    !tx.paymentBatchId &&
    !tx.paidDate &&
    Boolean(tx.reviewerUserId?.trim()) &&
    Boolean(tx.clientId?.trim()) &&
    Boolean(tx.policyId?.trim()) &&
    Boolean(tx.type?.trim()) &&
    (premiumOk || amountOk) &&
    isAssignableProducer(tx.producer) &&
    Number.isFinite(tx.agencyCommissionAmount) &&
    Number.isFinite(tx.producerCommissionAmount)
  )
}

/**
 * Return for Correction — Owner/Admin; back to expected so CSR can resubmit.
 * Supported without a new DB status.
 */
export function canReturnTransactionForCorrection(tx: CommissionTransaction): boolean {
  return (
    !tx.archived &&
    tx.agencyCommissionConfirmed &&
    (tx.reviewStatus === 'matched' || tx.reviewStatus === 'approved') &&
    tx.producerPaymentStatus === 'not_ready' &&
    !tx.paymentBatchId &&
    !tx.paidDate &&
    Boolean(tx.reviewerUserId?.trim())
  )
}

/**
 * Soft-archive only. Blocked once any financial footprint exists
 * (receipt, confirmed, ready, batched, paid, recoveries).
 */
export function canArchiveTransaction(
  tx: CommissionTransaction,
  recoveryCount: number,
): boolean {
  return (
    !tx.archived &&
    tx.producerPaymentStatus === 'not_ready' &&
    !tx.paidDate &&
    !tx.paymentBatchId &&
    !tx.agencyCommissionConfirmed &&
    !tx.agencyCommissionReceiptId &&
    recoveryCount === 0
  )
}

export interface EditTransactionMetadataInput {
  transactionId: string
  transactionDate: string
  description: string
  notes: string
  remarks: string
  type: string
  producer: string
  csr: string
  clientId: string
  policyId: string
  /** Assigned Owner/Admin reviewer (public.users.id). */
  reviewerUserId?: string | null
  /** When true and row is commission-editable, update snapshot commission fields. */
  unlockCommission?: boolean
  premiumAmount?: number
  commissionType?: CommissionType
  agencyCommissionPercentage?: number | null
  agencyCommissionAmount?: number | null
  brokerFee?: number
  producerSplitPercentage?: number
  transactionEffectiveDate?: string | null
  transactionExpirationDate?: string | null
}

/** Resolve a single active CSR-role user id from CSR TEXT (exact preferred). */
async function resolveCsrUserIdByName(csrName: string): Promise<string | null> {
  const name = csrName.trim()
  if (!name) return null
  const [usersRes, rolesRes] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role')
      .is('archived_at', null)
      .eq('status', 'active'),
    supabase.from('user_roles').select('user_id, role').eq('role', 'csr'),
  ])
  const csrIds = new Set((rolesRes.data ?? []).map((r) => String(r.user_id)))
  const candidates = (usersRes.data ?? []).filter((u) => {
    const legacy = String(u.role ?? '')
      .trim()
      .toLowerCase()
    return legacy === 'csr' || csrIds.has(String(u.id))
  })
  const exact = candidates.filter(
    (u) => normalizeProducerKey(u.full_name) === normalizeProducerKey(name),
  )
  if (exact.length === 1) return String(exact[0].id)
  const soft = candidates.filter((u) =>
    csrIdentityMatches(name, String(u.full_name ?? ''), String(u.email ?? '')),
  )
  if (soft.length === 1) return String(soft[0].id)
  return null
}

export async function updateTransactionMetadata(input: EditTransactionMetadataInput) {
  const authz = await rejectUnlessRole(canManageTransactions)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
    }
  }
  const { data: row, error: fetchError } = await supabase
    .from('transactions')
    .select(
      `
      id,
      transaction_number,
      client_id,
      policy_id,
      producer,
      csr,
      csr_user_id,
      transaction_type,
      transaction_date,
      producer_split_percentage,
      amount,
      premium_amount,
      producer_payment_status,
      payment_batch_id,
      archived_at,
      paid_date,
      agency_commission_confirmed,
      agency_commission_receipt_id,
      review_status,
      review_return_reason,
      review_returned_at,
      transaction_effective_date,
      transaction_expiration_date,
      agency_commission_amount,
      agency_commission_percentage,
      broker_fee,
      commission_type,
      reviewer_user_id
    `,
    )
    .eq('id', input.transactionId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'transactions',
        operation: 'edit_fetch',
        details: fetchError,
      },
    }
  }

  if (!row) {
    return {
      error: {
        message: 'Transaction not found.',
        table: 'transactions',
        operation: 'edit_validation',
      },
    }
  }

  const paymentStatus = normalizePaymentStatus(row.producer_payment_status)
  if (
    row.archived_at ||
    paymentStatus === 'paid' ||
    row.paid_date ||
    row.payment_batch_id
  ) {
    return {
      error: {
        message:
          'Transaction cannot be edited. It is archived, paid, or linked to a payment batch.',
        table: 'transactions',
        operation: 'edit_validation',
      },
    }
  }

  if (!TRANSACTION_TYPES.includes(input.type as TransactionType)) {
    return {
      error: {
        message: 'Invalid transaction type.',
        table: 'transactions',
        operation: 'edit_validation',
      },
    }
  }

  if (!input.transactionDate.trim()) {
    return {
      error: {
        message: 'Transaction date is required.',
        table: 'transactions',
        operation: 'edit_validation',
      },
    }
  }

  if (!input.clientId.trim() || !input.policyId.trim()) {
    return {
      error: {
        message: 'Client and policy are required.',
        table: 'transactions',
        operation: 'edit_validation',
      },
    }
  }

  const payload: Record<string, unknown> = {
    transaction_date: input.transactionDate.trim(),
    description: input.description.trim() || null,
    notes: input.notes.trim() || null,
    remarks: input.remarks.trim() || null,
    transaction_type: input.type,
    producer: input.producer.trim() || null,
    csr: input.csr.trim() || null,
    client_id: input.clientId.trim(),
    policy_id: input.policyId.trim(),
    reviewer_user_id: input.reviewerUserId?.trim() || null,
    transaction_effective_date:
      input.transactionEffectiveDate !== undefined
        ? input.transactionEffectiveDate?.trim() || null
        : undefined,
    transaction_expiration_date:
      input.transactionExpirationDate !== undefined
        ? input.transactionExpirationDate?.trim() || null
        : undefined,
  }

  // Drop undefined so we don't overwrite dates when omitted.
  if (payload.transaction_effective_date === undefined) delete payload.transaction_effective_date
  if (payload.transaction_expiration_date === undefined) delete payload.transaction_expiration_date

  // Resolve stable CSR user id whenever CSR TEXT is set/changed.
  const nextCsrName = input.csr.trim()
  if (!nextCsrName) {
    payload.csr_user_id = null
  } else {
    const resolvedCsrUserId = await resolveCsrUserIdByName(nextCsrName)
    payload.csr_user_id = resolvedCsrUserId
  }

  const reviewStatus = normalizeReviewStatus(row.review_status as string | null)
  const isReturnedForCorrection =
    Boolean(row.agency_commission_confirmed) &&
    reviewStatus === 'expected' &&
    (Boolean(row.review_returned_at) ||
      Boolean(String(row.review_return_reason ?? '').trim()))

  const commissionUnlocked =
    Boolean(input.unlockCommission) &&
    paymentStatus === 'not_ready' &&
    (isReturnedForCorrection ||
      (!row.agency_commission_confirmed && !row.agency_commission_receipt_id))

  if (commissionUnlocked) {
    let premiumAmount = Number(input.premiumAmount)
    const commissionType = normalizeCommissionType(input.commissionType)
    const brokerFee = Number(input.brokerFee)
    const split = Number(input.producerSplitPercentage)

    if (!Number.isFinite(premiumAmount)) {
      return {
        error: {
          message: 'Enter a valid transaction amount.',
          table: 'transactions',
          operation: 'edit_validation',
        },
      }
    }
    premiumAmount = normalizePremiumAmountForType(input.type, premiumAmount)
    const signError = validateTransactionPremiumAmount(input.type, premiumAmount)
    if (signError) {
      return {
        error: {
          message: signError,
          table: 'transactions',
          operation: 'edit_validation',
        },
      }
    }
    if (commissionType === 'percentage') {
      const pct = Number(input.agencyCommissionPercentage)
      if (!Number.isFinite(pct) || pct < 0) {
        return {
          error: {
            message: 'Agency commission % must be zero or greater.',
            table: 'transactions',
            operation: 'edit_validation',
          },
        }
      }
    } else if (
      input.agencyCommissionAmount === null ||
      input.agencyCommissionAmount === undefined ||
      !Number.isFinite(Number(input.agencyCommissionAmount))
    ) {
      return {
        error: {
          message: 'Enter a valid flat agency commission amount.',
          table: 'transactions',
          operation: 'edit_validation',
        },
      }
    }
    if (!Number.isFinite(brokerFee)) {
      return {
        error: {
          message: 'Enter a valid broker fee.',
          table: 'transactions',
          operation: 'edit_validation',
        },
      }
    }
    if (!Number.isFinite(split) || split < 0) {
      return {
        error: {
          message: 'Producer split % must be zero or greater.',
          table: 'transactions',
          operation: 'edit_validation',
        },
      }
    }

    const derived = deriveCommission({
      commissionType,
      baseAmount: premiumAmount,
      agencyCommissionPercentage:
        commissionType === 'percentage' ? Number(input.agencyCommissionPercentage) : null,
      agencyCommissionAmount:
        commissionType === 'flat' ? Number(input.agencyCommissionAmount) : null,
      brokerFee,
      producerSplitPercentage: split,
    })

    payload.amount = premiumAmount
    payload.premium_amount = premiumAmount
    payload.commission_type = derived.commissionType
    payload.agency_commission_percentage = derived.agencyCommissionPercentage
    payload.agency_commission_amount = derived.agencyCommissionAmount
    payload.broker_fee = derived.brokerFee
    payload.producer_split_percentage = derived.producerSplitPercentage
    payload.producer_commission_amount = derived.producerCommissionAmount
    payload.agency_net_commission = derived.agencyNetCommission
    payload.expected_amount = derived.agencyCommissionAmount
    payload.carrier_commission_percentage =
      derived.commissionType === 'percentage' ? derived.agencyCommissionPercentage : null
  }

  const { data: updated, error } = await supabase
    .from('transactions')
    .update(payload)
    .eq('id', input.transactionId)
    .is('archived_at', null)
    .is('payment_batch_id', null)
    .is('paid_date', null)
    .neq('producer_payment_status', 'paid')
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'edit_update',
        details: error,
      },
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message:
          'Edit did not update any row. The transaction may no longer be editable.',
        table: 'transactions',
        operation: 'edit_validation',
      },
    }
  }

  await recordActivity({
    action: 'transaction_edit',
    entityType: 'transaction',
    entityId: input.transactionId,
    recordReference: String(row.transaction_number ?? ''),
    clientId: ((row.client_id as string | null) ?? input.clientId.trim()) || null,
    policyId: ((row.policy_id as string | null) ?? input.policyId.trim()) || null,
    transactionId: input.transactionId,
    oldValue: {
      producer: row.producer ?? null,
      csr: row.csr ?? null,
      csrUserId: row.csr_user_id ?? null,
      type: row.transaction_type ?? null,
      reviewerUserId: row.reviewer_user_id ?? null,
      producerSplitPercentage: row.producer_split_percentage ?? null,
      amount: row.amount ?? row.premium_amount ?? null,
      agencyCommissionAmount: row.agency_commission_amount ?? null,
      brokerFee: row.broker_fee ?? null,
      transactionEffectiveDate: row.transaction_effective_date ?? null,
      transactionExpirationDate: row.transaction_expiration_date ?? null,
      commissionUnlocked: false,
    },
    newValue: {
      producer: input.producer.trim() || null,
      csr: input.csr.trim() || null,
      csrUserId: (payload.csr_user_id as string | null) ?? null,
      type: input.type,
      reviewerUserId: input.reviewerUserId?.trim() || null,
      producerSplitPercentage: commissionUnlocked
        ? Number(input.producerSplitPercentage)
        : (row.producer_split_percentage ?? null),
      amount: commissionUnlocked
        ? Number(input.premiumAmount)
        : (row.amount ?? row.premium_amount ?? null),
      agencyCommissionAmount: commissionUnlocked
        ? (payload.agency_commission_amount as number | null | undefined) ??
          (row.agency_commission_amount ?? null)
        : (row.agency_commission_amount ?? null),
      brokerFee: commissionUnlocked
        ? Number(input.brokerFee)
        : (row.broker_fee ?? null),
      transactionEffectiveDate:
        input.transactionEffectiveDate !== undefined
          ? input.transactionEffectiveDate?.trim() || null
          : (row.transaction_effective_date ?? null),
      transactionExpirationDate:
        input.transactionExpirationDate !== undefined
          ? input.transactionExpirationDate?.trim() || null
          : (row.transaction_expiration_date ?? null),
      commissionUnlocked,
      returnedForCorrectionEdit: isReturnedForCorrection,
    },
  })

  return { data: { id: updated[0].id as string }, error: null }
}

export async function approveTransactionReview(transactionId: string) {
  const authz = await rejectUnlessRole(canApproveTransactions)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
    }
  }
  const actorId = authz.profileId ?? (await currentAppUserId())
  if (!actorId) {
    return {
      error: {
        message: 'Unable to resolve current ALZA user profile.',
        table: 'transactions',
        operation: 'approve_validation',
      },
    }
  }

  const { data: row, error: fetchError } = await supabase
    .from('transactions')
    .select(
      `
      id,
      agency_commission_confirmed,
      review_status,
      producer_payment_status,
      payment_batch_id,
      archived_at,
      paid_date,
      reviewer_user_id
    `,
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'transactions',
        operation: 'approve_fetch',
        details: fetchError,
      },
    }
  }

  if (!row) {
    return {
      error: {
        message: 'Transaction not found.',
        table: 'transactions',
        operation: 'approve_validation',
      },
    }
  }

  const gate = canActOnAssignedReview({
    role: authz.role,
    profileUserId: actorId,
    reviewerUserId: row.reviewer_user_id as string | null,
  })
  if (!gate.allowed) {
    return {
      error: {
        message:
          'Only the assigned reviewer may approve this transaction (Owner may override).',
        table: 'transactions',
        operation: 'approve_authorize',
      },
    }
  }

  const reviewStatus = normalizeReviewStatus(row.review_status)
  const paymentStatus = normalizePaymentStatus(row.producer_payment_status)

  if (
    row.archived_at ||
    paymentStatus === 'paid' ||
    row.paid_date ||
    row.payment_batch_id ||
    !row.agency_commission_confirmed ||
    reviewStatus !== 'matched'
  ) {
    return {
      error: {
        message:
          'Transaction cannot be approved. It must be submitted for review (matched), confirmed, and not paid/batched/archived.',
        table: 'transactions',
        operation: 'approve_validation',
      },
    }
  }

  const { data: updated, error } = await supabase
    .from('transactions')
    .update({
      review_status: 'approved',
      reviewed_by: actorId,
      reviewed_date: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .eq('agency_commission_confirmed', true)
    .eq('review_status', 'matched')
    .is('archived_at', null)
    .is('payment_batch_id', null)
    .is('paid_date', null)
    .neq('producer_payment_status', 'paid')
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'approve_update',
        details: error,
      },
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message:
          'Approve did not update any row. The transaction may no longer be eligible.',
        table: 'transactions',
        operation: 'approve_validation',
      },
    }
  }

  await recordActivity({
    action: 'transaction_approve',
    entityType: 'transaction',
    entityId: transactionId,
    transactionId,
    oldValue: { reviewStatus },
    newValue: { reviewStatus: 'approved', ownerOverride: gate.ownerOverride },
  })

  return { data: { id: updated[0].id as string, ownerOverride: gate.ownerOverride }, error: null }
}

/**
 * CSR Submit for Review → review_status = matched (existing DB value).
 * Clears prior correction reason after successful resubmission.
 * Invokes notify-transaction-review for the assigned reviewer only (best-effort email).
 */
export async function submitTransactionForReview(transaction: CommissionTransaction) {
  const authz = await rejectUnlessRole(canSubmitTransactionReview)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  if (!canSubmitTransactionForReview(transaction)) {
    return {
      error: {
        message:
          'Cannot submit for review. Require reviewer, client, policy, type, amount, producer, agency commission, producer commission, receipt confirmed, and review status Expected.',
        table: 'transactions',
        operation: 'submit_review_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  // When a CSR submits/resubmits, stamp transactions.csr + csr_user_id to their profile
  // so correction queues / notifications resolve by stable identity.
  const submitPatch: Record<string, unknown> = {
    review_status: 'matched',
    review_return_reason: null,
    review_returned_at: null,
    review_returned_by: null,
  }
  const wasReturned =
    Boolean(transaction.reviewReturnedAt) || Boolean(transaction.reviewReturnReason?.trim())
  if (authz.roles.includes('csr') && authz.profileId) {
    const { data: me } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', authz.profileId)
      .maybeSingle()
    const csrName = String(me?.full_name ?? '').trim()
    if (csrName) {
      submitPatch.csr = csrName
      submitPatch.csr_user_id = authz.profileId
    }
  } else if (!transaction.csrUserId && transaction.csr && transaction.csr !== '—') {
    const resolved = await resolveCsrUserIdByName(transaction.csr)
    if (resolved) submitPatch.csr_user_id = resolved
  }

  const { data: updated, error } = await supabase
    .from('transactions')
    .update(submitPatch)
    .eq('id', transaction.id)
    .eq('agency_commission_confirmed', true)
    .eq('review_status', 'expected')
    .eq('producer_payment_status', 'not_ready')
    .eq('reviewer_user_id', transaction.reviewerUserId as string)
    .is('archived_at', null)
    .is('payment_batch_id', null)
    .is('paid_date', null)
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'submit_review_update',
        details: error,
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message:
          'Submit for Review did not update any row. It may already be submitted or no longer eligible.',
        table: 'transactions',
        operation: 'submit_review_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  let email: { sent: boolean; code?: string; message: string } = {
    sent: false,
    message: 'Review email was not attempted.',
  }

  try {
    const { data, error: invokeError } = await supabase.functions.invoke(
      'notify-transaction-review',
      { body: { transactionId: transaction.id, action: 'submitted' } },
    )

    if (invokeError) {
      let detail = invokeError.message
      let code = 'invoke_failed'
      try {
        const ctx = (invokeError as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          const body = (await ctx.json()) as { message?: string; code?: string }
          if (body?.message) detail = body.message
          if (body?.code) code = body.code
        }
      } catch {
        /* keep invoke message */
      }
      email = {
        sent: false,
        code,
        message: `Transaction submitted, but review email failed: ${detail}`,
      }
    } else if (data && typeof data === 'object') {
      const payload = data as {
        ok?: boolean
        emailed?: boolean
        code?: string
        message?: string
        email_code?: string
        email_message?: string
      }
      const emailCode = payload.email_code || payload.code
      const emailMessage = payload.email_message || payload.message
      if (payload.emailed) {
        email = {
          sent: true,
          code: emailCode,
          message: emailMessage || 'Review email sent to assigned reviewer.',
        }
      } else {
        email = {
          sent: false,
          code: emailCode || 'email_not_sent',
          message:
            emailMessage ||
            'Transaction submitted. Review email was not sent (provider not configured or delivery failed).',
        }
      }
    }
  } catch (err) {
    email = {
      sent: false,
      code: 'email_exception',
      message: `Transaction submitted, but review email failed: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`,
    }
  }

  await recordActivity({
    action: 'transaction_submit',
    entityType: 'transaction',
    entityId: transaction.id,
    recordReference: transaction.transactionNumber || String(transaction.id),
    clientId: transaction.clientId || null,
    policyId: transaction.policyId || null,
    transactionId: transaction.id,
    oldValue: {
      reviewStatus: transaction.reviewStatus,
      reviewReturnReason: transaction.reviewReturnReason || null,
    },
    newValue: { reviewStatus: 'matched', resubmit: wasReturned },
  })

  return { data: { id: updated[0].id as string }, error: null, email }
}

/** Owner/Admin Return for Correction → review_status = expected + reason audit. */
export async function returnTransactionForCorrection(
  transactionId: string,
  reason: string,
) {
  const authz = await rejectUnlessRole(canApproveTransactions)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    return {
      error: {
        message: 'Reason for correction is required.',
        table: 'transactions',
        operation: 'return_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  const actorId = await currentAppUserId()
  if (!actorId) {
    return {
      error: {
        message: 'Unable to resolve current ALZA user profile.',
        table: 'transactions',
        operation: 'return_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  const { data: row, error: fetchError } = await supabase
    .from('transactions')
    .select(
      `
      id,
      transaction_number,
      csr,
      csr_user_id,
      agency_commission_confirmed,
      review_status,
      producer_payment_status,
      payment_batch_id,
      archived_at,
      paid_date,
      reviewer_user_id,
      client_id,
      policy_id
    `,
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'transactions',
        operation: 'return_fetch',
        details: fetchError,
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  if (!row) {
    return {
      error: {
        message: 'Transaction not found.',
        table: 'transactions',
        operation: 'return_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  const reviewStatus = normalizeReviewStatus(row.review_status)
  const paymentStatus = normalizePaymentStatus(row.producer_payment_status)
  const gate = canActOnAssignedReview({
    role: authz.role,
    profileUserId: actorId,
    reviewerUserId: row.reviewer_user_id as string | null,
  })

  if (!gate.allowed) {
    return {
      error: {
        message:
          'Only the assigned reviewer may return this transaction (Owner may override).',
        table: 'transactions',
        operation: 'return_authorize',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  if (
    row.archived_at ||
    paymentStatus !== 'not_ready' ||
    row.paid_date ||
    row.payment_batch_id ||
    !row.agency_commission_confirmed ||
    (reviewStatus !== 'matched' && reviewStatus !== 'approved')
  ) {
    return {
      error: {
        message:
          'Transaction cannot be returned. It must be submitted or approved, not ready/batched/paid/archived.',
        table: 'transactions',
        operation: 'return_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  const returnedAt = new Date().toISOString()
  const returnPatch: Record<string, unknown> = {
    review_status: 'expected',
    review_return_reason: trimmedReason,
    review_returned_at: returnedAt,
    review_returned_by: actorId,
  }
  // Ensure stable CSR link for correction queue when missing.
  if (!row.csr_user_id && row.csr) {
    const resolved = await resolveCsrUserIdByName(String(row.csr))
    if (resolved) returnPatch.csr_user_id = resolved
  }

  const { data: updated, error } = await supabase
    .from('transactions')
    .update(returnPatch)
    .eq('id', transactionId)
    .eq('agency_commission_confirmed', true)
    .in('review_status', ['matched', 'approved'])
    .eq('producer_payment_status', 'not_ready')
    .is('archived_at', null)
    .is('payment_batch_id', null)
    .is('paid_date', null)
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'return_update',
        details: error,
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message:
          'Return for Correction did not update any row. The transaction may no longer be eligible.',
        table: 'transactions',
        operation: 'return_validation',
      },
      email: null as { sent: boolean; code?: string; message: string } | null,
    }
  }

  let email: { sent: boolean; code?: string; message: string } = {
    sent: false,
    message: 'Correction email was not attempted.',
  }

  try {
    const { data, error: invokeError } = await supabase.functions.invoke(
      'notify-transaction-review',
      { body: { transactionId, action: 'returned' } },
    )
    if (invokeError) {
      let detail = invokeError.message
      let code = 'invoke_failed'
      try {
        const ctx = (invokeError as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          const body = (await ctx.json()) as { message?: string; code?: string }
          if (body?.message) detail = body.message
          if (body?.code) code = body.code
        }
      } catch {
        /* keep */
      }
      email = { sent: false, code, message: `Returned, but CSR email failed: ${detail}` }
    } else if (data && typeof data === 'object') {
      const payload = data as {
        emailed?: boolean
        email_code?: string
        email_message?: string
        code?: string
        message?: string
      }
      email = {
        sent: Boolean(payload.emailed),
        code: payload.email_code || payload.code,
        message:
          payload.email_message ||
          payload.message ||
          (payload.emailed ? 'Correction email sent.' : 'Correction email not sent.'),
      }
    }
  } catch (err) {
    email = {
      sent: false,
      code: 'email_exception',
      message: `Returned, but CSR email failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }

  await recordActivity({
    action: 'transaction_return',
    entityType: 'transaction',
    entityId: transactionId,
    recordReference: String(row.transaction_number ?? ''),
    clientId: (row.client_id as string | null) ?? null,
    policyId: (row.policy_id as string | null) ?? null,
    transactionId,
    oldValue: { reviewStatus },
    newValue: {
      reviewStatus: 'expected',
      reason: trimmedReason,
      returnedAt,
      ownerOverride: gate.ownerOverride,
      csr: row.csr ?? null,
      csrUserId: (returnPatch.csr_user_id as string | undefined) ?? row.csr_user_id ?? null,
    },
  })

  return { data: { id: updated[0].id as string }, error: null, email }
}

export async function archiveTransaction(transactionId: string) {
  const authz = await rejectUnlessRole(canManageTransactions)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
    }
  }
  const { data: row, error: fetchError } = await supabase
    .from('transactions')
    .select(
      `
      id,
      agency_commission_confirmed,
      agency_commission_receipt_id,
      producer_payment_status,
      payment_batch_id,
      archived_at,
      paid_date
    `,
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'transactions',
        operation: 'archive_fetch',
        details: fetchError,
      },
    }
  }

  if (!row) {
    return {
      error: {
        message: 'Transaction not found.',
        table: 'transactions',
        operation: 'archive_validation',
      },
    }
  }

  const { count: recoveryCount, error: recoveryError } = await supabase
    .from('producer_commission_recoveries')
    .select('id', { count: 'exact', head: true })
    .eq('transaction_id', transactionId)

  if (recoveryError) {
    return {
      error: {
        message: recoveryError.message,
        table: 'producer_commission_recoveries',
        operation: 'archive_recovery_check',
        details: recoveryError,
      },
    }
  }

  const paymentStatus = normalizePaymentStatus(row.producer_payment_status)
  if (
    row.archived_at ||
    paymentStatus !== 'not_ready' ||
    row.paid_date ||
    row.payment_batch_id ||
    row.agency_commission_confirmed ||
    row.agency_commission_receipt_id ||
    (recoveryCount ?? 0) > 0
  ) {
    return {
      error: {
        message:
          'Transaction cannot be archived. It has financial activity (receipt, confirmation, ready/batch/paid status, or recoveries).',
        table: 'transactions',
        operation: 'archive_validation',
      },
    }
  }

  const archivedAt = new Date().toISOString()
  const { data: updated, error } = await supabase
    .from('transactions')
    .update({ archived_at: archivedAt })
    .eq('id', transactionId)
    .eq('producer_payment_status', 'not_ready')
    .eq('agency_commission_confirmed', false)
    .is('agency_commission_receipt_id', null)
    .is('archived_at', null)
    .is('payment_batch_id', null)
    .is('paid_date', null)
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'archive_update',
        details: error,
      },
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message:
          'Archive did not update any row. The transaction may no longer be archivable.',
        table: 'transactions',
        operation: 'archive_validation',
      },
    }
  }

  await recordActivity({
    action: 'transaction_archive',
    entityType: 'transaction',
    entityId: transactionId,
    transactionId,
    oldValue: { archived: false },
    newValue: { archived: true, archivedAt },
  })

  return { data: { id: updated[0].id as string }, error: null }
}

export interface ConfirmReceiptInput {
  transaction: CommissionTransaction
  amountReceived: number
  receivedDate: string
  source: string
  depositReference: string
  externalInvoiceId: string
  notes: string
  varianceAcknowledged: boolean
}

export async function confirmAgencyCommissionReceived(input: ConfirmReceiptInput) {
  const authz = await rejectUnlessRole(canConfirmReceipts)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
    }
  }
  const { transaction } = input
  const expected = transaction.expectedAmount
  const variance = input.amountReceived - expected
  const hasVariance = Math.abs(variance) > 0.009

  if (hasVariance && !input.varianceAcknowledged) {
    return {
      error: {
        message: 'Amount received differs from expected. Acknowledge the variance before confirming.',
        table: 'transactions',
        operation: 'confirm_receipt_validation',
      },
    }
  }

  const noteParts = [
    input.notes.trim(),
    hasVariance
      ? `Variance acknowledged: received ${formatCurrency(input.amountReceived)} vs expected ${formatCurrency(expected)} (${formatCurrency(variance)}).`
      : '',
  ].filter(Boolean)
  const notes = noteParts.join(' ') || null

  const receiptPayload = {
    client_id: transaction.clientId || null,
    policy_id: transaction.policyId || null,
    transaction_id: transaction.id,
    matched_transaction_id: transaction.id,
    producer: transaction.producer === '—' ? null : transaction.producer,
    source: 'manual',
    external_invoice_id: input.externalInvoiceId.trim() || null,
    deposit_reference: input.depositReference.trim() || null,
    notes,
    policy_number: transaction.policyNumber === '—' ? null : transaction.policyNumber,
    client_name: transaction.clientName,
    settlement_date: input.receivedDate,
    imported_at: new Date().toISOString(),
    reconciliation_status: 'matched',
    match_confidence: 'none',
  }

  const { data: receipt, error: receiptError } = await supabase
    .from('agency_commission_receipts')
    .insert(receiptPayload)
    .select('id')
    .single()

  if (receiptError) {
    return {
      error: {
        message: receiptError.message,
        table: 'agency_commission_receipts',
        operation: 'insert',
        details: receiptError,
      },
    }
  }

  // Receipt confirm only — do not auto-approve or auto-submit for review.
  // review_status stays expected so CSR must Submit for Review (matched).
  const { error: txnError } = await supabase
    .from('transactions')
    .update({
      amount_received: input.amountReceived,
      received_date: input.receivedDate,
      agency_commission_confirmed: true,
      agency_commission_receipt_id: receipt.id,
      review_status: 'expected',
    })
    .eq('id', transaction.id)

  if (txnError) {
    return {
      error: {
        message: txnError.message,
        table: 'transactions',
        operation: 'update_after_receipt_insert',
        details: txnError,
        receiptId: receipt.id,
      },
    }
  }

  await recordActivity({
    action: 'transaction_receipt_confirm',
    entityType: 'transaction',
    entityId: transaction.id,
    recordReference: transaction.transactionNumber || String(transaction.id),
    clientId: transaction.clientId || null,
    policyId: transaction.policyId || null,
    transactionId: transaction.id,
    oldValue: {
      agencyCommissionConfirmed: transaction.agencyCommissionConfirmed,
      amountReceived: transaction.amountReceived,
    },
    newValue: {
      agencyCommissionConfirmed: true,
      amountReceived: input.amountReceived,
      receivedDate: input.receivedDate,
      receiptId: receipt.id as string,
      variance,
      hasVariance,
    },
  })

  return { data: { receiptId: receipt.id as string }, error: null }
}

export async function markProducerCommissionReady(transactionId: string) {
  const authz = await rejectUnlessRole(canMarkProducerReady)
  if (!authz.ok) {
    return {
      error: { message: authz.message, table: 'transactions', operation: 'authorize' },
    }
  }
  const actorId = authz.profileId ?? (await currentAppUserId())
  const { data: row, error: fetchError } = await supabase
    .from('transactions')
    .select(
      `
      id,
      agency_commission_confirmed,
      review_status,
      producer,
      producer_commission_amount,
      producer_payment_status,
      payment_batch_id,
      archived_at,
      paid_date,
      reviewer_user_id
    `,
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'transactions',
        operation: 'mark_ready_fetch',
        details: fetchError,
      },
    }
  }

  if (!row) {
    return {
      error: {
        message: 'Transaction not found for Mark Ready.',
        table: 'transactions',
        operation: 'mark_ready_validation',
      },
    }
  }

  const gate = canActOnAssignedReview({
    role: authz.role,
    profileUserId: actorId,
    reviewerUserId: row.reviewer_user_id as string | null,
  })
  if (!gate.allowed) {
    return {
      error: {
        message:
          'Only the assigned reviewer may mark this transaction ready (Owner may override).',
        table: 'transactions',
        operation: 'mark_ready_authorize',
      },
    }
  }

  const producer = (row.producer ?? '').trim()
  const paymentStatus = normalizePaymentStatus(row.producer_payment_status)
  const reviewStatus = normalizeReviewStatus(row.review_status)
  const producerAmount = toNumber(row.producer_commission_amount)

  if (
    !row.agency_commission_confirmed ||
    reviewStatus !== 'approved' ||
    !isAssignableProducer(producer) ||
    producerAmount <= 0 ||
    paymentStatus !== 'not_ready' ||
    row.payment_batch_id ||
    row.archived_at ||
    row.paid_date
  ) {
    return {
      error: {
        message:
          'Transaction does not meet Mark Ready requirements (confirmed, approved, producer, positive producer commission, not_ready, no batch, not archived, not paid).',
        table: 'transactions',
        operation: 'mark_ready_validation',
      },
    }
  }

  const { data: updated, error } = await supabase
    .from('transactions')
    .update({ producer_payment_status: 'ready' })
    .eq('id', transactionId)
    .eq('agency_commission_confirmed', true)
    .eq('review_status', 'approved')
    .eq('producer_payment_status', 'not_ready')
    .is('payment_batch_id', null)
    .is('archived_at', null)
    .is('paid_date', null)
    .gt('producer_commission_amount', 0)
    .not('producer', 'is', null)
    .neq('producer', '')
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'transactions',
        operation: 'update_producer_payment_status',
        details: error,
      },
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message:
          'Mark Ready did not update any row. The transaction may no longer meet readiness requirements.',
        table: 'transactions',
        operation: 'mark_ready_validation',
      },
    }
  }

  await recordActivity({
    action: 'transaction_mark_ready',
    entityType: 'transaction',
    entityId: transactionId,
    recordReference: producer,
    transactionId,
    oldValue: { producerPaymentStatus: paymentStatus },
    newValue: {
      producerPaymentStatus: 'ready',
      producer,
      producerCommissionAmount: producerAmount,
      ownerOverride: gate.ownerOverride,
    },
  })

  return { error: null }
}

export interface CreateRecoveryInput {
  transactionId: string
  receiptId: string | null
  producer: string
  amount: number
  notes: string
  clientId?: string | null
  policyId?: string | null
  reason?: string | null
  recoveryDate?: string | null
  settlementMethod?: 'next_payout' | 'direct_payment'
}

export async function createProducerRecovery(input: CreateRecoveryInput) {
  const authz = await rejectUnlessRole(canManageRecoveries)
  if (!authz.ok) {
    return {
      error: {
        message: authz.message,
        table: 'producer_commission_recoveries',
        operation: 'authorize',
      },
    }
  }

  const producer = input.producer.trim()
  if (!producer || producer === '—') {
    return {
      error: {
        message: 'Producer is required for a recovery.',
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }

  const amount = toNumber(input.amount)
  if (!(amount > 0)) {
    return {
      error: {
        message: 'Recovery amount must be greater than zero.',
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }

  const notes = input.notes.trim()
  if (!notes) {
    return {
      error: {
        message: 'Reason / notes are required for a recovery.',
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }

  // Prevent duplicate open recovery for the same return transaction + producer.
  const { data: existingDup } = await supabase
    .from('producer_commission_recoveries')
    .select('id, status, voided_at')
    .eq('transaction_id', input.transactionId)
    .eq('producer', producer)
    .eq('status', 'open')
    .is('voided_at', null)
    .limit(1)

  if ((existingDup ?? []).length > 0) {
    return {
      error: {
        message:
          'An open recovery already exists for this transaction and producer. Settle or void it before creating another.',
        table: 'producer_commission_recoveries',
        operation: 'duplicate_guard',
      },
    }
  }

  // Cap recoveries on negative producer-commission transactions.
  const { data: txnRow, error: txnFetchError } = await supabase
    .from('transactions')
    .select('id, producer_commission_amount')
    .eq('id', input.transactionId)
    .maybeSingle()

  if (txnFetchError || !txnRow) {
    return {
      error: {
        message: txnFetchError?.message ?? 'Transaction not found for recovery.',
        table: 'transactions',
        operation: 'recovery_cap_fetch',
        details: txnFetchError,
      },
    }
  }

  const obligation = transactionRecoveryObligation(toNumber(txnRow.producer_commission_amount))
  if (obligation > 0) {
    const { data: existingRecoveries, error: existingError } = await supabase
      .from('producer_commission_recoveries')
      .select('amount, status, voided_at')
      .eq('transaction_id', input.transactionId)

    if (existingError) {
      return {
        error: {
          message: existingError.message,
          table: 'producer_commission_recoveries',
          operation: 'recovery_cap_fetch',
          details: existingError,
        },
      }
    }

    const available = availableRecoveryAmount(
      toNumber(txnRow.producer_commission_amount),
      (existingRecoveries ?? []) as Array<{
        amount?: number | string | null
        status?: string | null
        voided_at?: string | null
      }>,
    )

    if (!(amount > 0) || amount > available + 0.009) {
      return {
        error: {
          message:
            available <= 0
              ? `This transaction is fully recovered (${formatCurrency(obligation)}). No additional recovery can be recorded.`
              : `Recovery amount (${formatCurrency(amount)}) exceeds available recoverable amount (${formatCurrency(available)}).`,
          table: 'producer_commission_recoveries',
          operation: 'recovery_cap',
        },
      }
    }
  }

  const settlementMethod =
    input.settlementMethod === 'direct_payment' ? 'direct_payment' : 'next_payout'

  const payload = {
    transaction_id: input.transactionId,
    receipt_id: input.receiptId,
    producer,
    amount,
    status: 'open',
    applied_amount: 0,
    remaining_amount: amount,
    notes,
    client_id: input.clientId ?? null,
    policy_id: input.policyId ?? null,
    reason: input.reason?.trim() || notes,
    recovery_date: input.recoveryDate || todayIsoDate(),
    settlement_method: settlementMethod,
  }

  const { data, error } = await supabase
    .from('producer_commission_recoveries')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'producer_commission_recoveries',
        operation: 'insert',
        details: error,
      },
    }
  }

  await recordActivity({
    action: 'recovery_create',
    entityType: 'recovery',
    entityId: data.id as string,
    recordReference: producer,
    clientId: input.clientId ?? null,
    policyId: input.policyId ?? null,
    transactionId: input.transactionId,
    newValue: {
      amount,
      settlementMethod,
      reason: payload.reason,
    },
  })

  return { data, error: null }
}

/** Record Producer Paid Agency Directly against an open recovery (does not go through payout batch). */
export async function recordDirectRecoveryPayment(input: {
  recoveryId: string
  amountReceived: number
  receivedDate: string
  paymentReference?: string
  notes?: string
}) {
  const authz = await rejectUnlessRole(canManageRecoveries)
  if (!authz.ok) {
    return {
      error: {
        message: authz.message,
        table: 'producer_commission_recoveries',
        operation: 'authorize',
      },
    }
  }

  const amount = toNumber(input.amountReceived)
  if (!(amount > 0)) {
    return {
      error: {
        message: 'Amount received must be greater than zero.',
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }

  const { data: row, error: fetchError } = await supabase
    .from('producer_commission_recoveries')
    .select(
      'id, amount, applied_amount, remaining_amount, status, voided_at, settlement_method, transaction_id, producer, client_id, policy_id, direct_paid_amount',
    )
    .eq('id', input.recoveryId)
    .maybeSingle()

  if (fetchError || !row) {
    return {
      error: {
        message: fetchError?.message ?? 'Recovery not found.',
        table: 'producer_commission_recoveries',
        operation: 'fetch',
      },
    }
  }
  if (row.voided_at) {
    return {
      error: {
        message: 'Cannot settle a voided recovery.',
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }

  const remaining = toNumber(row.remaining_amount ?? row.amount)
  if (!(remaining > 0)) {
    return {
      error: {
        message: 'This recovery has no outstanding balance.',
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }
  if (amount > remaining + 0.0001) {
    return {
      error: {
        message: `Amount received (${amount}) exceeds remaining recovery (${remaining}).`,
        table: 'producer_commission_recoveries',
        operation: 'validate',
      },
    }
  }

  const applied = toNumber(row.applied_amount) + amount
  const nextRemaining = Math.max(0, roundMoney(toNumber(row.amount) - applied))
  // Live CHECK: open (remaining > 0) | applied (remaining = 0) | voided
  const status = nextRemaining > 0 ? 'open' : 'applied'
  const actorId = authz.profileId ?? (await currentAppUserId())

  const { data: updated, error } = await supabase
    .from('producer_commission_recoveries')
    .update({
      applied_amount: roundMoney(applied),
      remaining_amount: nextRemaining,
      status,
      settlement_method: 'direct_payment',
      direct_paid_amount: roundMoney(
        toNumber(row.direct_paid_amount ?? 0) + amount,
      ),
      direct_paid_date: input.receivedDate,
      direct_paid_at: new Date().toISOString(),
      direct_paid_by: actorId,
      direct_payment_reference: input.paymentReference?.trim() || null,
      direct_paid_notes: input.notes?.trim() || null,
    })
    .eq('id', input.recoveryId)
    .select('id')
    .maybeSingle()

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'producer_commission_recoveries',
        operation: 'direct_pay_update',
        details: error,
      },
    }
  }

  await recordActivity({
    action: 'recovery_direct_payment',
    entityType: 'recovery',
    entityId: input.recoveryId,
    recordReference: String(row.producer ?? ''),
    clientId: (row.client_id as string | null) ?? null,
    policyId: (row.policy_id as string | null) ?? null,
    transactionId: (row.transaction_id as string | null) ?? null,
    oldValue: {
      remaining: remaining,
      status: row.status,
    },
    newValue: {
      amountReceived: amount,
      remaining: nextRemaining,
      status,
      receivedDate: input.receivedDate,
      paymentReference: input.paymentReference ?? null,
    },
  })

  return { data: updated, error: null }
}

export async function fetchRelatedReturnPremiums(originalTransactionId: string): Promise<{
  data: Array<{ id: string; number: string; amount: number }>
  error: string | null
}> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, transaction_number, premium_amount, voided_at, archived_at')
    .eq('original_transaction_id', originalTransactionId)
    .is('archived_at', null)
    .order('transaction_date', { ascending: false })

  if (error) return { data: [], error: error.message }
  return {
    data: (data ?? [])
      .filter((r) => !r.voided_at)
      .map((r) => ({
        id: String(r.id),
        number: String(r.transaction_number ?? r.id),
        amount: Number(r.premium_amount ?? 0) || 0,
      })),
    error: null,
  }
}

/**
 * Void an OPEN recovery with no applied amount.
 * Partially applied recoveries are blocked (allocation reversal not supported).
 */
export async function voidProducerRecovery(recoveryId: string) {
  const authz = await rejectUnlessRole(canManageRecoveries)
  if (!authz.ok) {
    return {
      error: {
        message: authz.message,
        table: 'producer_commission_recoveries',
        operation: 'authorize',
      },
    }
  }

  const actorId = await currentAppUserId()
  if (!actorId) {
    return {
      error: {
        message: 'Could not resolve the current app user for void audit.',
        table: 'producer_commission_recoveries',
        operation: 'void_actor',
      },
    }
  }

  const { data: row, error: fetchError } = await supabase
    .from('producer_commission_recoveries')
    .select(
      'id, status, applied_amount, remaining_amount, voided_at, producer, client_id, policy_id, transaction_id, amount',
    )
    .eq('id', recoveryId)
    .maybeSingle()

  if (fetchError) {
    return {
      error: {
        message: fetchError.message,
        table: 'producer_commission_recoveries',
        operation: 'void_fetch',
        details: fetchError,
      },
    }
  }

  if (!row) {
    return {
      error: {
        message: 'Recovery not found.',
        table: 'producer_commission_recoveries',
        operation: 'void_validate',
      },
    }
  }

  if (normalizeRecoveryStatus(row.status) !== 'open' || row.voided_at) {
    return {
      error: {
        message: 'Only OPEN recoveries can be voided.',
        table: 'producer_commission_recoveries',
        operation: 'void_validate',
      },
    }
  }

  if (toNumber(row.applied_amount) > 0) {
    return {
      error: {
        message:
          'Cannot void a recovery that already has applied_amount > 0. Allocation reversal is not supported.',
        table: 'producer_commission_recoveries',
        operation: 'void_validate',
      },
    }
  }

  const { data: updated, error } = await supabase
    .from('producer_commission_recoveries')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: actorId,
    })
    .eq('id', recoveryId)
    .eq('status', 'open')
    .is('voided_at', null)
    .eq('applied_amount', 0)
    .select('id')

  if (error) {
    return {
      error: {
        message: error.message,
        table: 'producer_commission_recoveries',
        operation: 'void_update',
        details: error,
      },
    }
  }

  if (!updated || updated.length === 0) {
    return {
      error: {
        message: 'Recovery was not voided (it may no longer be open / unapplied).',
        table: 'producer_commission_recoveries',
        operation: 'void_validate',
      },
    }
  }

  await recordActivity({
    action: 'recovery_void',
    entityType: 'recovery',
    entityId: recoveryId,
    recordReference: String(row.producer ?? ''),
    clientId: (row.client_id as string | null) ?? null,
    policyId: (row.policy_id as string | null) ?? null,
    transactionId: (row.transaction_id as string | null) ?? null,
    oldValue: {
      status: row.status,
      remainingAmount: row.remaining_amount,
      amount: row.amount,
    },
    newValue: { status: 'voided' },
  })

  return { data: updated[0], error: null }
}

export interface CreatePaymentBatchInput {
  producer: string
  transactionIds: string[]
  /** @deprecated Ignored — net is calculated atomically in the DB RPC. */
  itemNetAmounts?: Record<string, number>
  notes: string
}

/**
 * Creates a producer payment batch atomically via
 * create_producer_payment_batch_with_recoveries (gross, recoveries, net, allocations).
 * Batch number is assigned by the database BEFORE INSERT trigger.
 * Recoveries are consumed here — Confirm Paid must not touch recovery balances again.
 */
export async function createProducerPaymentBatch(input: CreatePaymentBatchInput) {
  const authz = await rejectUnlessRole(canManageProducerPayments)
  if (!authz.ok) {
    return {
      error: {
        message: authz.message,
        table: 'producer_payment_batches',
        operation: 'authorize',
      },
    }
  }
  if (input.transactionIds.length === 0) {
    return {
      error: {
        message: 'Select at least one transaction.',
        table: 'producer_payment_batches',
        operation: 'validate',
      },
    }
  }

  const producer = input.producer.trim()
  if (!producer) {
    return {
      error: {
        message: 'Producer is required.',
        table: 'producer_payment_batches',
        operation: 'validate',
      },
    }
  }

  const { data, error } = await supabase.rpc('create_producer_payment_batch_with_recoveries', {
    p_producer: producer,
    p_transaction_ids: input.transactionIds,
    p_notes: input.notes.trim() || null,
  })

  if (error) {
    const missingFn =
      error.code === 'PGRST202' ||
      /Could not find the function/i.test(error.message) ||
      /schema cache/i.test(error.message)
    return {
      error: {
        message: missingFn
          ? 'Atomic payout RPC is not applied yet. Apply migration 20260812233000_create_producer_payment_batch_with_recoveries.sql before creating producer payment batches.'
          : error.message,
        table: 'producer_payment_batches',
        operation: missingFn ? 'rpc_missing' : 'rpc_create_producer_payment_batch_with_recoveries',
        details: error,
      },
    }
  }

  const payload = data as {
    batch_id?: string
    batch_number?: string
    gross_commission?: number
    recovery_applied?: number
    net_payment?: number
  } | null

  if (!payload?.batch_id) {
    return {
      error: {
        message: 'Payment batch RPC returned no batch id.',
        table: 'producer_payment_batches',
        operation: 'rpc_create_producer_payment_batch_with_recoveries',
      },
    }
  }

  const batchId = payload.batch_id
  const batchNumber = String(payload.batch_number ?? '')
  const grossCommission = toNumber(payload.gross_commission)
  const recoveryApplied = toNumber(payload.recovery_applied)
  const netPayment = toNumber(payload.net_payment)

  await recordActivity({
    action: 'payment_batch_create',
    entityType: 'payment_batch',
    entityId: batchId,
    recordReference: batchNumber || producer,
    newValue: {
      producer,
      batchNumber,
      transactionIds: input.transactionIds,
      grossCommission,
      recoveryApplied,
      netPayment,
    },
  })

  return {
    data: {
      batchId,
      batchNumber,
      grossCommission,
      recoveryApplied,
      netPayment,
    },
    error: null,
  }
}

export interface ConfirmProducerPaidInput {
  batchId: string
  transactionIds: string[]
  itemNetAmounts: Record<string, number>
  paymentDate: string
  paymentMethod: string
  paymentReference: string
  notes?: string
}

export async function confirmProducerPaid(input: ConfirmProducerPaidInput) {
  const authz = await rejectUnlessRole(canManageProducerPayments)
  if (!authz.ok) {
    return {
      error: {
        message: authz.message,
        table: 'producer_payment_batches',
        operation: 'authorize',
      },
    }
  }
  if (!input.paymentDate.trim()) {
    return {
      error: {
        message: 'Payment date is required.',
        table: 'producer_payment_batches',
        operation: 'confirm_paid_validation',
      },
    }
  }
  if (!isValidProducerPaymentMethod(input.paymentMethod)) {
    return {
      error: {
        message: 'Payment method is required.',
        table: 'producer_payment_batches',
        operation: 'confirm_paid_validation',
      },
    }
  }

  const { data: batch, error: batchFetchError } = await supabase
    .from('producer_payment_batches')
    .select(
      `
      id,
      batch_number,
      producer,
      status,
      gross_commission,
      net_payment,
      voided_at,
      producer_payment_batch_items (
        id,
        batch_id,
        transaction_id,
        net_amount
      )
    `,
    )
    .eq('id', input.batchId)
    .maybeSingle()

  if (batchFetchError) {
    return {
      error: {
        message: batchFetchError.message,
        table: 'producer_payment_batches',
        operation: 'confirm_paid_fetch',
        details: batchFetchError,
      },
    }
  }

  if (!batch) {
    return {
      error: {
        message: 'Payment batch not found.',
        table: 'producer_payment_batches',
        operation: 'confirm_paid_validation',
      },
    }
  }

  const batchStatus = (batch.status ?? '').toLowerCase()
  const items = Array.isArray(batch.producer_payment_batch_items)
    ? batch.producer_payment_batch_items
    : batch.producer_payment_batch_items
      ? [batch.producer_payment_batch_items]
      : []
  const batchNet = toNumber(batch.net_payment)
  const batchGross = toNumber(batch.gross_commission)
  const batchProducer = (batch.producer ?? '').trim()

  // Zero-net batches are allowed when recoveries fully offset gross at batch create.
  // Confirm Paid must NOT touch recovery balances again (consumed at create).
  if (batchStatus !== 'draft' || batch.voided_at || items.length < 1 || !(batchNet >= 0)) {
    return {
      error: {
        message:
          'Payment batch is not confirmable. It must be draft, not voided, have at least one item, and net_payment >= 0.',
        table: 'producer_payment_batches',
        operation: 'confirm_paid_validation',
      },
    }
  }

  const transactionIds = items
    .map((item) => item.transaction_id)
    .filter((id): id is string => Boolean(id))

  if (transactionIds.length !== items.length) {
    return {
      error: {
        message: 'One or more batch items are missing a linked transaction.',
        table: 'producer_payment_batch_items',
        operation: 'confirm_paid_validation',
      },
    }
  }

  const { data: transactions, error: txnFetchError } = await supabase
    .from('transactions')
    .select(
      `
      id,
      transaction_number,
      producer,
      producer_payment_status,
      payment_batch_id,
      paid_date
    `,
    )
    .in('id', transactionIds)

  if (txnFetchError) {
    return {
      error: {
        message: txnFetchError.message,
        table: 'transactions',
        operation: 'confirm_paid_fetch',
        details: txnFetchError,
      },
    }
  }

  const txnById = new Map((transactions ?? []).map((row) => [row.id, row]))
  let itemsNetSum = 0

  for (const item of items) {
    const itemNet = toNumber(item.net_amount)
    if (!(itemNet >= 0)) {
      return {
        error: {
          message: 'Every batch item must have net_amount >= 0.',
          table: 'producer_payment_batch_items',
          operation: 'confirm_paid_validation',
        },
      }
    }
    itemsNetSum += itemNet

    const tx = txnById.get(item.transaction_id)
    if (!tx) {
      return {
        error: {
          message: `Linked transaction ${item.transaction_id} was not found.`,
          table: 'transactions',
          operation: 'confirm_paid_validation',
        },
      }
    }

    const txProducer = (tx.producer ?? '').trim()
    if (
      tx.payment_batch_id !== batch.id ||
      normalizePaymentStatus(tx.producer_payment_status) !== 'ready' ||
      tx.paid_date ||
      !isAssignableProducer(txProducer) ||
      txProducer !== batchProducer
    ) {
      return {
        error: {
          message: `Transaction ${tx.transaction_number ?? tx.id} is not eligible for payment confirmation (must be ready, linked to this batch, unpaid, and match batch producer).`,
          table: 'transactions',
          operation: 'confirm_paid_validation',
        },
      }
    }
  }

  if (Math.abs(itemsNetSum - batchNet) > 0.009) {
    return {
      error: {
        message: `Batch item net totals (${itemsNetSum.toFixed(2)}) do not match batch net_payment (${batchNet.toFixed(2)}).`,
        table: 'producer_payment_batches',
        operation: 'confirm_paid_validation',
      },
    }
  }

  const paymentMethod = input.paymentMethod.trim()
  const paymentReference = input.paymentReference.trim() || null
  const paymentNotes = input.notes?.trim() || null

  const batchUpdate: Record<string, unknown> = {
    status: 'paid',
    payment_date: input.paymentDate,
    payment_method: paymentMethod,
    payment_reference: paymentReference,
  }
  // Only set notes when provided so create-time batch notes are not wiped by empty confirm notes.
  if (paymentNotes !== null) {
    batchUpdate.notes = paymentNotes
  }

  const { data: updatedBatch, error: batchError } = await supabase
    .from('producer_payment_batches')
    .update(batchUpdate)
    .eq('id', input.batchId)
    .eq('status', 'draft')
    .is('voided_at', null)
    .select('id')

  if (batchError) {
    return {
      error: {
        message: batchError.message,
        table: 'producer_payment_batches',
        operation: 'update_confirm_paid',
        details: batchError,
      },
    }
  }

  if (!updatedBatch || updatedBatch.length === 0) {
    return {
      error: {
        message:
          'Payment batch was not updated. It may no longer be draft, or it may have been voided concurrently.',
        table: 'producer_payment_batches',
        operation: 'confirm_paid_validation',
      },
    }
  }

  for (const item of items) {
    const { data: updatedTxn, error: txnError } = await supabase
      .from('transactions')
      .update({
        producer_payment_status: 'paid',
        paid_amount: toNumber(item.net_amount),
        paid_date: input.paymentDate,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
      })
      .eq('id', item.transaction_id)
      .eq('payment_batch_id', input.batchId)
      .eq('producer_payment_status', 'ready')
      .is('paid_date', null)
      .select('id')

    if (txnError) {
      return {
        error: {
          message: txnError.message,
          table: 'transactions',
          operation: 'update_confirm_paid',
          details: txnError,
          transactionId: item.transaction_id,
          batchId: input.batchId,
        },
      }
    }

    if (!updatedTxn || updatedTxn.length === 0) {
      return {
        error: {
          message:
            'Batch was marked paid, but a linked transaction could not be updated (possible concurrent change). Review the batch and transaction before retrying.',
          table: 'transactions',
          operation: 'confirm_paid_partial_failure',
          transactionId: item.transaction_id,
          batchId: input.batchId,
        },
      }
    }
  }

  await recordActivity({
    action: 'producer_payout_confirm',
    entityType: 'payment_batch',
    entityId: input.batchId,
    recordReference: String(batch.batch_number ?? ''),
    newValue: {
      producer: batchProducer,
      paymentDate: input.paymentDate,
      paymentMethod,
      paymentReference,
      notes: paymentNotes,
      grossCommission: batchGross,
      netPayment: batchNet,
      recoveryApplied: roundMoney(Math.max(batchGross - batchNet, 0)),
      transactionIds,
    },
  })

  return { error: null }
}
