// Deno Edge Function: submit-sales-inquiry
// Public ALZA Flow sales form. verify_jwt = false.
// Browser never talks to Resend or the table directly.
// Secrets: RESEND_API_KEY, RESEND_FROM, optional TURNSTILE_SECRET_KEY, optional SALES_NOTIFY_TO.

import { corsHeaders, fail, ok } from '../_shared/http.ts'
import { serviceClient } from '../_shared/opsAuth.ts'

const BANDS = new Set(['51-100', '101-250', '251-500', '500+'])
const SOURCES = new Set(['pricing_contact', 'landing_contact', 'header_contact'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LIMITS = { fullName: 120, workEmail: 254, agencyName: 160, jobTitle: 120, phone: 40, message: 2000, messageMin: 10 }
const ALZA_NOTIFY = 'support@alzabusiness.com'
const RATE_IP_MAX = 5
const RATE_IP_WINDOW_MS = 60 * 60 * 1000
const RATE_EMAIL_MAX = 3
const RATE_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000
const DUP_WINDOW_MS = 12 * 60 * 60 * 1000

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there'
}

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0]?.trim()
  return first || req.headers.get('cf-connecting-ip') || 'unknown'
}

async function sendResend(opts: {
  apiKey: string
  from: string
  to: string[]
  subject: string
  html: string
  text: string
}): Promise<{ ok: true; id: string | null } | { ok: false; message: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
  if (!res.ok) {
    return { ok: false, message: body.message || `Resend HTTP ${res.status}` }
  }
  return { ok: true, id: body.id ?? null }
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = (Deno.env.get('TURNSTILE_SECRET_KEY') ?? '').trim()
  if (!secret) return true
  if (!token) return false
  const body = new URLSearchParams({ secret, response: token, remoteip: ip })
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  })
  const data = (await res.json().catch(() => ({}))) as { success?: boolean }
  return data.success === true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  let raw: Record<string, unknown>
  try {
    raw = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('invalid_json', 'Request body must be JSON.')
  }

  if (String(raw.companyWebsite ?? raw.company_website ?? '').trim()) {
    return fail('rejected', 'Unable to send inquiry.')
  }

  const fullName = String(raw.fullName ?? raw.full_name ?? '').trim().replace(/\s+/g, ' ')
  const workEmail = String(raw.workEmail ?? raw.work_email ?? '').trim().toLowerCase()
  const agencyName = String(raw.agencyName ?? raw.agency_name ?? raw.companyName ?? raw.company_name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  const jobTitle = String(raw.jobTitle ?? raw.job_title ?? '').trim().replace(/\s+/g, ' ')
  const userBand = String(raw.userBand ?? raw.user_band ?? '').trim()
  const phone = String(raw.phone ?? '').trim()
  const message = String(raw.message ?? '').trim()
  const consent = raw.consent === true || raw.consent === 'true'
  const sourceRaw = String(raw.source ?? '').trim()
  const source =
    sourceRaw === 'pricing_contact' || sourceRaw === 'pricing'
      ? 'pricing_contact'
      : sourceRaw === 'header_contact' || sourceRaw === 'header'
        ? 'header_contact'
        : 'landing_contact'

  if (!fullName) return fail('full_name_required', 'Enter your full name.')
  if (fullName.length > LIMITS.fullName) return fail('full_name_too_long', 'Full name is too long.')
  if (!workEmail) return fail('email_required', 'Enter your work email.')
  if (workEmail.length > LIMITS.workEmail || !EMAIL_RE.test(workEmail)) {
    return fail('email_invalid', 'Enter a valid work email.')
  }
  if (!agencyName) return fail('agency_required', 'Enter your company name.')
  if (agencyName.length > LIMITS.agencyName) return fail('agency_too_long', 'Company name is too long.')
  if (!jobTitle) return fail('job_title_required', 'Enter your job title or designation.')
  if (jobTitle.length > LIMITS.jobTitle) return fail('job_title_too_long', 'Job title is too long.')
  if (!BANDS.has(userBand)) return fail('user_band_required', 'Select the number of users.')
  if (phone.length > LIMITS.phone) return fail('phone_too_long', 'Phone number is too long.')
  if (!message) return fail('message_required', 'Tell us a little about what you need.')
  if (message.length < LIMITS.messageMin) return fail('message_too_short', 'Please add a bit more detail so we can help.')
  if (message.length > LIMITS.message) return fail('message_too_long', 'Message is too long.')
  if (!consent) {
    return fail('consent_required', 'Please confirm we may contact you about this inquiry.')
  }
  if (!SOURCES.has(source)) return fail('source_invalid', 'Unable to send inquiry.')

  const ip = clientIp(req)
  const turnstileToken = String(raw.turnstileToken ?? raw.turnstile_token ?? '').trim()
  const turnstileOk = await verifyTurnstile(turnstileToken, ip)
  if (!turnstileOk) return fail('rejected', 'Unable to send inquiry.')

  const ipHash = await sha256(ip)
  const payloadHash = await sha256([workEmail, agencyName, jobTitle, userBand, message].join('|'))
  const admin = serviceClient()
  const now = Date.now()

  const { count: ipCount } = await admin
    .from('sales_inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', new Date(now - RATE_IP_WINDOW_MS).toISOString())
  if ((ipCount ?? 0) >= RATE_IP_MAX) {
    return fail('rate_limited', 'Please wait a few minutes before sending another inquiry.', 429)
  }

  const { count: emailCount } = await admin
    .from('sales_inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('work_email', workEmail)
    .gte('created_at', new Date(now - RATE_EMAIL_WINDOW_MS).toISOString())
  if ((emailCount ?? 0) >= RATE_EMAIL_MAX) {
    return fail('rate_limited', 'Please wait a few minutes before sending another inquiry.', 429)
  }

  const { data: dupes } = await admin
    .from('sales_inquiries')
    .select('id')
    .eq('work_email', workEmail)
    .eq('payload_hash', payloadHash)
    .gte('created_at', new Date(now - DUP_WINDOW_MS).toISOString())
    .limit(1)
  if (dupes && dupes.length > 0) {
    return ok({ received: true, notified: false, acknowledged: false })
  }

  const { data: inserted, error: insertError } = await admin
    .from('sales_inquiries')
    .insert({
      full_name: fullName,
      work_email: workEmail,
      agency_name: agencyName,
      job_title: jobTitle,
      user_band: userBand,
      phone: phone || null,
      message,
      status: 'new',
      source,
      consent: true,
      ip_hash: ipHash,
      payload_hash: payloadHash,
      notification_status: 'pending',
      acknowledgement_status: 'pending',
    })
    .select('id, created_at')
    .single()

  if (insertError || !inserted) {
    return fail('persist_failed', 'Unable to send inquiry.', 500)
  }

  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  const resendFrom = (Deno.env.get('RESEND_FROM') ?? '').trim()
  const notifyTo = (Deno.env.get('SALES_NOTIFY_TO') ?? '').trim() || ALZA_NOTIFY
  const submittedAt = new Date(String(inserted.created_at)).toISOString()

  let notified = false
  let acknowledged = false
  let notificationStatus = 'unavailable'
  let acknowledgementStatus = 'unavailable'

  if (resendKey && resendFrom) {
    const safeName = escapeHtml(fullName)
    const safeTitle = escapeHtml(jobTitle)
    const safeCompany = escapeHtml(agencyName)
    const safeEmail = escapeHtml(workEmail)
    const safePhone = escapeHtml(phone || '—')
    const safeBand = escapeHtml(userBand)
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br />')
    const safeSource = escapeHtml(source)
    const safeWhen = escapeHtml(submittedAt)

    const notify = await sendResend({
      apiKey: resendKey,
      from: resendFrom,
      to: [notifyTo],
      subject: 'New ALZA Flow Inquiry',
      text: [
        'New ALZA Flow Inquiry',
        `Name: ${fullName}`,
        `Job Title / Designation: ${jobTitle}`,
        `Company: ${agencyName}`,
        `Work Email: ${workEmail}`,
        `Phone: ${phone || '—'}`,
        `Number of Users: ${userBand}`,
        `Message: ${message}`,
        `Source: ${source}`,
        `Submitted: ${submittedAt}`,
      ].join('\n'),
      html: `<p><strong>New ALZA Flow Inquiry</strong></p>
<table>
<tr><td>Name</td><td>${safeName}</td></tr>
<tr><td>Job Title / Designation</td><td>${safeTitle}</td></tr>
<tr><td>Company</td><td>${safeCompany}</td></tr>
<tr><td>Work Email</td><td>${safeEmail}</td></tr>
<tr><td>Phone</td><td>${safePhone}</td></tr>
<tr><td>Number of Users</td><td>${safeBand}</td></tr>
<tr><td>Message</td><td>${safeMessage}</td></tr>
<tr><td>Source</td><td>${safeSource}</td></tr>
<tr><td>Submitted</td><td>${safeWhen}</td></tr>
</table>`,
    })
    notified = notify.ok
    notificationStatus = notify.ok ? 'sent' : 'failed'

    const ack = await sendResend({
      apiKey: resendKey,
      from: resendFrom,
      to: [workEmail],
      subject: "We've received your ALZA Flow inquiry",
      text: `Hi ${firstName(fullName)},

Thank you for contacting ALZA about ALZA Flow.

We've received your inquiry and a member of our team will get back to you shortly.

Regards,
ALZA Business Solutions LLP`,
      html: `<p>Hi ${escapeHtml(firstName(fullName))},</p>
<p>Thank you for contacting ALZA about ALZA Flow.</p>
<p>We've received your inquiry and a member of our team will get back to you shortly.</p>
<p>Regards,<br />ALZA Business Solutions LLP</p>`,
    })
    acknowledged = ack.ok
    acknowledgementStatus = ack.ok ? 'sent' : 'failed'
  }

  await admin
    .from('sales_inquiries')
    .update({
      notification_status: notificationStatus,
      acknowledgement_status: acknowledgementStatus,
    })
    .eq('id', inserted.id)

  return ok({
    received: true,
    notified,
    acknowledged,
  })
})
