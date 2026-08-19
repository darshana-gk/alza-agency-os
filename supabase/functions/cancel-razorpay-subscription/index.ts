// Deno Edge Function: cancel-razorpay-subscription
// Owner/Admin only. Cancels the workspace Razorpay subscription via API.
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const admin = adminClient()
  const authz = await requireOwnerOrAdmin(admin, req.headers.get('Authorization'))
  if (!authz.ok) return authz.response

  const agency = await getSingletonAgency(admin)
  if (!agency.data) {
    return fail('agency_missing', agency.error ?? 'Agency profile missing.', 500)
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

  // cancel_at_cycle_end=0 → cancel immediately (V1 simple confirmation flow).
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

  if (updateError) {
    return fail('billing_persist_failed', updateError.message, 500)
  }

  return ok({ status: nextStatus, subscriptionId })
})
