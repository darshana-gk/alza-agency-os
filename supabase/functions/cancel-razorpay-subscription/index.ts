// Deno Edge Function: cancel-razorpay-subscription
// Owner/Admin only.
// Handles both:
// 1. "created" subscriptions where Razorpay Checkout was never completed
// 2. authenticated/active subscriptions that must be cancelled via Razorpay API
//
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_*

import {
  adminClient,
  getOrCreateBillingRow,
  getSingletonAgency,
  requireOwnerOrAdmin,
  razorpayRequest,
  unixToIso,
  normalizeRazorpayStatus,
} from '../_shared/billing.ts'

import { corsHeaders, fail, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  // Handle browser CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const admin = adminClient()

  // Only Owner/Admin may manage billing
  const authz = await requireOwnerOrAdmin(
    admin,
    req.headers.get('Authorization'),
  )

  if (!authz.ok) {
    return authz.response
  }

  // Load ALZA agency
  const agency = await getSingletonAgency(admin)

  if (!agency.data) {
    return fail(
      'agency_missing',
      agency.error ?? 'Agency profile missing.',
      500,
    )
  }

  // Load billing record
  const billing = await getOrCreateBillingRow(
    admin,
    String(agency.data.id),
  )

  if (!billing.data) {
    return fail(
      'billing_row_failed',
      billing.error ?? 'Unable to load billing row.',
      500,
    )
  }

  const subscriptionId =
    (billing.data.razorpay_subscription_id as string | null)?.trim() || ''

  const status = String(
    billing.data.status ?? '',
  )
    .trim()
    .toLowerCase()

  // Already cancelled/completed
  if (
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'completed'
  ) {
    return ok({
      status: 'cancelled',
      subscriptionId: subscriptionId || null,
      alreadyCancelled: true,
    })
  }

  /*
   * IMPORTANT:
   *
   * Razorpay status "created" means the subscription object exists,
   * but Checkout/payment authentication has not been completed.
   *
   * Razorpay may reject an API cancellation request for this state.
   *
   * For ALZA V1 we therefore close the abandoned/incomplete
   * subscription locally so the agency can start checkout again.
   */
  if (status === 'created') {
    const now = new Date().toISOString()

    const { error: updateError } = await admin
      .from('billing_subscriptions')
      .update({
        status: 'cancelled',
        razorpay_subscription_id: null,
        razorpay_plan_id: null,
        plan_key: null,
        current_period_start: null,
        current_period_end: null,
        charge_at: null,
        cancel_at_period_end: false,
        canceled_at: now,
        trial_end: null,
        updated_at: now,
      })
      .eq('id', billing.data.id)

    if (updateError) {
      return fail(
        'billing_persist_failed',
        updateError.message,
        500,
      )
    }

    return ok({
      status: 'cancelled',
      subscriptionId,
      locallyCancelled: true,
    })
  }

  // Any other subscription state must have a Razorpay subscription ID
  if (!subscriptionId) {
    return fail(
      'no_subscription',
      'No Razorpay subscription is linked to this workspace.',
      400,
    )
  }

  /*
   * Authenticated / active / pending / paused / halted subscriptions
   * are cancelled through Razorpay.
   *
   * cancel_at_cycle_end = 0 means cancel immediately.
   */
  const cancelRes = await razorpayRequest(
    `/subscriptions/${subscriptionId}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({
        cancel_at_cycle_end: 0,
      }),
    },
  )

  if (!cancelRes.ok) {
    return fail(
      'razorpay_cancel_failed',
      cancelRes.message,
      cancelRes.status >= 400
        ? cancelRes.status
        : 500,
    )
  }

  const nextStatus = normalizeRazorpayStatus(
    String(cancelRes.data.status ?? 'cancelled'),
  )

  const endedAt =
    unixToIso(cancelRes.data.ended_at) ??
    new Date().toISOString()

  // Save Razorpay result in ALZA database
  const { error: updateError } = await admin
    .from('billing_subscriptions')
    .update({
      status: nextStatus,
      canceled_at: endedAt,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', billing.data.id)

  if (updateError) {
    return fail(
      'billing_persist_failed',
      updateError.message,
      500,
    )
  }

  return ok({
    status: nextStatus,
    subscriptionId,
    locallyCancelled: false,
  })
})
