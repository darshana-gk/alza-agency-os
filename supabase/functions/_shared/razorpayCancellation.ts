/**
 * Pure Razorpay cancellation rules.
 * No network, database, or Deno APIs — safe for offline tests.
 */

export const CANCELLED_SUBSCRIPTION_PAYMENT_CODE = 'cancelled_subscription_payment_reported'

export const CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE =
  'Razorpay reported a payment after this subscription was cancelled. The workspace was not activated. ALZA needs to reconcile this subscription before access is granted.'

export function isExplicitlyCancelledStatus(status: string | null | undefined): boolean {
  const value = (status ?? '').trim().toLowerCase()
  return value === 'cancelled' || value === 'canceled'
}

export function isSuccessfulPaymentOrActivationStatus(status: string | null | undefined): boolean {
  const value = (status ?? '').trim().toLowerCase()
  return value === 'authenticated' || value === 'active'
}

export type CreatedSubscriptionCancelRoute = 'local_cancel' | 'api_cancel'

/**
 * Local status is `created`. Decide from the current Razorpay status.
 * `created` never calls the cancel API. Authenticated, active, pending, and paused do.
 */
export function createdSubscriptionCancelRoute(
  remoteStatus: string | null | undefined,
): CreatedSubscriptionCancelRoute {
  const value = (remoteStatus ?? '').trim().toLowerCase()
  if (value === 'created' || value === 'cancelled' || value === 'canceled' || value === 'completed') {
    return 'local_cancel'
  }
  return 'api_cancel'
}

export type CancelledSubscriptionMirrorAction = 'apply' | 'hold' | 'discrepancy'

/**
 * A locally cancelled row stays cancelled.
 * A later successful payment is recorded as a discrepancy and does not grant access.
 * Remote cancelled/completed events may still be stored.
 */
export function cancelledSubscriptionMirrorAction(
  localStatus: string | null | undefined,
  remoteStatus: string | null | undefined,
): CancelledSubscriptionMirrorAction {
  if (!isExplicitlyCancelledStatus(localStatus)) return 'apply'
  const remote = (remoteStatus ?? '').trim().toLowerCase()
  if (remote === 'cancelled' || remote === 'canceled' || remote === 'completed') return 'apply'
  if (isSuccessfulPaymentOrActivationStatus(remote)) return 'discrepancy'
  return 'hold'
}

/** Fields written for an explicit local cancel. Subscription id and plan fields are absent on purpose. */
export function localCreatedCancellationPatch(nowIso: string): {
  status: 'cancelled'
  canceled_at: string
  cancel_at_period_end: false
  updated_at: string
} {
  return {
    status: 'cancelled',
    canceled_at: nowIso,
    cancel_at_period_end: false,
    updated_at: nowIso,
  }
}

export function subscriptionIdsConflict(
  storedId: string | null | undefined,
  incomingId: string,
): boolean {
  const stored = String(storedId ?? '').trim()
  return stored.length > 0 && stored !== incomingId.trim()
}

export function tenantNoteConflicts(
  noteAgencyId: string | null | undefined,
  rowAgencyId: string | null | undefined,
): boolean {
  const note = String(noteAgencyId ?? '').trim()
  const row = String(rowAgencyId ?? '').trim()
  return note.length > 0 && row.length > 0 && note !== row
}

export type ReconciliationNoticeRecord = {
  code?: unknown
  agencyProfileId?: unknown
  subscriptionId?: unknown
  localStatus?: unknown
  remoteStatus?: unknown
  workspaceAccessGranted?: unknown
}

export type ReconciliationNoticeWorkspace = {
  agencyProfileId: string
  currentSubscriptionId?: string | null
  currentStatus?: string | null
}

function noticeText(value: unknown): string {
  return String(value ?? '').trim()
}

export function readReconciliationMarker(payload: unknown): ReconciliationNoticeRecord | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const marker = (payload as Record<string, unknown>).alza_reconciliation
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null
  return marker as ReconciliationNoticeRecord
}

/** A stored marker is complete enough that a later delivery must not reprocess the subscription. */
export function reconciliationMarkerComplete(payload: unknown): boolean {
  const marker = readReconciliationMarker(payload)
  if (!marker) return false
  if (noticeText(marker.code) !== CANCELLED_SUBSCRIPTION_PAYMENT_CODE) return false
  if (marker.workspaceAccessGranted !== false) return false
  if (!isExplicitlyCancelledStatus(noticeText(marker.localStatus))) return false
  if (!isSuccessfulPaymentOrActivationStatus(noticeText(marker.remoteStatus))) return false
  return noticeText(marker.agencyProfileId).length > 0 && noticeText(marker.subscriptionId).length > 0
}

