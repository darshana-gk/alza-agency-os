// Deno Edge Function: razorpay-webhook
// Verifies X-Razorpay-Signature (HMAC SHA256 over raw body).
// Service-role writes; idempotent via billing_webhook_events + x-razorpay-event-id.
// verify_jwt = false

import {
  adminClient,
  asRecord,
  mirrorSubscriptionEntity,
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
