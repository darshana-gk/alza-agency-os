// Deno Edge Function: create-razorpay-subscription
// Owner/Admin only. Creates a Razorpay Subscription for ALZA FLOW.
// Body: { product, userBand, interval } — never amounts or Razorpay plan IDs from browser.
// Resolves caller's agency_profile_id (not singleton). Never sets lifecycle=active.

import {
  adminClient,
  agencyLifecycleAllowsBilling,
  getCallerAgency,
  getOrCreateBillingRow,
  hasBlockingSubscription,
  requireOwnerOrAdmin,
  razorpayRequest,
} from '../_shared/billing.ts'
import {
  parseCheckoutSelection,
  resolveRazorpayPlanIdForSku,
  razorpayTotalCount,
} from '../_shared/billingCatalog.ts'
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

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('invalid_body', 'JSON body is required.')
  }

  const selection = parseCheckoutSelection(body)
  if ('error' in selection) {
    return fail('invalid_plan', selection.error, 400)
  }

  const resolved = resolveRazorpayPlanIdForSku(selection.sku)
  if ('error' in resolved) {
    return fail('plan_secret_missing', resolved.error, 503)
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
      'This workspace cannot start billing checkout while suspended. Contact ALZA.',
      403,
    )
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

  const createRes = await razorpayRequest('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: resolved.planId,
      total_count: razorpayTotalCount(selection.interval),
      customer_notify: 1,
      notes: {
        agency_profile_id: String(agency.data.id),
        alza_product: 'alza_flow',
        alza_plan: selection.sku,
        alza_user_band: selection.userBand,
        alza_interval: selection.interval,
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

  const includedUsers =
    selection.userBand === 'users_1_3'
      ? 3
      : selection.userBand === 'users_4_10'
        ? 10
        : selection.userBand === 'users_11_25'
          ? 25
          : selection.userBand === 'users_26_50'
            ? 50
            : selection.userBand === 'users_51_100'
              ? 100
              : null

  const { error: updateError } = await admin
    .from('billing_subscriptions')
    .update({
      razorpay_subscription_id: subscriptionId,
      razorpay_customer_id: customerId,
      razorpay_plan_id: resolved.planId,
      plan_key: selection.sku,
      product_key: selection.product,
      user_band_key: selection.userBand,
      billing_interval: selection.interval,
      included_users: includedUsers,
      status: 'created',
      canceled_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', billing.data.id)

  if (updateError) {
    if (/product_key|user_band_key|billing_interval|included_users|plan_key/i.test(updateError.message)) {
      const { error: coreError } = await admin
        .from('billing_subscriptions')
        .update({
          razorpay_subscription_id: subscriptionId,
          razorpay_customer_id: customerId,
          razorpay_plan_id: resolved.planId,
          plan_key: selection.sku,
          status: 'created',
          canceled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', billing.data.id)
      if (coreError) {
        return fail('billing_persist_failed', coreError.message, 500)
      }
    } else {
      return fail('billing_persist_failed', updateError.message, 500)
    }
  }

  // Prospect → billing_pending on checkout start. Never set lifecycle=active here.
  const life = String(agency.data.lifecycle ?? '').trim().toLowerCase()
  if (life === 'prospect') {
    await admin
      .from('agency_profile')
      .update({ lifecycle: 'billing_pending', updated_at: new Date().toISOString() })
      .eq('id', agency.data.id)
      .eq('lifecycle', 'prospect')
  }

  return ok({
    subscriptionId,
    keyId,
    planKey: selection.sku,
    agencyName: String(agency.data.agency_name ?? 'ALZA Flow Workspace'),
  })
})
