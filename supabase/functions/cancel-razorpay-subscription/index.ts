// Deno Edge Function: cancel-razorpay-subscription
// Owner/Admin only. Cancels the caller's agency Razorpay subscription via API.

import {
  adminClient,
  agencyLifecycleAllowsBilling,
  getCallerAgency,
  getOrCreateBillingRow,
  requireOwnerOrAdmin,
  razorpayGetSubscription,
  razorpayRequest,
  unixToIso,
  normalizeRazorpayStatus,
} from '../_shared/billing.ts'
import {
  createdSubscriptionCancelRoute,
  localCreatedCancellationPatch,
} from '../_shared/razorpayCancellation.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const admin = adminClient()
  const authz = await requireOwnerOrAdmin(admin, req.headers.get('Authorization'))
  if (!authz.ok) return authz.response

  const agency = await getCallerAgency(admin, authz.agencyProfileId)
  if (!agency.data) {
    return fail('agency_missing', agency.error ?? 'Agency profile missing.', 400)
  }

  if (!agencyLifecycleAllowsBilling(agency.data.lifecycle as string | null)) {
    return fail(
      'agency_suspended',
      'This workspace cannot manage billing while suspended. Contact ALZA.',
      403,
    )
  }

  const billing = await getOrCreateBillingRow(admin, String(agency.data.id))
  if (!billing.data) {
    return fail('billing_row_failed', billing.error ?? 'Unable to load billing row.', 500)
  }

  const subscriptionId = (billing.data.razorpay_subscription_id as string | null)?.trim() || ''
  if (!subscriptionId) {
    return fail('no_subscription', 'No Razorpay subscription is linked to this workspace.', 400)
  }

  const status = String(billing.data.status ?? '').toLowerCase()
  if (status === 'cancelled' || status === 'canceled' || status === 'completed') {
    return fail('already_cancelled', 'Subscription is already cancelled or completed.', 400)
  }

  // Incomplete checkout stays resumable until the owner explicitly cancels.
  // Razorpay rejects POST /cancel while the subscription is still `created`.
  if (status === 'created') {
    const remote = await razorpayGetSubscription(subscriptionId)
    if (!remote.ok) {
      return fail(
        'razorpay_lookup_failed',
        remote.message,
        remote.status >= 400 ? remote.status : 500,
      )
    }

    const remoteStatus = String(remote.data.status ?? '').trim().toLowerCase()
    if (!remoteStatus) {
      return fail('razorpay_lookup_failed', 'Razorpay did not return a subscription status.', 502)
    }
    if (createdSubscriptionCancelRoute(remoteStatus) === 'local_cancel') {
      const now = new Date().toISOString()
      const nextStatus = remoteStatus === 'completed' ? 'completed' : 'cancelled'
      const { data: updated, error: updateError } = await admin
        .from('billing_subscriptions')
        .update({
          ...localCreatedCancellationPatch(now),
          status: nextStatus,
        })
        .eq('id', billing.data.id)
        .eq('agency_profile_id', agency.data.id)
        .eq('status', 'created')
        .select('id')

      if (updateError) {
        return fail('billing_persist_failed', updateError.message, 500)
      }
      if (!updated?.length) {
        return fail(
          'cancel_race',
          'Subscription status changed before cancellation was saved. Refresh and try again.',
          409,
        )
      }

      return ok({
        status: nextStatus,
        subscriptionId,
        locallyCancelled: nextStatus === 'cancelled',
      })
    }
  }

  const cancelRes = await razorpayRequest(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancel_at_cycle_end: 0 }),
  })

  if (!cancelRes.ok) {
    return fail('razorpay_cancel_failed', cancelRes.message, cancelRes.status >= 400 ? cancelRes.status : 500)
  }

  const nextStatus = normalizeRazorpayStatus(String(cancelRes.data.status ?? 'cancelled'))
  const endedAt = unixToIso(cancelRes.data.ended_at) ?? new Date().toISOString()

  const { error: updateError } = await admin
    .from('billing_subscriptions')
    .update({
      status: nextStatus,
      canceled_at: endedAt,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', billing.data.id)
    .eq('agency_profile_id', agency.data.id)

  if (updateError) {
    return fail('billing_persist_failed', updateError.message, 500)
  }

  return ok({ status: nextStatus, subscriptionId })
})
