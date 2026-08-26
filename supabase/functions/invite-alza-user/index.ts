// Deno Edge Function: invite-alza-user
// Secure Owner/Admin invite — never expose service_role to the Vite frontend.
//
// Deploy:
//   npx supabase functions deploy invite-alza-user
//
// Secrets (hosted):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto)
//   APP_URL or SITE_URL — public ALZA Flow origin (no trailing slash)
//     Local:      http://localhost:5173
//     Production: https://<alza-flow-production-domain>
//
// Invite emails redirect to: {APP_URL}/auth/set-password
//
// Actions (body.action):
//   "invite" (default) — create/invite Auth user + upsert public.users
//   "resend" — recovery-style acceptance email for existing pending Auth user (no duplicate)

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type InviteRole = 'owner' | 'admin' | 'csr' | 'producer' | 'viewer'

function resolveAppOrigin(): { origin: string | null; error: string | null } {
  const raw = (Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '').trim()
  if (!raw) {
    return {
      origin: null,
      error:
        'Server misconfigured: set Edge Function secret APP_URL (or SITE_URL) to the ALZA Flow public origin, e.g. http://localhost:5173 or https://your-domain.com',
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
    .select('id, role, status, archived_at, agency_profile_id')
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

  if (!callerActive || (callerRole !== 'owner' && callerRole !== 'admin')) {
    return { error: fail('forbidden', 'Only Owner or Admin may invite users.', 403) }
  }

  return {
    callerRole,
    callerAuth,
    callerAgencyProfileId: (callerProfile?.agency_profile_id as string | null) ?? null,
  }
}

/**
 * Resend for an EXISTING Auth user.
 * Do not use inviteUserByEmail here — it fails once the Auth user already exists.
 * Use recovery email to the same /auth/set-password acceptance route.
 */
async function sendExistingUserAcceptanceEmail(
  adminClient: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<{ ok: true; mode: 'recovery' } | { ok: false; code: string; message: string }> {
  const recovery = await adminClient.auth.resetPasswordForEmail(email, { redirectTo })
  if (recovery.error) {
    return {
      ok: false,
      code: 'recovery_email_failed',
      message: recovery.error.message || 'Unable to send acceptance email for existing Auth user.',
    }
  }
  return { ok: true, mode: 'recovery' }
}

async function handleResend(opts: {
  adminClient: SupabaseClient
  callerRole: string
  email: string
  inviteRedirectTo: string
  appOrigin: string
}) {
  const { adminClient, callerRole, email, inviteRedirectTo, appOrigin } = opts

  const { data: profile, error: profileError } = await adminClient
    .from('users')
    .select('id, email, full_name, role, status, archived_at, auth_user_id, invite_status')
    .ilike('email', email)
    .maybeSingle()

  if (profileError) {
    return fail('profile_load_failed', `Unable to load user profile: ${profileError.message}`, 500)
  }
  if (!profile) {
    return fail('profile_not_found', 'No ALZA user profile found for that email.', 404)
  }
  if (profile.archived_at) {
    return fail('archived_user', 'Cannot resend invite for an archived user.')
  }

  const status = String(profile.status ?? '').toLowerCase()
  if (status !== 'active') {
    return fail('inactive_user', 'Cannot resend invite for an inactive user. Set status to active first.')
  }

  const targetRole = String(profile.role ?? '').toLowerCase()
  if (callerRole === 'admin' && targetRole === 'owner') {
    return fail('owner_protected', 'Admins cannot resend invites for Owner accounts.', 403)
  }

  const authUserId = profile.auth_user_id ? String(profile.auth_user_id) : ''
  if (!authUserId) {
    return fail(
      'missing_auth_user',
      'This profile has no linked Auth user. Use Add User / Invite to create the Auth account first.',
    )
  }

  const inviteStatus = String(profile.invite_status ?? '').toLowerCase()
  if (inviteStatus === 'accepted') {
    return fail('invite_accepted', 'Invite already accepted. User can sign in normally.')
  }
  if (inviteStatus !== 'pending') {
    return fail(
      'invite_not_pending',
      inviteStatus
        ? `Invite status is “${inviteStatus}”; only pending invites can be resent.`
        : 'Invite status is not pending. Only users marked Invitation Pending can receive a resent invite.',
    )
  }

  const { data: authData, error: authLookupError } = await adminClient.auth.admin.getUserById(authUserId)
  if (authLookupError || !authData.user) {
    return fail(
      'auth_user_missing',
      authLookupError?.message ||
        'Linked Auth user was not found. Reconcile Auth linkage before resending.',
    )
  }

  const authEmail = String(authData.user.email ?? '').trim().toLowerCase()
  if (authEmail && authEmail !== email) {
    return fail(
      'email_mismatch',
      'Profile email does not match the linked Auth user email. Reconcile before resending.',
    )
  }

  // Existing Auth user: recovery email only (never inviteUserByEmail / createUser).
  const sent = await sendExistingUserAcceptanceEmail(adminClient, email, inviteRedirectTo)
  if (!sent.ok) {
    return fail(sent.code, sent.message)
  }

  const nowIso = new Date().toISOString()
  const { error: touchError } = await adminClient
    .from('users')
    .update({
      invited_at: nowIso,
      invite_status: 'pending',
    })
    .eq('id', profile.id)
    .eq('invite_status', 'pending')

  if (touchError) {
    return fail(
      'profile_touch_failed',
      `Acceptance email sent but profile invite timestamp update failed: ${touchError.message}`,
      500,
    )
  }

  return ok({
    action: 'resend',
    user_id: profile.id,
    auth_user_id: authUserId,
    email,
    invite_status: 'pending',
    redirect_to: inviteRedirectTo,
    app_origin: appOrigin,
    resend_mode: sent.mode,
  })
}

async function handleInvite(opts: {
  adminClient: SupabaseClient
  callerRole: string
  callerAgencyProfileId: string | null
  body: Record<string, unknown>
  inviteRedirectTo: string
}) {
  const { adminClient, callerRole, callerAgencyProfileId, body, inviteRedirectTo } = opts
  const email = String(body.email ?? '').trim().toLowerCase()
  const fullName = String(body.full_name ?? body.fullName ?? '').trim()
  const role = String(body.role ?? '').trim().toLowerCase() as InviteRole
  const status = String(body.status ?? 'active').trim().toLowerCase() || 'active'
  const rawRoles = Array.isArray(body.roles) ? body.roles : [role]
  const roles = [
    ...new Set(
      rawRoles
        .map((r) => String(r ?? '').trim().toLowerCase())
        .filter((r): r is InviteRole =>
          ['owner', 'admin', 'csr', 'producer', 'viewer'].includes(r),
        ),
    ),
  ]
  if (!roles.includes(role)) roles.unshift(role)

  if (role === ('alza_support' as InviteRole) || rawRoles.some((r) => String(r).toLowerCase() === 'alza_support')) {
    return fail('invalid_role', 'ALZA Support is a platform role and cannot be invited from Agency Users.')
  }

  if (!email || !email.includes('@')) {
    return fail('invalid_email', 'A valid email is required.')
  }
  if (!fullName) {
    return fail('invalid_name', 'Full name is required.')
  }

  const allowedRoles: InviteRole[] =
    callerRole === 'admin'
      ? ['admin', 'csr', 'producer', 'viewer']
      : ['owner', 'admin', 'csr', 'producer', 'viewer']

  if (!allowedRoles.includes(role)) {
    return fail(
      'invalid_role',
      callerRole === 'admin' ? 'Admins cannot assign the Owner role.' : 'Invalid role.',
    )
  }
  if (roles.some((r) => !allowedRoles.includes(r))) {
    return fail(
      'invalid_role',
      callerRole === 'admin' ? 'Admins cannot assign the Owner role.' : 'Invalid role in roles list.',
    )
  }

  if (status !== 'active' && status !== 'inactive') {
    return fail('invalid_status', 'Status must be active or inactive.')
  }

  let authUserId: string | null = null
  let inviteMode: 'invite' | 'create' = 'invite'

  const inviteResult = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role },
    redirectTo: inviteRedirectTo,
  })

  if (inviteResult.error || !inviteResult.data.user) {
    const createResult = await adminClient.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { full_name: fullName, role },
    })
    if (createResult.error || !createResult.data.user) {
      return fail(
        'auth_create_failed',
        inviteResult.error?.message ||
          createResult.error?.message ||
          'Unable to create auth user.',
      )
    }
    authUserId = createResult.data.user.id
    inviteMode = 'create'
  } else {
    authUserId = inviteResult.data.user.id
  }

  const nowIso = new Date().toISOString()

  // Prefer inviter membership — never fall back to "first" agency (unsafe for multi-agency).
  const agencyProfileId: string | null = callerAgencyProfileId
  if (!agencyProfileId) {
    return fail(
      'agency_membership_required',
      'Your user is not linked to an agency workspace. Cannot invite users.',
      400,
    )
  }

  const { data: agencyRow, error: agencyLoadError } = await adminClient
    .from('agency_profile')
    .select('id, lifecycle')
    .eq('id', agencyProfileId)
    .maybeSingle()

  if (agencyLoadError) {
    return fail('agency_load_failed', agencyLoadError.message, 500)
  }
  const lifecycle = String(agencyRow?.lifecycle ?? '').trim().toLowerCase()
  // Missing lifecycle column → treat as active (pre-migration). Otherwise require active.
  if (lifecycle && lifecycle !== 'active') {
    return fail(
      'agency_not_active',
      'User invites are only available for activated agency workspaces.',
      403,
    )
  }

  const { data: existingProfile } = await adminClient
    .from('users')
    .select('id, auth_user_id')
    .ilike('email', email)
    .maybeSingle()

  let profileId: string | null = existingProfile?.id ?? null

  if (existingProfile) {
    const { data: updated, error: updateError } = await adminClient
      .from('users')
      .update({
        full_name: fullName,
        role,
        status,
        auth_user_id: authUserId,
        invited_at: nowIso,
        invite_status: 'pending',
        archived_at: null,
        agency_profile_id: agencyProfileId,
      })
      .eq('id', existingProfile.id)
      .select('id')
      .single()

    if (updateError) {
      return fail(
        'profile_update_failed',
        `Auth user created/invited but profile update failed: ${updateError.message}`,
        500,
      )
    }
    profileId = updated.id
  } else {
    const { data: inserted, error: insertError } = await adminClient
      .from('users')
      .insert({
        full_name: fullName,
        email,
        role,
        status,
        auth_user_id: authUserId,
        invited_at: nowIso,
        invite_status: 'pending',
        agency_profile_id: agencyProfileId,
      })
      .select('id')
      .single()

    if (insertError) {
      return fail(
        'profile_insert_failed',
        `Auth user created/invited but profile insert failed: ${insertError.message}`,
        500,
      )
    }
    profileId = inserted.id
  }

  if (profileId) {
    await adminClient.from('user_roles').delete().eq('user_id', profileId)
    const { error: rolesError } = await adminClient.from('user_roles').insert(
      roles.map((r) => ({ user_id: profileId, role: r })),
    )
    if (rolesError) {
      return fail(
        'roles_sync_failed',
        `Profile saved but user_roles sync failed: ${rolesError.message}`,
        500,
      )
    }
  }

  return ok({
    action: 'invite',
    user_id: profileId,
    auth_user_id: authUserId,
    email,
    role,
    roles,
    status,
    invite_mode: inviteMode,
    invite_status: 'pending',
    redirect_to: inviteMode === 'invite' ? inviteRedirectTo : null,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return fail('misconfigured', 'Server misconfigured: missing Supabase env.', 500)
    }

    const appOrigin = resolveAppOrigin()
    if (!appOrigin.origin) {
      return fail('missing_app_url', appOrigin.error ?? 'APP_URL is required.', 500)
    }
    const inviteRedirectTo = `${appOrigin.origin}/auth/set-password`

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return fail('missing_authorization', 'Missing Authorization header.', 401)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const authz = await authorizeCaller(adminClient, authHeader)
    if ('error' in authz && authz.error) return authz.error

    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? 'invite').trim().toLowerCase() || 'invite'
    const email = String(body.email ?? '').trim().toLowerCase()

    if (action === 'resend') {
      if (!email || !email.includes('@')) {
        return fail('invalid_email', 'A valid email is required.')
      }
      return await handleResend({
        adminClient,
        callerRole: authz.callerRole!,
        email,
        inviteRedirectTo,
        appOrigin: appOrigin.origin,
      })
    }

    if (action !== 'invite') {
      return fail('unsupported_action', `Unsupported action “${action}”. Use invite or resend.`)
    }

    return await handleInvite({
      adminClient,
      callerRole: authz.callerRole!,
      callerAgencyProfileId: authz.callerAgencyProfileId ?? null,
      body,
      inviteRedirectTo,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected invite failure.'
    return fail('unexpected', message, 500)
  }
})