export type WebhookDiscrepancyRetryAction = 'acknowledge' | 'reject'

/**
 * A duplicate delivery records a missing conflict marker and otherwise stops.
 * It never means the subscription update should run again.
 */
export function webhookDiscrepancyRetryAction(input: {
  markerAlreadyStored: boolean
  discrepancyFound: boolean
  recordSucceeded: boolean | null
}): WebhookDiscrepancyRetryAction {
  if (input.markerAlreadyStored) return 'acknowledge'
  if (!input.discrepancyFound) return 'acknowledge'
  return input.recordSucceeded ? 'acknowledge' : 'reject'
}

/**
 * The same subscription is resolved only when that subscription is now active.
 * A newer checkout id does not resolve an earlier conflict.
 */
export function reconciliationConflictResolvedByCurrentSubscription(
  record: ReconciliationNoticeRecord,
  workspace: ReconciliationNoticeWorkspace,
): boolean {
  const recordId = noticeText(record.subscriptionId)
  const currentId = noticeText(workspace.currentSubscriptionId)
  if (!recordId || !currentId || recordId !== currentId) return false
  return noticeText(workspace.currentStatus).toLowerCase() === 'active'
}

/**
 * A payment conflict belongs to this workspace when the agency matches.
 * The current checkout id does not have to match the earlier subscription.
 */
export function reconciliationNoticeMatchesWorkspace(
  record: ReconciliationNoticeRecord | null | undefined,
  workspace: ReconciliationNoticeWorkspace,
): boolean {
  if (!record) return false
  if (noticeText(record.code) !== CANCELLED_SUBSCRIPTION_PAYMENT_CODE) return false
  if (record.workspaceAccessGranted !== false) return false
  if (!isExplicitlyCancelledStatus(noticeText(record.localStatus))) return false
  if (!isSuccessfulPaymentOrActivationStatus(noticeText(record.remoteStatus))) return false
  if (reconciliationConflictResolvedByCurrentSubscription(record, workspace)) return false

  const agencyId = noticeText(record.agencyProfileId)
  const subscriptionId = noticeText(record.subscriptionId)
  const workspaceAgencyId = noticeText(workspace.agencyProfileId)
  if (!agencyId || !subscriptionId || !workspaceAgencyId) return false
  return agencyId === workspaceAgencyId
}

/** Many matching webhook deliveries still produce one notice. */
export function reconciliationNoticeVisible(
  records: readonly (ReconciliationNoticeRecord | null | undefined)[],
  workspace: ReconciliationNoticeWorkspace,
): boolean {
  return records.some((record) => reconciliationNoticeMatchesWorkspace(record, workspace))
}

/** Razorpay cancels at the end of the current cycle. Boolean true is the documented value. */
export function cycleEndCancelRequestBody(): { cancel_at_cycle_end: true } {
  return { cancel_at_cycle_end: true }
}

/** Immediate cancel. Used only when Razorpay reports that no billing cycle has started. */
export function immediateCancelRequestBody(): { cancel_at_cycle_end: false } {
  return { cancel_at_cycle_end: false }
}

export function classifyCycleEndCancelFailure(
  message: string,
): 'no_active_cycle' | 'final_cycle' | 'already_cancelled' | 'other' {
  const value = message.toLowerCase()
  if (value.includes('no billing cycle')) return 'no_active_cycle'
  if (value.includes('final cycle')) return 'final_cycle'
  if (value.includes('not cancellable in cancelled') || value.includes('not cancellable in canceled')) {
    return 'already_cancelled'
  }
  return 'other'
}

