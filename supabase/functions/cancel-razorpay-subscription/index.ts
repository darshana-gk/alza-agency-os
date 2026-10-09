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
  cancellationConfirmationEmail,
  classifyCycleEndCancelFailure,
  createdSubscriptionCancelRoute,
  cycleEndCancelRequestBody,
  immediateCancelRequestBody,
  localCreatedCancellationPatch,
  planCycleEndCancellation,
  unixSecondsToIso,
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

  const storedPaidThrough =
    typeof billing.data.current_period_end === 'string' ? billing.data.current_period_end : null
  if (billing.data.cancel_at_period_end === true && storedPaidThrough) {
    return ok({
      status,
      subscriptionId,
      cancelAtPeriodEnd: true,
      paidThrough: storedPaidThrough,
      chargeConfirmedStopped: false,
      emailSent: false,
      emailStatus: 'already_scheduled',
    })
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

  const preCharge = (status === 'authenticated' || status === 'pending') && !storedPaidThrough
  const cancelRes = await razorpayRequest(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(preCharge ? immediateCancelRequestBody() : cycleEndCancelRequestBody()),
  })

  if (!cancelRes.ok) {
    const failure = classifyCycleEndCancelFailure(cancelRes.message)
    if (failure === 'no_active_cycle' && preCharge) {
      return fail(
        'razorpay_cancel_failed',
        cancelRes.message,
        cancelRes.status >= 400 ? cancelRes.status : 500,
      )
    }
    if (failure === 'no_active_cycle') {
      return fail(
        'no_active_cycle',
        'Razorpay has not confirmed an active paid period, so the renewal was not stopped.',
        409,
      )
    }
    if (failure === 'final_cycle' || failure === 'already_cancelled') {
      const remote = await razorpayGetSubscription(subscriptionId)
      if (!remote.ok) {
        return fail(
          'paid_through_unconfirmed',
          'Razorpay did not confirm the paid-through date. The renewal has not been confirmed as stopped.',
          502,
        )
      }
      return await storeScheduledCancellation(admin, {
        billingId: String(billing.data.id),
        agencyProfileId: String(agency.data.id),
        subscriptionId,
        remote: remote.data,
        fallbackStatus: status,
        recipientEmail: await ownerEmail(admin, authz.authUserId),
      })
    }
    return fail('razorpay_cancel_failed', cancelRes.message, cancelRes.status >= 400 ? cancelRes.status : 500)
  }

  return await storeScheduledCancellation(admin, {
    billingId: String(billing.data.id),
    agencyProfileId: String(agency.data.id),
    subscriptionId,
    remote: cancelRes.data,
    fallbackStatus: status,
    recipientEmail: await ownerEmail(admin, authz.authUserId),
    allowImmediatePreCharge: preCharge,
  })
})

async function ownerEmail(admin: ReturnType<typeof adminClient>, userId: string): Promise<string | null> {
  const { data, error } = await admin.from('users').select('email').eq('id', userId).maybeSingle()
  if (error) return null
  const email = String(data?.email ?? '').trim()
  return email || null
}

async function storeScheduledCancellation(
  admin: ReturnType<typeof adminClient>,
  input: {
    billingId: string
    agencyProfileId: string
    subscriptionId: string
    remote: Record<string, unknown>
    fallbackStatus: string
    recipientEmail: string | null
    allowImmediatePreCharge?: boolean
  },
): Promise<Response> {
  const nowIso = new Date().toISOString()
  const remoteStatus = normalizeRazorpayStatus(String(input.remote.status ?? input.fallbackStatus))
  if (input.allowImmediatePreCharge && !unixSecondsToIso(input.remote.current_end)) {
    const endedAt = unixToIso(input.remote.ended_at) ?? nowIso
    const { error } = await admin
      .from('billing_subscriptions')
      .update({
        status: remoteStatus === 'completed' ? 'completed' : 'cancelled',
        canceled_at: endedAt,
        cancel_at_period_end: false,
        updated_at: nowIso,
      })
      .eq('id', input.billingId)
      .eq('agency_profile_id', input.agencyProfileId)
    if (error) return fail('billing_persist_failed', error.message, 500)
    return ok({
      status: 'cancelled',
      subscriptionId: input.subscriptionId,
      cancelAtPeriodEnd: false,
      paidThrough: null,
      chargeConfirmedStopped: false,
      emailSent: false,
      emailStatus: 'not_applicable',
    })
  }

  const plan = planCycleEndCancellation({
    remoteStatus,
    currentEndUnix: input.remote.current_end,
    nowIso,
  })
  if (plan.action === 'unconfirmed') {
    return fail(
      'paid_through_unconfirmed',
      'Razorpay did not confirm the paid-through date. The renewal has not been confirmed as stopped.',
      502,
    )
  }
  if (plan.action === 'already_ended') {
    const { error } = await admin
      .from('billing_subscriptions')
      .update({
        status: plan.statusToStore,
        canceled_at: unixToIso(input.remote.ended_at) ?? nowIso,
        cancel_at_period_end: false,
        current_period_end: unixSecondsToIso(input.remote.current_end),
        updated_at: nowIso,
      })
      .eq('id', input.billingId)
      .eq('agency_profile_id', input.agencyProfileId)
    if (error) return fail('billing_persist_failed', error.message, 500)
    return ok({
      status: plan.statusToStore,
      subscriptionId: input.subscriptionId,
      cancelAtPeriodEnd: false,
      paidThrough: unixSecondsToIso(input.remote.current_end),
      chargeConfirmedStopped: false,
      emailSent: false,
      emailStatus: 'period_ended',
    })
  }

  const { error } = await admin
    .from('billing_subscriptions')
    .update({
      status: plan.statusToStore,
      cancel_at_period_end: true,
      current_period_end: plan.paidThroughIso,
      current_period_start: unixToIso(input.remote.current_start),
      updated_at: nowIso,
    })
    .eq('id', input.billingId)
    .eq('agency_profile_id', input.agencyProfileId)
  if (error) return fail('billing_persist_failed', error.message, 500)

  const email = await sendCancellationConfirmation(input.recipientEmail, plan.paidThroughIso)
  return ok({
    status: plan.statusToStore,
    subscriptionId: input.subscriptionId,
    cancelAtPeriodEnd: true,
    paidThrough: plan.paidThroughIso,
    chargeConfirmedStopped: false,
    emailSent: email.sent,
    emailStatus: email.status,
  })
}

async function sendCancellationConfirmation(
  recipient: string | null,
  paidThroughIso: string,
): Promise<{ sent: boolean; status: string }> {
  const apiKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  const from = (Deno.env.get('RESEND_FROM') ?? '').trim()
  if (!apiKey || !from || !recipient) return { sent: false, status: 'not_configured' }
  const paidThroughLabel = paidThroughIso.slice(0, 10)
  const message = cancellationConfirmationEmail(paidThroughLabel)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: message.subject,
      text: message.text,
    }),
  }).catch(() => null)
  if (!response?.ok) return { sent: false, status: 'not_sent' }
  return { sent: true, status: 'sent' }
}
