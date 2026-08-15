// Deno Edge Function: notify-transaction-review
// Assigned-reviewer email (submit) + CSR correction email (return).
// Never expose RESEND_API_KEY or service_role to the Vite frontend.
//
// Deploy:
//   npx supabase functions deploy notify-transaction-review
//
// Secrets:
//   APP_URL / SITE_URL
//   RESEND_API_KEY
//   RESEND_FROM  (verified sender, e.g. ALZA Flow <notifications@your-verified-domain>)
//
// Body:
//   { "transactionId": "<uuid>", "action": "submitted" | "returned" }
//
// Response always includes emailed + email_code + email_message (never fakes success).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fail(code: string, message: string, status = 400) {
  return new Response(
    JSON.stringify({
      ok: false,
      code,
      message,
      emailed: false,
      email_code: code,
      email_message: message,
    }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function resolveAppOrigin(): { origin: string | null; error: string | null } {
  const raw = (Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '').trim()
  if (!raw) {
    return {
      origin: null,
      error:
        'Server misconfigured: set Edge Function secret APP_URL (or SITE_URL) to the ALZA Flow public origin, e.g. http://localhost:5173',
    }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { origin: null, error: 'APP_URL / SITE_URL must be a valid absolute URL.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { origin: null, error: 'APP_URL / SITE_URL must use http or https.' }
  }
  return { origin: `${url.protocol}//${url.host}`, error: null }
}

function money(value: unknown): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function display(value: unknown): string {
  const v = String(value ?? '').trim()
  return v || '—'
}

function typeLabel(type: unknown): string {
  const t = String(type ?? '').trim()
  const map: Record<string, string> = {
    new_policy_premium: 'New Business',
    renewal_premium: 'Renewal Premium',
    endorsement_premium: 'Endorsement',
    audit_premium: 'Audit',
    return_premium: 'Return Premium',
  }
  return map[t] || t || '—'
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

async function authorizeCaller(adminClient: SupabaseClient, authHeader: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user: callerAuth },
    error: callerAuthError,
  } = await callerClient.auth.getUser()

  if (callerAuthError || !callerAuth) {
    return { error: fail('unauthorized', 'Unauthorized.', 401) }
  }

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('users')
    .select('id, full_name, email, role, status, archived_at')
    .eq('auth_user_id', callerAuth.id)
    .maybeSingle()

  if (callerProfileError) {
    return {
      error: fail(
        'caller_profile_load_failed',
        `Unable to load caller profile: ${callerProfileError.message}`,
        500,
      ),
    }
  }

  const callerRole = String(callerProfile?.role ?? '').toLowerCase()
  const callerActive =
    callerProfile &&
    !callerProfile.archived_at &&
    String(callerProfile.status ?? '').toLowerCase() === 'active'

  if (!callerActive || !['owner', 'admin', 'csr'].includes(callerRole)) {
    return {
      error: fail('forbidden', 'Only Owner, Admin, or CSR may send review notifications.', 403),
    }
  }

  return { callerRole, callerAuth, callerProfile }
}

async function sendResendEmail(opts: {
  apiKey: string
  from: string
  to: string[]
  subject: string
  html: string
  text: string
}): Promise<{ ok: true; id: string | null } | { ok: false; code: string; message: string }> {
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

  const body = (await res.json().catch(() => ({}))) as {
    id?: string
    message?: string
    name?: string
  }

  if (!res.ok) {
    return {
      ok: false,
      code: 'resend_send_failed',
      message:
        body.message ||
        body.name ||
        `Resend API returned HTTP ${res.status}. Verify RESEND_API_KEY and that the sender domain is verified.`,
    }
  }

  return { ok: true, id: body.id ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return fail('unauthorized', 'Missing Authorization bearer token.', 401)
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) {
    return fail('server_misconfigured', 'Supabase service credentials are missing.', 500)
  }

  const adminClient = createClient(supabaseUrl, serviceKey)
  const authz = await authorizeCaller(adminClient, authHeader)
  if ('error' in authz && authz.error) return authz.error

  let body: { transactionId?: string; action?: string }
  try {
    body = (await req.json()) as { transactionId?: string; action?: string }
  } catch {
    return fail('invalid_json', 'Request body must be JSON.')
  }

  const transactionId = String(body.transactionId ?? '').trim()
  const action = String(body.action ?? 'submitted').trim().toLowerCase()
  if (!transactionId) {
    return fail('invalid_transaction_id', 'transactionId is required.')
  }
  if (action !== 'submitted' && action !== 'returned') {
    return fail('unsupported_action', 'action must be submitted or returned.')
  }

  const app = resolveAppOrigin()
  if (!app.origin) {
    return fail('app_url_missing', app.error || 'APP_URL is required.', 500)
  }

  const { data: tx, error: txError } = await adminClient
    .from('transactions')
    .select(
      `
      id,
      transaction_number,
      transaction_type,
      premium_amount,
      amount,
      agency_commission_amount,
      producer_commission_amount,
      producer,
      csr,
      csr_user_id,
      review_status,
      agency_commission_confirmed,
      reviewer_user_id,
      review_return_reason,
      review_returned_at,
      clients ( business_name ),
      policies ( policy_number ),
      reviewer:users!reviewer_user_id ( id, email, full_name, role, status, archived_at )
    `,
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (txError) {
    return fail('transaction_load_failed', txError.message, 500)
  }
  if (!tx) {
    return fail('transaction_not_found', 'Transaction not found.', 404)
  }

  const clientEmbed = Array.isArray(tx.clients) ? tx.clients[0] : tx.clients
  const policyEmbed = Array.isArray(tx.policies) ? tx.policies[0] : tx.policies
  const reviewerEmbed = Array.isArray(tx.reviewer) ? tx.reviewer[0] : tx.reviewer
  const clientName = display(clientEmbed?.business_name)
  const policyNumber = display(policyEmbed?.policy_number)
  const trxNumber = display(tx.transaction_number)
  const type = typeLabel(tx.transaction_type)
  const amount = money(tx.premium_amount ?? tx.amount)
  const agencyCommission = money(tx.agency_commission_amount)
  const producer = display(tx.producer)
  const producerCommission = money(tx.producer_commission_amount)
  const csr = display(tx.csr)
  const reviewLink = `${app.origin}/transactions/${tx.id}`
  const reason = display(tx.review_return_reason)

  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  const from =
    (Deno.env.get('RESEND_FROM') ?? '').trim() ||
    'ALZA Flow <notifications@verified-domain>'

  let recipients: string[] = []
  let subject = ''
  let text = ''
  let html = ''

  if (action === 'submitted') {
    const reviewStatus = String(tx.review_status ?? '').toLowerCase()
    if (!tx.agency_commission_confirmed || reviewStatus !== 'matched') {
      return fail(
        'not_submitted',
        'Transaction is not in Submitted for Review state (confirmed + matched).',
        409,
      )
    }
    if (!tx.reviewer_user_id || !reviewerEmbed) {
      return fail('reviewer_missing', 'Assigned reviewer is required before emailing.', 409)
    }
    const reviewerActive =
      !reviewerEmbed.archived_at &&
      String(reviewerEmbed.status ?? '').toLowerCase() === 'active' &&
      ['owner', 'admin'].includes(String(reviewerEmbed.role ?? '').toLowerCase())
    const email = String(reviewerEmbed.email ?? '').trim().toLowerCase()
    if (!reviewerActive || !email.includes('@')) {
      return fail(
        'reviewer_email_unavailable',
        'Assigned reviewer does not have an active Owner/Admin email.',
        404,
      )
    }
    recipients = [email]
    subject = `ALZA Flow — ${trxNumber} Ready for Your Review`
    text = [
      'A transaction has been submitted for your review.',
      '',
      `Client: ${clientName}`,
      `Policy #: ${policyNumber}`,
      `Transaction #: ${trxNumber}`,
      `Type: ${type}`,
      `Amount: ${amount}`,
      `Agency Commission: ${agencyCommission}`,
      `Producer: ${producer}`,
      `Producer Commission: ${producerCommission}`,
      `CSR: ${csr}`,
      '',
      `Review: ${reviewLink}`,
    ].join('\n')
    html = `
      <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px">ALZA Flow — Ready for Your Review</h2>
        <p style="margin:0 0 16px">Transaction <strong>${trxNumber}</strong> is ready for your review.</p>
        <table style="border-collapse:collapse;width:100%;max-width:560px">
          <tr><td style="padding:4px 0;color:#64748b">Client</td><td style="padding:4px 0">${clientName}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Policy #</td><td style="padding:4px 0">${policyNumber}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Transaction #</td><td style="padding:4px 0">${trxNumber}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Type</td><td style="padding:4px 0">${type}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Amount</td><td style="padding:4px 0">${amount}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Agency Commission</td><td style="padding:4px 0">${agencyCommission}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Producer</td><td style="padding:4px 0">${producer}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Producer Commission</td><td style="padding:4px 0">${producerCommission}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">CSR</td><td style="padding:4px 0">${csr}</td></tr>
        </table>
        <p style="margin:20px 0 0">
          <a href="${reviewLink}" style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">
            Open transaction
          </a>
        </p>
        <p style="margin:12px 0 0;color:#64748b;font-size:12px">${reviewLink}</p>
      </div>
    `
  } else {
    // returned — email CSR if resolvable (prefer csr_user_id, then name)
    if (!tx.review_return_reason) {
      return fail('return_reason_missing', 'Return reason is required before emailing CSR.', 409)
    }

    let recipient: { id: string; email: string; full_name: string } | null = null
    const csrUserId = String((tx as { csr_user_id?: string | null }).csr_user_id ?? '').trim()
    if (csrUserId) {
      const { data: byId, error: byIdError } = await adminClient
        .from('users')
        .select('id, email, full_name, status, archived_at')
        .eq('id', csrUserId)
        .maybeSingle()
      if (byIdError) return fail('csr_lookup_failed', byIdError.message, 500)
      if (
        byId &&
        String(byId.status ?? '').toLowerCase() === 'active' &&
        !byId.archived_at &&
        String(byId.email ?? '').includes('@')
      ) {
        recipient = {
          id: String(byId.id),
          email: String(byId.email),
          full_name: String(byId.full_name ?? ''),
        }
      }
    }

    if (!recipient) {
      const csrName = normalizeName(tx.csr)
      if (!csrName || csrName === '—') {
        return ok({
          emailed: false,
          email_code: 'csr_unresolved',
          email_message:
            'Transaction returned. CSR email was not sent because CSR name could not be resolved to a user.',
          recipientCount: 0,
          subject: `ALZA Flow — ${trxNumber} Returned for Correction`,
          reviewLink,
          from,
        })
      }

      const { data: csrUsers, error: csrError } = await adminClient
        .from('users')
        .select('id, email, full_name, role, status, archived_at')
        .eq('status', 'active')
        .is('archived_at', null)

      if (csrError) {
        return fail('csr_lookup_failed', csrError.message, 500)
      }

      const { data: roleRows } = await adminClient
        .from('user_roles')
        .select('user_id')
        .eq('role', 'csr')
      const csrRoleIds = new Set((roleRows ?? []).map((r) => String(r.user_id)))

      const matches = (csrUsers ?? []).filter((u) => {
        const isCsr =
          String(u.role ?? '').toLowerCase() === 'csr' || csrRoleIds.has(String(u.id))
        return (
          isCsr &&
          normalizeName(u.full_name) === csrName &&
          String(u.email ?? '').includes('@')
        )
      })
      if (matches.length !== 1) {
        return ok({
          emailed: false,
          email_code: 'csr_unresolved',
          email_message:
            matches.length === 0
              ? 'Transaction returned. CSR email was not sent because no active CSR user matched the transaction CSR name.'
              : 'Transaction returned. CSR email was not sent because multiple CSR users matched the transaction CSR name.',
          recipientCount: 0,
          subject: `ALZA Flow — ${trxNumber} Returned for Correction`,
          reviewLink,
          from,
        })
      }
      recipient = {
        id: String(matches[0].id),
        email: String(matches[0].email),
        full_name: String(matches[0].full_name ?? ''),
      }
    }

    recipients = [String(recipient.email).trim().toLowerCase()]
    subject = `ALZA Flow — ${trxNumber} Returned for Correction`
    text = [
      'A transaction was returned for correction.',
      '',
      `Transaction #: ${trxNumber}`,
      `Client: ${clientName}`,
      `Policy #: ${policyNumber}`,
      `CSR: ${display(recipient.full_name || tx.csr)}`,
      `Reason: ${display(tx.review_return_reason)}`,
      '',
      `Open: ${reviewLink}`,
    ].join('\n')
    html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#0f172a">
        <p style="margin:0 0 16px">Transaction <strong>${trxNumber}</strong> was returned for correction.</p>
        <table style="border-collapse:collapse;width:100%;max-width:520px">
          <tr><td style="padding:4px 0;color:#64748b">Client</td><td style="padding:4px 0">${clientName}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Policy #</td><td style="padding:4px 0">${policyNumber}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">CSR</td><td style="padding:4px 0">${display(recipient.full_name || tx.csr)}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b">Reason</td><td style="padding:4px 0">${display(tx.review_return_reason)}</td></tr>
        </table>
        <p style="margin:20px 0 0">
          <a href="${reviewLink}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px">
            Open transaction
          </a>
        </p>
        <p style="margin:12px 0 0;color:#64748b;font-size:12px">${reviewLink}</p>
      </div>
    `
  }

  if (!resendKey) {
    return ok({
      emailed: false,
      email_code: 'resend_not_configured',
      email_message:
        'Notification prepared, but RESEND_API_KEY is not set. Set Edge Function secrets RESEND_API_KEY and RESEND_FROM (verified domain) before external email will send.',
      recipientCount: recipients.length,
      recipientsPreview: recipients.map((e) => e.replace(/(.{2}).+(@.+)/, '$1***$2')),
      subject,
      reviewLink,
      from,
      action,
    })
  }

  const sent = await sendResendEmail({
    apiKey: resendKey,
    from,
    to: recipients,
    subject,
    html,
    text,
  })

  if (!sent.ok) {
    return fail(sent.code, sent.message, 502)
  }

  return ok({
    emailed: true,
    email_code: 'sent',
    email_message: `Email sent to ${recipients.length} recipient(s).`,
    recipientCount: recipients.length,
    resendId: sent.id,
    subject,
    reviewLink,
    from,
    action,
  })
})
