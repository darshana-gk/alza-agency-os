// Deno Edge Function: notify-support-event
// Best-effort email for support lifecycle events.
// If RESEND_API_KEY / RESEND_FROM missing: skip gracefully (ok:true, skipped:true).
// Never fails the client support write path — callers treat this as fire-and-forget.
// DO NOT deploy until reviewed. verify_jwt = true.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

type SupportEvent =
  | 'request_created'
  | 'customer_replied'
  | 'alza_replied'
  | 'ticket_resolved'
  | 'ticket_reopened'

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function sendResend(input: {
  to: string[]
  subject: string
  text: string
}): Promise<{ sent: boolean; skipped: boolean; message: string }> {
  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  const from =
    (Deno.env.get('RESEND_FROM') ?? '').trim() ||
    (Deno.env.get('SUPPORT_FROM') ?? '').trim()
  if (!resendKey || !from) {
    return {
      sent: false,
      skipped: true,
      message:
        'Support email skipped: RESEND_API_KEY / RESEND_FROM not configured. In-app notifications still apply.',
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
      subject: input.subject,
      text: input.text,
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

  const event = String(body.event ?? '') as SupportEvent
  const conversationId = String(body.conversationId ?? '').trim()
  const allowed: SupportEvent[] = [
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
  const subject = String(conv.subject ?? 'Support request')

  const alzaInbox = (Deno.env.get('ALZA_SUPPORT_NOTIFY_EMAIL') ?? '').trim()
  const appUrl = (Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '').trim() || 'https://alza-agency-os.vercel.app'

  const customerEvents: SupportEvent[] = ['alza_replied', 'ticket_resolved', 'ticket_reopened']
  const alzaEvents: SupportEvent[] = ['request_created', 'customer_replied', 'ticket_reopened']

  const to: string[] = []
  if (customerEvents.includes(event) && customerEmail) to.push(customerEmail)
  if (alzaEvents.includes(event) && alzaInbox) to.push(alzaInbox)

  const titles: Record<SupportEvent, string> = {
    request_created: `New support request from ${agencyName}`,
    customer_replied: `Customer replied — ${agencyName}`,
    alza_replied: `ALZA replied to your support request`,
    ticket_resolved: `Support request resolved`,
    ticket_reopened: `Support request reopened`,
  }

  const link =
    event === 'request_created' || event === 'customer_replied'
      ? `${appUrl}/admin/support-inbox?c=${conversationId}`
      : `${appUrl}/support?c=${conversationId}`

  const result = await sendResend({
    to: [...new Set(to)],
    subject: titles[event],
    text: [
      titles[event],
      '',
      `Agency: ${agencyName}`,
      `Subject: ${subject}`,
      `Status: ${String(conv.status ?? '')}`,
      '',
      `Open in ALZA Flow: ${link}`,
      '',
      'This message contains no credentials.',
    ].join('\n'),
  })

  return ok({
    ok: true,
    skipped: result.skipped,
    delivered: result.sent,
    message: result.message,
    event,
  })
})
