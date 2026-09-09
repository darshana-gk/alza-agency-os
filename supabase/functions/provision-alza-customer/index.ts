// Deno Edge Function: provision-alza-customer
// Platform ALZA Support only. Never exposes the service role to the browser.
//
// Actions:
//   list
//   create
//   resend
//   activate

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BANDS = new Set([
  'users_1_3',
  'users_4_10',
  'users_11_25',
  'users_26_50',
  'users_51_100',
  'users_100_plus',
])

function fail(code: string, message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function resolveAppOrigin(): { origin: string | null; error: string | null } {
  const raw = (Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '').trim()
  if (!raw) return { origin: null, error: 'APP_URL is not set.' }
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { origin: null, error: 'APP_URL must use http or https.' }
    }
    return { origin: `${url.protocol}//${url.host}`, error: null }
  } catch {
    return { origin: null, error: 'APP_URL must be a valid absolute URL.' }
  }
}

async function resolvePlatformSupport(
  admin: SupabaseClient,
  authHeader: string,
): Promise<{ userId: string } | { error: Response }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: fail('unauthorized', 'Authentication required.', 401) }
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) {
    return { error: fail('unauthorized', 'Authentication required.', 401) }
  }

  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, role, status, archived_at, agency_profile_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return { error: fail('forbidden', 'Only platform ALZA Support can provision customers.', 403) }
  }

  const role = String(profile.role ?? '').toLowerCase()
  const active = String(profile.status ?? '').toLowerCase() === 'active' && !profile.archived_at
  const platform = profile.agency_profile_id == null
  if (!active || role !== 'alza_support' || !platform) {
    return { error: fail('forbidden', 'Only platform ALZA Support can provision customers.', 403) }
  }

  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', profile.id)

  const blocked = (roles ?? []).some((row) =>
    ['owner', 'admin', 'csr', 'producer', 'viewer'].includes(String(row.role ?? '').toLowerCase()),
  )
  if (blocked) {
    return { error: fail('forbidden', 'Only platform ALZA Support can provision customers.', 403) }
  }

  return { userId: String(profile.id) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST required.', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) {
    return fail('misconfigured', 'Server is missing Supabase credentials.', 500)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authz = await resolvePlatformSupport(admin, req.headers.get('Authorization') ?? '')
  if ('error' in authz) return authz.error

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('invalid_body', 'JSON body is required.')
  }

  const action = String(body.action ?? 'create').trim().toLowerCase()

  if (action === 'list') {
    const { data, error } = await admin.rpc('list_platform_agencies', {
      p_actor_user_id: authz.userId,
    })
    if (error) return fail('list_failed', error.message, 500)
    return ok({ agencies: data ?? [] })
  }

  if (action === 'resend') {
    const ownerUserId = String(body.owner_user_id ?? '').trim()
    if (!ownerUserId) return fail('missing_field', 'Owner is required.')

    const { data: owner, error: ownerError } = await admin
      .from('users')
      .select('id, email, role, invite_status, archived_at, auth_user_id, agency_profile_id')
      .eq('id', ownerUserId)
      .maybeSingle()
    if (ownerError || !owner) return fail('not_found', 'Owner was not found.', 404)
    if (String(owner.role ?? '').toLowerCase() !== 'owner' || owner.archived_at) {
      return fail('invalid_owner', 'Resend is only available for the pending Owner.')
    }
    if (String(owner.invite_status ?? '').toLowerCase() !== 'pending') {
      return fail('not_pending', 'This Owner invitation is not pending.')
    }

    const origin = resolveAppOrigin()
    if (!origin.origin) return fail('misconfigured', origin.error ?? 'APP_URL is not set.', 500)
    const redirectTo = `${origin.origin}/auth/set-password`
    const email = normalizeEmail(owner.email)
    const sent = await admin.auth.resetPasswordForEmail(email, { redirectTo })
    if (sent.error) {
      if (!/rate limit/i.test(sent.error.message)) {
        return fail('resend_failed', sent.error.message, 500)
      }
      const linked = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      if (linked.error || !linked.data.user) {
        return fail('resend_failed', linked.error?.message || sent.error.message, 500)
      }
    }

    await admin.rpc('record_owner_invite_resent', {
      p_actor_user_id: authz.userId,
      p_owner_user_id: owner.id,
    })

    return ok({
      action: 'resend',
      owner_email: email,
      invite_status: 'pending',
      redirect_to: redirectTo,
    })
  }

  if (action === 'activate') {
    const agencyId = String(body.agency_id ?? '').trim()
    const band = String(body.user_band ?? '').trim().toLowerCase()
    const interval = String(body.billing_interval ?? '').trim().toLowerCase()
    const periodStart = String(body.period_start ?? '').trim()
    const periodEnd = String(body.period_end ?? '').trim()
    const reference = String(body.external_reference ?? '').trim()
    if (!agencyId || !BANDS.has(band) || (interval !== 'monthly' && interval !== 'annual')) {
      return fail('invalid_body', 'Agency, plan, and interval are required.')
    }
    if (!periodStart || !periodEnd) return fail('missing_field', 'Subscription dates are required.')

    const { data, error } = await admin.rpc('activate_manual_alza_flow_subscription', {
      p_actor_user_id: authz.userId,
      p_agency_id: agencyId,
      p_user_band: band,
      p_billing_interval: interval,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_external_reference: reference || null,
    })
    if (error) return fail('activate_failed', error.message, 400)
    return ok({ activation: data })
  }

  if (action !== 'create') return fail('unsupported_action', 'Unsupported action.')

  const agencyName = String(body.agency_name ?? '').trim()
  const agencyEmail = normalizeEmail(body.agency_email)
  const ownerFirst = String(body.owner_first_name ?? '').trim()
  const ownerLast = String(body.owner_last_name ?? '').trim()
  const ownerEmail = normalizeEmail(body.owner_email)
  const intendedPlan = String(body.intended_plan ?? 'users_1_3').trim().toLowerCase() || 'users_1_3'
  const interval = String(body.billing_interval ?? 'monthly').trim().toLowerCase() || 'monthly'

  if (!agencyName || !ownerFirst || !ownerLast) {
    return fail('missing_field', 'Agency name and Owner name are required.')
  }
  if (!isEmail(agencyEmail) || !isEmail(ownerEmail)) {
    return fail('invalid_email', 'Enter a valid agency email and Owner email.')
  }
  if (!BANDS.has(intendedPlan) || (interval !== 'monthly' && interval !== 'annual')) {
    return fail('invalid_plan', 'Choose a valid plan and billing interval.')
  }

  const { data: existingUser } = await admin
    .from('users')
    .select('id')
    .ilike('email', ownerEmail)
    .maybeSingle()
  if (existingUser?.id) return fail('duplicate_owner_email', 'Owner email already exists.')

  const { data: existingAgency } = await admin
    .from('agency_profile')
    .select('id')
    .ilike('email', agencyEmail)
    .maybeSingle()
  if (existingAgency?.id) return fail('duplicate_agency_email', 'Agency email already exists.')

  const origin = resolveAppOrigin()
  if (!origin.origin) return fail('misconfigured', origin.error ?? 'APP_URL is not set.', 500)
  const redirectTo = `${origin.origin}/auth/set-password`
  const fullName = `${ownerFirst} ${ownerLast}`.trim()

  const inviteStartedAt = Date.now()
  const invited = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
    data: { full_name: fullName },
    redirectTo,
  })
  let authUserId = invited.data.user?.id ?? null
  let inviteMechanism = 'auth.admin.inviteUserByEmail'
  if (invited.error || !authUserId) {
    const message = invited.error?.message || 'Unable to invite the Owner.'
    if (/already|registered|exists/i.test(message)) {
      return fail('duplicate_auth_email', 'An Auth account already exists for this Owner email.')
    }
    // Staging Auth may rate-limit outbound invite mail. generateLink still
    // creates a new Auth invite user and token without sending mail.
    // Never attach an Auth user that already existed before this request.
    if (/rate limit/i.test(message)) {
      const { data: existingAuth } = await admin.schema('auth').from('users').select('id').eq('email', ownerEmail).maybeSingle()
      if (existingAuth?.id) {
        return fail('duplicate_auth_email', 'An Auth account already exists for this Owner email.')
      }
      const linked = await admin.auth.admin.generateLink({
        type: 'invite',
        email: ownerEmail,
        options: { data: { full_name: fullName }, redirectTo },
      })
      const linkedUser = linked.data.user
      const createdAt = Date.parse(linkedUser?.created_at ?? '')
      const alreadyExisted = Number.isFinite(createdAt) && createdAt < inviteStartedAt - 1000
      if (linked.error || !linkedUser?.id || alreadyExisted) {
        if (alreadyExisted) {
          return fail('duplicate_auth_email', 'An Auth account already exists for this Owner email.')
        }
        return fail('invite_failed', linked.error?.message || message, 500)
      }
      authUserId = linkedUser.id
      inviteMechanism = 'auth.admin.generateLink:invite'
    } else {
      return fail('invite_failed', message, 500)
    }
  }
  const { data: provisioned, error: provisionError } = await admin.rpc('provision_alza_customer', {
    p_actor_user_id: authz.userId,
    p_auth_user_id: authUserId,
    p_agency_name: agencyName,
    p_agency_email: agencyEmail,
    p_agency_phone: String(body.agency_phone ?? '').trim() || null,
    p_website: String(body.website ?? '').trim() || null,
    p_owner_first_name: ownerFirst,
    p_owner_last_name: ownerLast,
    p_owner_email: ownerEmail,
    p_intended_plan: intendedPlan,
    p_billing_interval: interval,
  })

  if (provisionError) {
    await admin.auth.admin.deleteUser(authUserId)
    return fail('provision_failed', provisionError.message, 400)
  }

  return ok({
    action: 'create',
    agency_created: true,
    owner_invited: true,
    owner_email: ownerEmail,
    invite_status: 'pending',
    invite_mechanism: inviteMechanism,
    redirect_to: redirectTo,
    next_step: 'The Owner sets a password from the invitation email, then signs in to Subscription & Billing.',
    result: provisioned,
  })
})
