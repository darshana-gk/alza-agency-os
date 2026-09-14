// Deno Edge Function: sync-razorpay-subscription
// Owner/Admin only. GET-only recovery when Razorpay is authoritative but a webhook was missed.
// Never creates, cancels, pauses, resumes, or charges a subscription.
// Never trusts a client-supplied subscription_id or agency_profile_id.
// verify_jwt = true

import {
  adminClient,
  asRecord,
  getCallerAgency,
  getExistingBillingRow,
  mirrorSubscriptionEntity,
  normalizeRazorpayStatus,
  razorpayGetSubscription,
  requireOwnerOrAdmin,
  resolveRazorpayPlanId,
} from '../_shared/billing.ts'
import {
  isBillingCheckoutSku,
  isLegacyBillingPlanKey,
  resolveRazorpayPlanIdForSku,
} from '../_shared/billingCatalog.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

function requireStagingTestKey(keyId: string): Response | null {
  const appUrl = (Deno.env.get('APP_URL') ?? '').trim()
  const stagingHost = /alza-flow-staging/i.test(appUrl) || /staging/i.test(appUrl)
  if (!stagingHost) return null
  if (keyId.startsWith('rzp_live_')) {
    return fail(
      'live_key_blocked',
      'Sync refused: LIVE Razorpay key detected on staging. Use TEST credentials.',
      503,
    )
  }
  if (!keyId.startsWith('rzp_test_')) {
    return fail(
      'misconfigured',
      'RAZORPAY_KEY_ID must be a Razorpay TEST key (rzp_test_…) on staging.',
      503,
    )
  }
  return null
}

function planIdForStoredKey(planKey: string): { planId: string } | { error: string } {
  if (isBillingCheckoutSku(planKey)) {
    const resolved = resolveRazorpayPlanIdForSku(planKey)
    if ('error' in resolved) return { error: resolved.error }
    return { planId: resolved.planId }
  }
  if (isLegacyBillingPlanKey(planKey)) {
    const resolved = resolveRazorpayPlanId(planKey)
    if ('error' in resolved) return { error: resolved.error }
    return { planId: resolved.planId }
  }
  return { error: 'Stored plan key is not a known ALZA billing plan.' }
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
  const stagingBlock = requireStagingTestKey(keyId)
  if (stagingBlock) return stagingBlock

  const admin = adminClient()
  const authz = await requireOwnerOrAdmin(admin, req.headers.get('Authorization'))
  if (!authz.ok) return authz.response

  const agency = await getCallerAgency(admin, authz.agencyProfileId)
  if (!agency.data) {
    return fail('agency_missing', agency.error ?? 'Agency profile missing.', 400)
  }

  const billing = await getExistingBillingRow(admin, String(agency.data.id))
  if (!billing.data) {
    return fail('billing_row_failed', billing.error ?? 'Unable to load billing row.', 400)
  }

  const storedId = String(billing.data.razorpay_subscription_id ?? '').trim()
  if (!storedId) {
    return fail(
      'no_subscription',
      'No Razorpay subscription is linked to this workspace.',
      400,
    )
  }

  const storedPlanId = String(billing.data.razorpay_plan_id ?? '').trim()
  const storedPlanKey = String(billing.data.plan_key ?? '').trim().toLowerCase()
  if (!storedPlanId || !storedPlanKey) {
    return fail('plan_mismatch', 'Stored Razorpay plan is incomplete.', 409)
  }

  const mapped = planIdForStoredKey(storedPlanKey)
  if ('error' in mapped) {
    return fail('plan_mismatch', mapped.error, 409)
  }
  if (mapped.planId !== storedPlanId) {
    return fail(
      'plan_mismatch',
      'Stored plan key does not match the stored Razorpay plan id.',
      409,
    )
  }

  const remote = await razorpayGetSubscription(storedId)
  if (!remote.ok) {
    return fail(
      'razorpay_lookup_failed',
      remote.message,
      remote.status >= 400 ? remote.status : 500,
    )
  }

  const remoteId = String(remote.data.id ?? '').trim()
  if (remoteId !== storedId) {
    return fail('subscription_mismatch', 'Razorpay subscription id does not match this workspace.', 403)
  }

  const remotePlanId = String(remote.data.plan_id ?? '').trim()
  if (remotePlanId !== storedPlanId || remotePlanId !== mapped.planId) {
    return fail('plan_mismatch', 'Razorpay plan id does not match this workspace plan.', 409)
  }

  const notes = asRecord(remote.data.notes) ?? {}
  const noteAgency = String(notes.agency_profile_id ?? '').trim()
  if (noteAgency && noteAgency !== String(agency.data.id)) {
    return fail('tenant_mismatch', 'Subscription does not belong to this workspace.', 403)
  }

  const remoteStatus = normalizeRazorpayStatus(String(remote.data.status ?? ''))
  const mirrored = await mirrorSubscriptionEntity(admin, remote.data)
  if (!mirrored.ok) {
    return fail('mirror_failed', mirrored.error, 500)
  }

  return ok({
    synced: true,
    status: remoteStatus,
    remoteStatus,
    subscriptionId: storedId,
    mirrored: true,
    workspaceUnlock: remoteStatus === 'active',
  })
})