export function unixSecondsToIso(seconds: unknown): string | null {
  const n = typeof seconds === 'number' ? seconds : Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

export function readRemoteCancelAtCycleEnd(subscription: Record<string, unknown>): boolean | null {
  const value = subscription.cancel_at_cycle_end
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return null
}

export type CycleEndCancelPlan =
  | { action: 'schedule'; paidThroughIso: string; statusToStore: string }
  | { action: 'unconfirmed' }
  | { action: 'already_ended'; statusToStore: 'cancelled' | 'completed' }

/**
 * The paid-through instant is Razorpay current_end. A 30-day or 365-day offset is never used.
 * A cancelled status with current_end still in the future stays a scheduled cancellation.
 */
export function planCycleEndCancellation(input: {
  remoteStatus: string
  currentEndUnix: unknown
  nowIso: string
}): CycleEndCancelPlan {
  const paidThroughIso = unixSecondsToIso(input.currentEndUnix)
  if (!paidThroughIso) return { action: 'unconfirmed' }
  const remote = input.remoteStatus.trim().toLowerCase()
  const ended = remote === 'cancelled' || remote === 'canceled' || remote === 'completed'
  const endMs = Date.parse(paidThroughIso)
  const nowMs = Date.parse(input.nowIso)
  if (ended && Number.isFinite(endMs) && Number.isFinite(nowMs) && endMs <= nowMs) {
    return {
      action: 'already_ended',
      statusToStore: remote === 'completed' ? 'completed' : 'cancelled',
    }
  }
  const statusToStore =
    remote === 'active' || remote === 'pending' || remote === 'authenticated' || remote === 'paused'
      ? remote
      : 'active'
  return { action: 'schedule', paidThroughIso, statusToStore }
}

export type ScheduledCancellationMirror = {
  status: string
  cancelAtPeriodEnd: boolean
  paidThroughIso: string | null
}

function isoMillis(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Keeps a scheduled cancellation through duplicate, delayed, and older webhooks.
 * A later Razorpay current_end may move the paid-through date forward. An older one cannot.
 * A terminal status does not close access while that paid-through instant is still ahead.
 */
export function reconcileScheduledCancellation(input: {
  localStatus: string | null | undefined
  localCancelAtPeriodEnd: boolean
  localPaidThroughIso: string | null
  remoteStatus: string
  remotePaidThroughIso: string | null
  remoteCancelAtCycleEnd: boolean | null
  nowIso: string
}): ScheduledCancellationMirror {
  const now = isoMillis(input.nowIso) ?? Date.now()
  const remote = input.remoteStatus.trim().toLowerCase()
  const local = String(input.localStatus ?? '').trim().toLowerCase()
  const terminal = remote === 'cancelled' || remote === 'canceled' || remote === 'completed'
  const remoteEnd = isoMillis(input.remotePaidThroughIso)
  const localEnd = isoMillis(input.localPaidThroughIso)
  const futureEnd =
    (remoteEnd != null && remoteEnd > now) || (remoteEnd == null && localEnd != null && localEnd > now)
  const scheduled = input.localCancelAtPeriodEnd || input.remoteCancelAtCycleEnd === true

  if (terminal && futureEnd && scheduled) {
    const statusToStore =
      local === 'active' || local === 'pending' || local === 'authenticated' || local === 'paused'
        ? local
        : 'active'
    return {
      status: statusToStore,
      cancelAtPeriodEnd: true,
      paidThroughIso: input.remotePaidThroughIso ?? input.localPaidThroughIso,
    }
  }

  if (terminal) {
    return {
      status: remote === 'completed' ? 'completed' : 'cancelled',
      cancelAtPeriodEnd: false,
      paidThroughIso: input.remotePaidThroughIso ?? input.localPaidThroughIso,
    }
  }

  let paidThrough = input.localPaidThroughIso
  if (input.remotePaidThroughIso) {
    const remoteMs = isoMillis(input.remotePaidThroughIso)
    const localMs = isoMillis(paidThrough)
    if (!paidThrough || localMs == null || (remoteMs != null && remoteMs > localMs)) {
      paidThrough = input.remotePaidThroughIso
    }
  }

  return {
    status: remote || local || 'active',
    cancelAtPeriodEnd: scheduled,
    paidThroughIso: paidThrough,
  }
}

export function cancellationConfirmationEmail(paidThroughLabel: string): { subject: string; text: string } {
  return {
    subject: 'ALZA Flow cancellation scheduled',
    text: [
      'ALZA Flow has scheduled this subscription to stop renewing.',
      '',
      `Operational access continues until ${paidThroughLabel}, the paid-through date confirmed by Razorpay.`,
      'Future renewal charges are scheduled to stop after that date.',
      'Unused paid time is not automatically refunded.',
      'A renewal charge that is already in progress may still complete. This message does not confirm that a charge was prevented.',
      '',
      'Questions: support@alzabusiness.com',
    ].join('\n'),
  }
}
