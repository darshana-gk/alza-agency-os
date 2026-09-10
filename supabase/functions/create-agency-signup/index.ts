// Deno Edge Function: create-agency-signup
// Public self-serve signup (Phase 1). Creates Auth user + ONE agency + Owner.
// Never trusts client agency_id / role. Never exposes service role to the browser.
// Does NOT activate billing. Optional purchase intent only.
// verify_jwt = false (unauthenticated callers).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

const FLOW_CHECKOUT_SKUS = new Set([
  'flow_1_3_monthly',
  'flow_1_3_annual',
  'flow_4_10_monthly',
  'flow_4_10_annual',
  'flow_11_25_monthly',
  'flow_11_25_annual',
  'flow_26_50_monthly',
  'flow_26_50_annual',
])

const BANDS = new Set([
  'users_1_3',
  'users_4_10',
  'users_11_25',
  'users_26_50',
  'users_51_100',
  'users_100_plus',
])

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseIntent(body: Record<string, unknown>): {
  productKey: string | null
  userBandKey: string | null
  billingInterval: string | null
  planKey: string | null
  error?: string
} {
  const planKeyRaw = String(body.plan_key ?? body.planKey ?? '').trim().toLowerCase()
  const productRaw = String(body.product ?? body.product_key ?? body.productKey ?? '')
    .trim()
    .toLowerCase()
  const bandRaw = String(body.userBand ?? body.user_band ?? body.user_band_key ?? body.userBandKey ?? '')
    .trim()
    .toLowerCase()
  const intervalRaw = String(body.interval ?? body.billing_interval ?? body.billingInterval ?? '')
    .trim()
    .toLowerCase()

  let planKey = planKeyRaw || null
  let productKey = productRaw || null
  let userBandKey = bandRaw || null
  let billingInterval = intervalRaw || null

  if (planKey) {
    if (!FLOW_CHECKOUT_SKUS.has(planKey)) {
      return {
        productKey: null,
        userBandKey: null,
        billingInterval: null,
        planKey: null,
        error: 'Invalid plan_key.',
      }
    }
  }

  if (productKey && productKey !== 'alza_flow' && productKey !== 'alza_flow_pay') {
    return {
      productKey: null,
      userBandKey: null,
      billingInterval: null,
      planKey: null,
      error: 'Invalid product.',
    }
  }
  if (userBandKey && !BANDS.has(userBandKey)) {
    return {
      productKey: null,
      userBandKey: null,
      billingInterval: null,
      planKey: null,
      error: 'Invalid user band.',
    }
  }
  if (billingInterval && billingInterval !== 'monthly' && billingInterval !== 'annual') {
    return {
      productKey: null,
      userBandKey: null,
      billingInterval: null,
      planKey: null,
      error: 'Invalid billing interval.',
    }
  }

  // Ignore empty intent entirely.
  if (!productKey && !userBandKey && !billingInterval && !planKey) {
    return { productKey: null, userBandKey: null, billingInterval: null, planKey: null }
  }

  return { productKey, userBandKey, billingInterval, planKey }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) {
    return fail('misconfigured', 'Server is missing Supabase credentials.', 500)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('invalid_body', 'JSON body is required.')
  }

  // Reject privileged / cross-tenant fields from the browser.
  for (const banned of [
    'agency_id',
    'agencyId',
    'agency_profile_id',
    'agencyProfileId',
    'role',
    'roles',
    'user_id',
    'userId',
    'auth_user_id',
    'authUserId',
    'tenant_id',
    'tenantId',
  ]) {
    if (banned in body && body[banned] != null && String(body[banned]).trim() !== '') {
      return fail('forbidden_field', `Field "${banned}" is not allowed.`, 400)
    }
  }

  const fullName = String(body.full_name ?? body.fullName ?? body.name ?? '').trim()
  const agencyName = String(body.agency_name ?? body.agencyName ?? body.business_name ?? body.businessName ?? '')
    .trim()
  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')

  if (!fullName || fullName.length < 2) {
    return fail('invalid_name', 'Enter your full name.')
  }
  if (!agencyName || agencyName.length < 2) {
    return fail('invalid_agency', 'Enter your agency / business name.')
  }
  if (!isEmail(email)) {
    return fail('invalid_email', 'Enter a valid email address.')
  }
  if (password.length < 8) {
    return fail('invalid_password', 'Password must be at least 8 characters.')
  }

  const intent = parseIntent(body)
  if (intent.error) {
    return fail('invalid_intent', intent.error, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Pre-check app users (Auth may still allow create if only Auth orphan exists).
  const { data: existingUser } = await admin
    .from('users')
    .select('id')
    .ilike('email', email)
    .maybeSingle()
  if (existingUser) {
    return fail('email_exists', 'An account with this email already exists. Sign in instead.', 409)
  }

  const { data: existingAgency } = await admin
    .from('agency_profile')
    .select('id')
    .ilike('email', email)
    .maybeSingle()
  if (existingAgency) {
    return fail('agency_email_exists', 'An agency with this email already exists. Contact ALZA Support.', 409)
  }

  const { data: createdAuth, error: createAuthError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      agency_name: agencyName,
      signup_source: 'self_serve',
    },
  })

  if (createAuthError || !createdAuth.user) {
    const msg = (createAuthError?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return fail('email_exists', 'An account with this email already exists. Sign in instead.', 409)
    }
    return fail(
      'auth_create_failed',
      createAuthError?.message ?? 'Unable to create account.',
      400,
    )
  }

  const authUserId = createdAuth.user.id

  const { data: provisioned, error: rpcError } = await admin.rpc('self_serve_create_agency_owner', {
    p_auth_user_id: authUserId,
    p_full_name: fullName,
    p_agency_name: agencyName,
    p_email: email,
    p_product_key: intent.productKey,
    p_user_band_key: intent.userBandKey,
    p_billing_interval: intent.billingInterval,
    p_plan_key: intent.planKey,
  })

  if (rpcError || !provisioned) {
    // Compensate: remove Auth user so the email can retry cleanly.
    try {
      await admin.auth.admin.deleteUser(authUserId)
    } catch {
      // best-effort
    }
    const message = rpcError?.message ?? 'Unable to create agency workspace.'
    if (/already exists|already linked/i.test(message)) {
      return fail('email_exists', message, 409)
    }
    return fail('provision_failed', message, 400)
  }

  return ok({
    agencyId: (provisioned as Record<string, unknown>).agency_id ?? null,
    ownerUserId: (provisioned as Record<string, unknown>).owner_user_id ?? null,
    email,
    role: 'owner',
    billingIntentId: (provisioned as Record<string, unknown>).billing_intent_id ?? null,
    nextStep: 'sign_in',
  })
})
