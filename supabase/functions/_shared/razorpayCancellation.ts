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
