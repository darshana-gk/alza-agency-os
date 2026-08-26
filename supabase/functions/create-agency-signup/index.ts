// Deno Edge Function: create-agency-signup
// Public prospect signup — creates Auth user + agency_profile (lifecycle=prospect) + Owner + incomplete billing.
// Never sets lifecycle=active. Never assigns alza_support.
// verify_jwt = false (public); service role for writes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { adminClient, resolveAppOrigin } from '../_shared/billing.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

function normalizeEmail(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('invalid_body', 'JSON body is required.')
  }

  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')
  const agencyName = String(body.agency_name ?? body.agencyName ?? '').trim()
  const fullName = String(body.full_name ?? body.fullName ?? '').trim() || agencyName || 'Agency Owner'

  if (!email || !email.includes('@')) {
    return fail('invalid_email', 'A valid email is required.', 400)
  }
  if (password.length < 8) {
    return fail('invalid_password', 'Password must be at least 8 characters.', 400)
  }
  if (!agencyName) {
    return fail('invalid_agency_name', 'Agency / workspace name is required.', 400)
  }

  const admin = adminClient()
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const { data: existingProfile } = await admin
    .from('users')
    .select('id, email')
    .ilike('email', email)
    .maybeSingle()
  if (existingProfile) {
    return fail('email_taken', 'An account with this email already exists. Sign in instead.', 409)
  }

  const createAuth = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, signup: 'agency_prospect' },
  })
  if (createAuth.error || !createAuth.data.user) {
    const msg = createAuth.error?.message ?? 'Unable to create auth user.'
    if (/already|registered|exists/i.test(msg)) {
      return fail('email_taken', 'An account with this email already exists. Sign in instead.', 409)
    }
    return fail('auth_create_failed', msg, 500)
  }

  const authUserId = createAuth.data.user.id
  const nowIso = new Date().toISOString()

  const { data: agency, error: agencyError } = await admin
    .from('agency_profile')
    .insert({
      agency_name: agencyName,
      email,
      singleton_key: false,
      lifecycle: 'prospect',
      updated_at: nowIso,
    })
    .select('id, agency_name, lifecycle')
    .single()

  if (agencyError || !agency) {
    await admin.auth.admin.deleteUser(authUserId)
    return fail(
      'agency_create_failed',
      agencyError?.message ??
        'Unable to create agency workspace. Apply the agency lifecycle migration first.',
      500,
    )
  }

  const { data: profile, error: profileError } = await admin
    .from('users')
    .insert({
      auth_user_id: authUserId,
      email,
      full_name: fullName,
      role: 'owner',
      status: 'active',
      agency_profile_id: agency.id,
      invite_status: 'accepted',
    })
    .select('id')
    .single()

  if (profileError || !profile) {
    await admin.from('agency_profile').delete().eq('id', agency.id)
    await admin.auth.admin.deleteUser(authUserId)
    return fail('profile_create_failed', profileError?.message ?? 'Unable to create owner profile.', 500)
  }

  await admin.from('user_roles').insert({ user_id: profile.id, role: 'owner' })

  await admin.from('billing_subscriptions').insert({
    agency_profile_id: agency.id,
    status: 'incomplete',
  })

  // Establish a session for the browser (anon client + password).
  const publicClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signIn = await publicClient.auth.signInWithPassword({ email, password })
  if (signIn.error || !signIn.data.session) {
    return ok({
      signed_up: true,
      agency_id: agency.id,
      lifecycle: 'prospect',
      session: null,
      message: 'Account created. Sign in to continue to Subscription & Billing.',
    })
  }

  const app = resolveAppOrigin()
  return ok({
    signed_up: true,
    agency_id: agency.id,
    lifecycle: 'prospect',
    access_token: signIn.data.session.access_token,
    refresh_token: signIn.data.session.refresh_token,
    redirect_to: `${app.origin ?? ''}/admin/subscription-billing`,
  })
})
