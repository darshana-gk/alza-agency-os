// Deno Edge Function: razorpay-webhook
// Verifies X-Razorpay-Signature (HMAC SHA256 over raw body).
// Service-role writes; idempotent via billing_webhook_events + x-razorpay-event-id.
// verify_jwt = false

import {
  adminClient,
  normalizeRazorpayStatus,
  unixToIso,
} from '../_shared/billing.ts'
import { fail, ok } from '../_shared/http.ts'

async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const digest = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return digest === signature
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

async function mirrorSubscriptionEntity(
  admin: ReturnType<typeof adminClient>,
  subscription: Record<string, unknown>,
) {
  const subscriptionId = String(subscription.id ?? '').trim()
  if (!subscriptionId) return { ok: false as const, error: 'Missing subscription id' }

  const notes = asRecord(subscription.notes) ?? {}
  const agencyFromNotes = String(notes.agency_profile_id ?? '').trim() || null
  const planKeyRaw = String(notes.alza_plan ?? '').trim().toLowerCase()
  const planKey = planKeyRaw || null

  const payload: Record<string, unknown> = {
    razorpay_subscription_id: subscriptionId,
    razorpay_customer_id:
      typeof subscription.customer_id === 'string' ? subscription.customer_id : null,
    razorpay_plan_id: typeof subscription.plan_id === 'string' ? subscription.plan_id : null,
    status: normalizeRazorpayStatus(String(subscription.status ?? '')),
    current_period_start: unixToIso(subscription.current_start),
    current_period_end: unixToIso(subscription.current_end),
    charge_at: unixToIso(subscription.charge_at),
    trial_end: null,
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }

  if (planKey) payload.plan_key = planKey
  const productKey = String(notes.alza_product ?? '').trim() || null
  const userBand = String(notes.alza_user_band ?? '').trim() || null
  const interval = String(notes.alza_interval ?? '').trim() || null
  if (productKey) payload.product_key = productKey
  if (userBand) payload.user_band_key = userBand
  if (interval) payload.billing_interval = interval

  const status = String(payload.status)
  if (status === 'cancelled' || status === 'completed') {
    payload.canceled_at = unixToIso(subscription.ended_at) ?? new Date().toISOString()
  }

  const bySub = await admin
    .from('billing_subscriptions')
    .update(payload)
    .eq('razorpay_subscription_id', subscriptionId)
    .select('id')
  if (!bySub.error && (bySub.data?.length ?? 0) > 0) return { ok: true as const }

  const customerId =
    typeof subscription.customer_id === 'string' ? subscription.customer_id : null
  if (customerId) {
    const byCustomer = await admin
      .from('billing_subscriptions')
      .update(payload)
      .eq('razorpay_customer_id', customerId)
      .select('id')
    if (!byCustomer.error && (byCustomer.data?.length ?? 0) > 0) return { ok: true as const }
  }

  if (agencyFromNotes) {
    const byAgency = await admin
      .from('billing_subscriptions')
      .update(payload)
      .eq('agency_profile_id', agencyFromNotes)
      .select('id')
    if (!byAgency.error && (byAgency.data?.length ?? 0) > 0) return { ok: true as const }
  }

  return {
    ok: false as const,
    error: 'No billing_subscriptions row matched this Razorpay subscription.',
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const webhookSecret = (Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '').trim()
  if (!webhookSecret) {
    return fail('misconfigured', 'RAZORPAY_WEBHOOK_SECRET is not set.', 500)
  }

  const signature = req.headers.get('x-razorpay-signature') ?? ''
  if (!signature) {
    return fail('missing_signature', 'Missing X-Razorpay-Signature header.', 400)
  }

  const rawBody = await req.text()
  const valid = await verifySignature(rawBody, signature, webhookSecret)
  if (!valid) {
    return fail('invalid_signature', 'Invalid Razorpay webhook signature.', 400)
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return fail('invalid_json', 'Webhook body is not valid JSON.', 400)
  }

  const eventType = String(event.event ?? '')
  const eventIdHeader = (req.headers.get('x-razorpay-event-id') ?? '').trim()
  const payloadEntity = asRecord(event.payload)
  const subscriptionWrapper = asRecord(payloadEntity?.subscription)
  const subscriptionEntity = asRecord(subscriptionWrapper?.entity) ?? asRecord(payloadEntity?.subscription)
  const fallbackId = subscriptionEntity?.id
    ? `razorpay:${eventType}:${String(subscriptionEntity.id)}:${String(event.created_at ?? '')}`
    : `razorpay:${eventType}:${crypto.randomUUID()}`
  const eventId = eventIdHeader || fallbackId

  const admin = adminClient()

  const { error: insertEventError } = await admin.from('billing_webhook_events').insert({
    stripe_event_id: eventId,
    event_type: eventType || 'unknown',
    payload: event,
  })

  if (insertEventError) {
    if (
      insertEventError.code === '23505' ||
      insertEventError.message.toLowerCase().includes('duplicate') ||
      insertEventError.message.toLowerCase().includes('unique')
    ) {
      return ok({ duplicate: true, eventId })
    }
    return fail('event_log_failed', insertEventError.message, 500)
  }

  const handled = new Set([
    'subscription.authenticated',
    'subscription.activated',
    'subscription.charged',
    'subscription.pending',
    'subscription.halted',
    'subscription.cancelled',
    'subscription.completed',
    'subscription.paused',
    'subscription.resumed',
    'subscription.updated',
  ])

  try {
    if (handled.has(eventType) && subscriptionEntity) {
      const mirrored = await mirrorSubscriptionEntity(admin, subscriptionEntity)
      if (!mirrored.ok) {
        console.error(`${eventType} mirror:`, mirrored.error)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed.'
    console.error('razorpay-webhook error', message)
    return fail('handler_failed', message, 500)
  }

  return ok({ received: true, eventId, type: eventType })
})
