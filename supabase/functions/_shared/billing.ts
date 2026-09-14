import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { fail } from './http.ts'

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function resolveAppOrigin(): { origin: string | null; error: string | null } {
  const raw = (Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? '').trim()
  if (!raw) {
    return {
      origin: null,
      error:
        'Server misconfigured: set Edge Function secret APP_URL (or SITE_URL) to the ALZA Flow public origin.',
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

/** Owner/Admin (primary role or user_roles), active, not archived. */
export async function requireOwnerOrAdmin(
  admin: SupabaseClient,
  authHeader: string | null,
): Promise<
  | { ok: true; authUserId: string; profileId: string; agencyProfileId: string | null }
  | { ok: false; response: Response }
> {
  if (!authHeader) {
    return { ok: false, response: fail('unauthorized', 'Unauthorized.', 401) }
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser()

  if (authError || !user) {
    return { ok: false, response: fail('unauthorized', 'Unauthorized.', 401) }
  }

  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, role, status, archived_at, agency_profile_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (profileError) {
    return {
      ok: false,
      response: fail('caller_profile_load_failed', profileError.message, 500),
    }
  }

  if (
    !profile ||
    profile.archived_at ||
    String(profile.status ?? '').toLowerCase() !== 'active'
  ) {
    return { ok: false, response: fail('forbidden', 'Active Owner or Admin required.', 403) }
  }

  const { data: roleRows } = await admin.from('user_roles').select('role').eq('user_id', profile.id)
  const roles = new Set(
    [String(profile.role ?? ''), ...(roleRows ?? []).map((r) => String(r.role ?? ''))].map((r) =>
      r.trim().toLowerCase(),
    ),
  )

  if (!roles.has('owner') && !roles.has('admin')) {
    return { ok: false, response: fail('forbidden', 'Only Owner or Admin may manage billing.', 403) }
  }

  return {
    ok: true,
    authUserId: user.id,
    profileId: String(profile.id),
    agencyProfileId: (profile.agency_profile_id as string | null) ?? null,
  }
}

/**
 * @deprecated Unsafe singleton lookup — hard-fails in Phase 4C+.
 * Use getCallerAgency(callerAgencyProfileId) for all billing/workspace paths.
 */
export async function getSingletonAgency(_admin: SupabaseClient) {
  return {
    data: null,
    error:
      'Singleton agency lookup is disabled. Resolve agency from the authenticated caller membership.',
  }
}

/** Resolve the caller's membership agency (required for prospect + multi-agency billing). */
export async function getCallerAgency(
  admin: SupabaseClient,
  agencyProfileId: string | null | undefined,
) {
  const id = String(agencyProfileId ?? '').trim()
  if (!id) {
    return {
      data: null,
      error: 'Your user is not linked to an agency workspace. Contact ALZA.',
    }
  }
  // Prefer lifecycle when present (Staging). Production may lack the column — fall back.
  const withLifecycle = await admin
    .from('agency_profile')
    .select('id, agency_name, email, lifecycle')
    .eq('id', id)
    .maybeSingle()
  if (!withLifecycle.error && withLifecycle.data) {
    return { data: withLifecycle.data, error: null }
  }
  if (
    withLifecycle.error &&
    !/lifecycle|column/i.test(withLifecycle.error.message)
  ) {
    return { data: null, error: withLifecycle.error.message }
  }

  const { data, error } = await admin
    .from('agency_profile')
    .select('id, agency_name, email')
    .eq('id', id)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Agency profile missing for this account.' }
  return { data: { ...data, lifecycle: null }, error: null }
}

export function agencyLifecycleAllowsBilling(
  lifecycle: string | null | undefined,
): boolean {
  const v = String(lifecycle ?? '').trim().toLowerCase()
  // Missing column / unknown → allow (Production before migration).
  if (!v) return true
  return v === 'prospect' || v === 'billing_pending' || v === 'active'
}

export async function getOrCreateBillingRow(
  admin: SupabaseClient,
  agencyProfileId: string,
) {
  const { data: existing, error: fetchError } = await admin
    .from('billing_subscriptions')
    .select('*')
    .eq('agency_profile_id', agencyProfileId)
    .maybeSingle()

  if (fetchError) return { data: null, error: fetchError.message }
  if (existing) return { data: existing, error: null }

  const { data: inserted, error: insertError } = await admin
    .from('billing_subscriptions')
    .insert({
      agency_profile_id: agencyProfileId,
      status: 'incomplete',
    })
    .select('*')
    .single()

  if (insertError) return { data: null, error: insertError.message }
  return { data: inserted, error: null }
}

export async function getExistingBillingRow(
  admin: SupabaseClient,
  agencyProfileId: string,
) {
  const { data, error } = await admin
    .from('billing_subscriptions')
    .select('*')
    .eq('agency_profile_id', agencyProfileId)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'No billing row exists for this workspace.' }
  return { data, error: null }
}

export type PlanKey = 'essential' | 'professional'

export function resolveRazorpayPlanId(plan: string): { plan: PlanKey; planId: string } | { error: string } {
  const key = plan.trim().toLowerCase()
  if (key !== 'essential' && key !== 'professional') {
    return { error: 'Invalid plan. Allowed values: essential, professional.' }
  }
  const envName = key === 'essential' ? 'RAZORPAY_PLAN_ESSENTIAL' : 'RAZORPAY_PLAN_PROFESSIONAL'
  const planId = (Deno.env.get(envName) ?? '').trim()
  if (!planId) {
    return {
      error: `${envName} is not set. Create the Razorpay Plan and set the Edge Function secret.`,
    }
  }
  return { plan: key, planId }
}

export function razorpayAuthHeader(): string | null {
  const keyId = (Deno.env.get('RAZORPAY_KEY_ID') ?? '').trim()
  const keySecret = (Deno.env.get('RAZORPAY_KEY_SECRET') ?? '').trim()
  if (!keyId || !keySecret) return null
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

const RAZORPAY_SUBSCRIPTION_ID_RE = /^sub_[A-Za-z0-9]+$/

/** GET-only fetch of an existing Razorpay subscription. Never POST/PATCH/PUT/DELETE. */
export async function razorpayGetSubscription(
  subscriptionId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string }> {
  const id = String(subscriptionId ?? '').trim()
  if (!RAZORPAY_SUBSCRIPTION_ID_RE.test(id)) {
    return { ok: false, status: 400, message: 'Invalid Razorpay subscription id.' }
  }
  return razorpayRequest(`/subscriptions/${id}`, { method: 'GET', body: undefined })
}

export async function razorpayRequest(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string }> {
  const auth = razorpayAuthHeader()
  if (!auth) {
    return { ok: false, status: 500, message: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.' }
  }

  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const description =
      typeof data.error === 'object' && data.error && 'description' in (data.error as object)
        ? String((data.error as { description?: string }).description ?? '')
        : ''
    const message =
      description ||
      (typeof data.error === 'string' ? data.error : '') ||
      `Razorpay API error (${res.status})`
    return { ok: false, status: res.status, message }
  }

  return { ok: true, data }
}

export function unixToIso(seconds: unknown): string | null {
  const n = typeof seconds === 'number' ? seconds : Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

export function normalizeRazorpayStatus(status: string | null | undefined): string {
  const v = (status ?? '').trim().toLowerCase()
  const allowed = new Set([
    'created',
    'authenticated',
    'active',
    'pending',
    'halted',
    'cancelled',
    'completed',
    'paused',
    'incomplete',
  ])
  if (allowed.has(v)) return v
  if (v === 'canceled') return 'cancelled'
  return 'created'
}

/** Statuses that block creating another subscription for the workspace. */
export function hasBlockingSubscription(status: string | null | undefined): boolean {
  const v = (status ?? '').trim().toLowerCase()
  return v === 'created' || v === 'authenticated' || v === 'active' || v === 'pending' || v === 'paused'
}

/**
 * Optional: prospect → billing_pending on paid/confirmed events.
 * NEVER sets lifecycle=active (ops unlock requires tenant isolation + controlled promote).
 */
export async function maybeMarkBillingPending(
  admin: SupabaseClient,
  agencyProfileId: string,
  billingStatus: string,
) {
  const s = billingStatus.trim().toLowerCase()
  if (s !== 'authenticated' && s !== 'active' && s !== 'pending') return
  await admin
    .from('agency_profile')
    .update({ lifecycle: 'billing_pending', updated_at: new Date().toISOString() })
    .eq('id', agencyProfileId)
    .eq('lifecycle', 'prospect')
}

export type MirrorSubscriptionResult =
  | { ok: true; agencyProfileId: string | null }
  | { ok: false; error: string }

/** Shared Razorpay → billing_subscriptions mirror used by webhook and GET sync. */
export async function mirrorSubscriptionEntity(
  admin: SupabaseClient,
  subscription: Record<string, unknown>,
): Promise<MirrorSubscriptionResult> {
  const subscriptionId = String(subscription.id ?? '').trim()
  if (!subscriptionId) return { ok: false, error: 'Missing subscription id' }

  const notes = asRecord(subscription.notes) ?? {}
  const agencyFromNotes = String(notes.agency_profile_id ?? '').trim() || null
  const planKeyRaw = String(notes.alza_plan ?? '').trim().toLowerCase()
  const planKey = planKeyRaw || null

  const payload: Record<string, unknown> = {
    razorpay_subscription_id: subscriptionId,
    razorpay_customer_id:
      typeof subscription.customer_id === 'string' ? subscription.customer_id : null,
    razorpay_plan_id: typeof subscription.plan_id === 'string' ? subscription.plan_id : null,
    status: normalizeRazorpayStatus(String(subscription.status ?? '')),
    current_period_start: unixToIso(subscription.current_start),
    current_period_end: unixToIso(subscription.current_end),
    charge_at: unixToIso(subscription.charge_at),
    trial_end: null,
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  }

  if (planKey) payload.plan_key = planKey
  const productKey = String(notes.alza_product ?? '').trim() || null
  const userBand = String(notes.alza_user_band ?? '').trim() || null
  const interval = String(notes.alza_interval ?? '').trim() || null
  if (productKey) payload.product_key = productKey
  if (userBand) payload.user_band_key = userBand
  if (interval) payload.billing_interval = interval

  const status = String(payload.status)
  if (status === 'cancelled' || status === 'completed') {
    payload.canceled_at = unixToIso(subscription.ended_at) ?? new Date().toISOString()
  }

  const bySub = await admin
    .from('billing_subscriptions')
    .update(payload)
    .eq('razorpay_subscription_id', subscriptionId)
    .select('id, agency_profile_id')
  if (!bySub.error && (bySub.data?.length ?? 0) > 0) {
    const agencyId = String(bySub.data?.[0]?.agency_profile_id ?? agencyFromNotes ?? '')
    if (agencyId) await maybeMarkBillingPending(admin, agencyId, status)
    return { ok: true, agencyProfileId: agencyId || agencyFromNotes }
  }

  const customerId =
    typeof subscription.customer_id === 'string' ? subscription.customer_id : null
  if (customerId) {
    const byCustomer = await admin
      .from('billing_subscriptions')
      .update(payload)
      .eq('razorpay_customer_id', customerId)
      .select('id, agency_profile_id')
    if (!byCustomer.error && (byCustomer.data?.length ?? 0) > 0) {
      const agencyId = String(byCustomer.data?.[0]?.agency_profile_id ?? agencyFromNotes ?? '')
      if (agencyId) await maybeMarkBillingPending(admin, agencyId, status)
      return { ok: true, agencyProfileId: agencyId || agencyFromNotes }
    }
  }

  if (agencyFromNotes) {
    const byAgency = await admin
      .from('billing_subscriptions')
      .update(payload)
      .eq('agency_profile_id', agencyFromNotes)
      .select('id, agency_profile_id')
    if (!byAgency.error && (byAgency.data?.length ?? 0) > 0) {
      await maybeMarkBillingPending(admin, agencyFromNotes, status)
      return { ok: true, agencyProfileId: agencyFromNotes }
    }
  }

  return {
    ok: false,
    error: 'No billing_subscriptions row matched this Razorpay subscription.',
  }
}
