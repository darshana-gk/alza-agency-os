// Deno Edge Function: create-razorpay-subscription
// Owner/Admin only. Creates a Razorpay Subscription for ALZA FLOW.
// Body: { plan: "essential" | "professional" }
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_PLAN_*, APP_URL, SUPABASE_*

import {
  adminClient,
  getOrCreateBillingRow,
  getSingletonAgency,
  hasBlockingSubscription,
  requireOwnerOrAdmin,
  resolveRazorpayPlanId,
  razorpayRequest,
} from '../_shared/billing.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

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

  let body: { plan?: unknown } = {}
  try {
    body = (await req.json()) as { plan?: unknown }
  } catch {
    return fail('invalid_body', 'JSON body with plan is required.')
  }

  const planRaw = typeof body.plan === 'string' ? body.plan : ''
  const resolved = resolveRazorpayPlanId(planRaw)
  if ('error' in resolved) {
    return fail('invalid_plan', resolved.error, 400)
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

  const existingStatus = String(billing.data.status ?? '')
  const existingSubId = (billing.data.razorpay_subscription_id as string | null)?.trim() || ''
  if (existingSubId && hasBlockingSubscription(existingStatus)) {
    return fail(
      'subscription_exists',
      `Workspace already has a ${existingStatus} Razorpay subscription. Cancel it before starting a new one.`,
      409,
    )
  }

  // total_count: long-running monthly subscription (10 years). Adjust later if needed.
  const createRes = await razorpayRequest('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: resolved.planId,
      total_count: 120,
      customer_notify: 1,
      notes: {
        agency_profile_id: String(agency.data.id),
        alza_product: 'alza_flow',
        alza_plan: resolved.plan,
      },
    }),
  })

  if (!createRes.ok) {
    return fail('razorpay_create_failed', createRes.message, createRes.status >= 400 ? createRes.status : 500)
  }

  const subscriptionId = String(createRes.data.id ?? '')
  if (!subscriptionId) {
    return fail('razorpay_create_failed', 'Razorpay did not return a subscription id.', 500)
  }

  const customerId =
    typeof createRes.data.customer_id === 'string' ? createRes.data.customer_id : null

  const { error: updateError } = await admin
    .from('billing_subscriptions')
    .update({
      razorpay_subscription_id: subscriptionId,
      razorpay_customer_id: customerId,
      razorpay_plan_id: resolved.planId,
      plan_key: resolved.plan,
      status: 'created',
      canceled_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', billing.data.id)

  if (updateError) {
    return fail('billing_persist_failed', updateError.message, 500)
  }

  // Public key id is required by Razorpay Checkout (not a secret).
  return ok({
    subscriptionId,
    keyId,
    plan: resolved.plan,
    agencyName: String(agency.data.agency_name ?? 'ALZA Flow Workspace'),
  })
})
