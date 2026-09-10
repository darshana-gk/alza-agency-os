// Deno Edge Function: resume-razorpay-checkout
// Owner/Admin only. Reopens Standard Checkout for an EXISTING unpaid Razorpay
// subscription already linked to the caller's agency. Never creates a new
// Razorpay subscription. Never trusts client-supplied subscription_id.

import {
  adminClient,
  agencyLifecycleAllowsBilling,
  getCallerAgency,
  getOrCreateBillingRow,
  requireOwnerOrAdmin,
  razorpayRequest,
} from '../_shared/billing.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

/** Statuses where Standard Checkout may still be opened for the same subscription. */
function canResumeStatus(status: string): boolean {
  const v = status.trim().toLowerCase()
  return v === 'created'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const keyId = (Deno.env.get('RAZORPAY_KEY_ID') ?? '').trim()
  if (!keyId) {
    return fail('misconfigured', 'RAZORPAY_KEY_ID is not set.', 500)
  }
  const appUrl = (Deno.env.get('APP_URL') ?? '').trim()
  const stagingHost =
    /alza-flow-staging/i.test(appUrl) || /staging/i.test(appUrl)
  // Hard safety on staging: never resume with LIVE keys.
  if (stagingHost && keyId.startsWith('rzp_live_')) {
    return fail(
      'live_key_blocked',
      'Resume checkout refused: LIVE Razorpay key detected on staging. Use TEST credentials.',
      503,
    )
  }
  if (stagingHost && !keyId.startsWith('rzp_test_')) {
    return fail(
      'misconfigured',
      'RAZORPAY_KEY_ID must be a Razorpay TEST key (rzp_test_…) on staging.',
      503,
    )
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
      'This workspace cannot resume billing checkout while suspended. Contact ALZA.',
      403,
    )
  }

  const billing = await getOrCreateBillingRow(admin, String(agency.data.id))
  if (!billing.data) {
    return fail('billing_row_failed', billing.error ?? 'Unable to load billing row.', 500)
  }

  const status = String(billing.data.status ?? '')
  const subscriptionId = (billing.data.razorpay_subscription_id as string | null)?.trim() || ''

  if (!subscriptionId) {
    return fail(
      'no_subscription',
      'No Razorpay subscription is linked to this workspace. Start checkout first.',
      400,
    )
  }

  if (!canResumeStatus(status)) {
    return fail(
      'resume_not_allowed',
      status.trim().toLowerCase() === 'active'
        ? 'Subscription is already active. Resume Payment is not available.'
        : `Cannot resume checkout while subscription status is ${status}.`,
      409,
    )
  }

  // Confirm the Razorpay entity still exists and belongs to this unpaid state.
  // subscription_id always comes from the agency's own billing row — never from the client body.
  const remote = await razorpayRequest(`/subscriptions/${subscriptionId}`, { method: 'GET' })
  if (!remote.ok) {
    return fail(
      'razorpay_lookup_failed',
      remote.message,
      remote.status >= 400 ? remote.status : 500,
    )
  }

  const remoteStatus = String(remote.data.status ?? '').trim().toLowerCase()
  if (remoteStatus === 'active' || remoteStatus === 'cancelled' || remoteStatus === 'canceled' || remoteStatus === 'completed') {
    return fail(
      'resume_not_allowed',
      `Razorpay subscription is ${remoteStatus}. Resume Payment is not available.`,
      409,
    )
  }

  const notes = (remote.data.notes ?? {}) as Record<string, unknown>
  const noteAgency = typeof notes.agency_profile_id === 'string' ? notes.agency_profile_id.trim() : ''
  if (noteAgency && noteAgency !== String(agency.data.id)) {
    return fail('tenant_mismatch', 'Subscription does not belong to this workspace.', 403)
  }

  return ok({
    subscriptionId,
    keyId,
    planKey: String(billing.data.plan_key ?? ''),
    agencyName: String(agency.data.agency_name ?? 'ALZA Flow Workspace'),
    resumed: true,
    status: status.trim().toLowerCase() || 'created',
  })
})
