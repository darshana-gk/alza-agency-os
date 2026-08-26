// Deno Edge Function: notify-support-event
// Best-effort email for support lifecycle events.
// If RESEND_API_KEY / from-address missing: skip gracefully (ok:true, skipped:true).
// Never fails the client support write path — callers treat this as fire-and-forget.
// DO NOT deploy until reviewed (Resend/DNS still externally blocked). verify_jwt = true.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { corsHeaders, fail, ok } from '../_shared/http.ts'
import {
  SUPPORT_EMAIL_ADDRESS,
  SUPPORT_EMAIL_IDENTITY,
  buildSupportEmailTemplate,
  type SupportEmailEvent,
} from '../_shared/supportEmailTemplates.ts'

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function resolveFromAddress(): string {
  const configured =
    (Deno.env.get('RESEND_FROM') ?? '').trim() ||
    (Deno.env.get('SUPPORT_FROM') ?? '').trim()
  if (configured) return configured
  // Preferred identity when domain is verified; still requires RESEND_API_KEY to send.
  return SUPPORT_EMAIL_IDENTITY
}

async function sendResend(input: {
  to: string[]
  subject: string
  text: string
  html: string
}): Promise<{ sent: boolean; skipped: boolean; message: string }> {
  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  const from = resolveFromAddress()
  if (!resendKey) {
    return {
      sent: false,
      skipped: true,
      message:
        'Support email skipped: RESEND_API_KEY not configured (DNS/Resend externally blocked). In-app notifications still apply.',
    }
  }
  if (!from) {
    return {
      sent: false,
      skipped: true,
      message: 'Support email skipped: from address not configured.',
    }
  }
  if (input.to.length === 0) {
    return { sent: false, skipped: true, message: 'No recipients.' }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      reply_to: SUPPORT_EMAIL_ADDRESS,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('Resend support email failed', res.status, body.slice(0, 300))
    return {
      sent: false,
      skipped: true,
      message: `Resend failed HTTP ${res.status}. Support message was not blocked.`,
    }
  }
  return { sent: true, skipped: false, message: 'Email queued.' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  let body: { event?: string; conversationId?: string } = {}
  try {
    body = (await req.json()) as { event?: string; conversationId?: string }
  } catch {
    return fail('invalid_body', 'JSON body required.')
  }

  const event = String(body.event ?? '') as SupportEmailEvent
  const conversationId = String(body.conversationId ?? '').trim()
  const allowed: SupportEmailEvent[] = [
    'request_created',
    'customer_replied',
    'alza_replied',
    'ticket_resolved',
    'ticket_reopened',
  ]
  if (!allowed.includes(event) || !conversationId) {
    return fail('invalid_body', 'event and conversationId are required.', 400)
  }

  const admin = adminClient()
  const { data: conv, error } = await admin
    .from('support_conversations')
    .select(
      `
      id, subject, status, category, agency_profile_id, created_by_user_id,
      agency_profile:agency_profile_id ( agency_name, email ),
      creator:created_by_user_id ( email, full_name )
    `,
    )
    .eq('id', conversationId)
    .maybeSingle()

  if (error || !conv) {
    // Soft-fail — do not break callers.
    return ok({
      skipped: true,
      message: error?.message || 'Conversation not found for email notify.',
    })
  }

  const agency = Array.isArray(conv.agency_profile) ? conv.agency_profile[0] : conv.agency_profile
  const creator = Array.isArray(conv.creator) ? conv.creator[0] : conv.creator
  const customerEmail = String((creator as { email?: string } | null)?.email ?? '').trim()
  const agencyName = String((agency as { agency_name?: string } | null)?.agency_name ?? 'Agency')
  const ticketSubject = String(conv.subject ?? 'Support request')
  const status = String(conv.status ?? '')

  const alzaInbox =
    (Deno.env.get('ALZA_SUPPORT_NOTIFY_EMAIL') ?? '').trim() || SUPPORT_EMAIL_ADDRESS
  const appUrl =
    (Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '').trim() ||
    'https://alza-agency-os.vercel.app'

  const customerEvents: SupportEmailEvent[] = ['alza_replied', 'ticket_resolved', 'ticket_reopened']
  const alzaEvents: SupportEmailEvent[] = [
    'request_created',
    'customer_replied',
    'ticket_resolved',
    'ticket_reopened',
  ]

  const deliveries: Array<{ audience: 'customer' | 'alza'; to: string; link: string }> = []
  if (customerEvents.includes(event) && customerEmail) {
    deliveries.push({
      audience: 'customer',
      to: customerEmail,
      link: `${appUrl}/support?c=${conversationId}`,
    })
  }
  if (alzaEvents.includes(event) && alzaInbox) {
    deliveries.push({
      audience: 'alza',
      to: alzaInbox,
      link: `${appUrl}/admin/support-inbox?c=${conversationId}`,
    })
  }

  if (deliveries.length === 0) {
    return ok({
      ok: true,
      skipped: true,
      delivered: false,
      message: 'No recipients for this support email event.',
      event,
    })
  }

  let anySent = false
  let lastMessage = 'ok'
  for (const d of deliveries) {
    const template = buildSupportEmailTemplate({
      event,
      agencyName,
      subject: ticketSubject,
      status,
      appLink: d.link,
      recipientAudience: d.audience,
    })
    const result = await sendResend({
      to: [d.to],
      subject: template.subject,
      text: template.text,
      html: template.html,
    })
    lastMessage = result.message
    if (result.sent) anySent = true
  }

  return ok({
    ok: true,
    skipped: !anySent,
    delivered: anySent,
    message: lastMessage,
    event,
  })
})
