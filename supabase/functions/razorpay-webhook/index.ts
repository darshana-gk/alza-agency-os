// Deno Edge Function: razorpay-webhook
// Verifies X-Razorpay-Signature (HMAC SHA256 over raw body).
// Service-role writes; idempotent via billing_webhook_events + x-razorpay-event-id.
// verify_jwt = false

import {
  adminClient,
  asRecord,
  findCancellationPaymentDiscrepancy,
  mirrorSubscriptionEntity,
  type RazorpayCancellationDiscrepancy,
} from '../_shared/billing.ts'
import {
  reconciliationMarkerComplete,
  webhookDiscrepancyRetryAction,
} from '../_shared/razorpayCancellation.ts'
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

function uniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '23505' ||
    (error.message ?? '').toLowerCase().includes('duplicate') ||
    (error.message ?? '').toLowerCase().includes('unique')
  )
}

async function persistDiscrepancyMarker(
  admin: ReturnType<typeof adminClient>,
  eventId: string,
  event: Record<string, unknown>,
  discrepancy: RazorpayCancellationDiscrepancy,
): Promise<boolean> {
  const { data, error } = await admin
    .from('billing_webhook_events')
    .update({
      payload: {
        ...event,
        alza_reconciliation: {
          code: discrepancy.code,
          subscriptionId: discrepancy.subscriptionId,
          agencyProfileId: discrepancy.agencyProfileId,
          localStatus: discrepancy.localStatus,
          remoteStatus: discrepancy.remoteStatus,
          workspaceAccessGranted: false,
        },
      },
    })
    .eq('stripe_event_id', eventId)
    .select('stripe_event_id')
  return !error && (data?.length ?? 0) > 0
}

/**
 * A repeated delivery may finish a missing conflict marker.
 * It does not call the applying mirror, so it cannot activate the subscription again.
 */
async function acknowledgeDuplicateWebhook(
  admin: ReturnType<typeof adminClient>,
  eventId: string,
  event: Record<string, unknown>,
  eventType: string,
  subscriptionEntity: Record<string, unknown> | null,
  handled: Set<string>,
): Promise<Response> {
  const { data: existing, error: loadError } = await admin
    .from('billing_webhook_events')
    .select('payload')
    .eq('stripe_event_id', eventId)
    .maybeSingle()
  if (loadError || !existing) {
    return fail('event_log_failed', 'Unable to confirm the stored webhook event.', 500)
  }

  const markerAlreadyStored = reconciliationMarkerComplete(existing.payload)
  let discrepancyFound = false
  let recordSucceeded: boolean | null = null
  if (!markerAlreadyStored && handled.has(eventType) && subscriptionEntity) {
    const inspected = await findCancellationPaymentDiscrepancy(admin, subscriptionEntity)
    if (!inspected.ok) {
      return fail('reconciliation_record_failed', 'Payment conflict could not be confirmed.', 500)
    }
    discrepancyFound = Boolean(inspected.discrepancy)
    if (inspected.discrepancy) {
      recordSucceeded = await persistDiscrepancyMarker(admin, eventId, event, inspected.discrepancy)
    }
  }

  const action = webhookDiscrepancyRetryAction({
    markerAlreadyStored,
    discrepancyFound,
    recordSucceeded,
  })
  if (action === 'reject') {
    return fail('reconciliation_record_failed', 'Payment conflict was not saved.', 500)
  }
  return ok({ duplicate: true, eventId })
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

  const admin = adminClient()

  const { error: insertEventError } = await admin.from('billing_webhook_events').insert({
    stripe_event_id: eventId,
    event_type: eventType || 'unknown',
    payload: event,
  })

  if (insertEventError) {
    if (uniqueViolation(insertEventError)) {
      return await acknowledgeDuplicateWebhook(
        admin,
        eventId,
        event,
        eventType,
        subscriptionEntity,
        handled,
      )
    }
    return fail('event_log_failed', insertEventError.message, 500)
  }

  try {
    if (handled.has(eventType) && subscriptionEntity) {
      const mirrored = await mirrorSubscriptionEntity(admin, subscriptionEntity)
      if (!mirrored.ok) {
        console.error(`${eventType} mirror:`, mirrored.error)
      } else if (mirrored.discrepancy) {
        console.error('razorpay cancellation discrepancy', mirrored.discrepancy)
        const saved = await persistDiscrepancyMarker(admin, eventId, event, mirrored.discrepancy)
        if (!saved) {
          console.error('razorpay cancellation discrepancy record failed', eventId)
          return fail('reconciliation_record_failed', 'Payment conflict was not saved.', 500)
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed.'
    console.error('razorpay-webhook error', message)
    return fail('handler_failed', message, 500)
  }

  return ok({ received: true, eventId, type: eventType })
})
