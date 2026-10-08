import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { fail } from './http.ts'
import {
  CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
  cancelledSubscriptionMirrorAction,
  subscriptionIdsConflict,
  tenantNoteConflicts,
} from './razorpayCancellation.ts'

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

export type RazorpayCancellationDiscrepancy = {
  code: typeof CANCELLED_SUBSCRIPTION_PAYMENT_CODE
  subscriptionId: string
  agencyProfileId: string
  localStatus: string
  remoteStatus: string
}

export type MirrorSubscriptionResult =
  | {
      ok: true
      agencyProfileId: string | null
      applied: boolean
      discrepancy: RazorpayCancellationDiscrepancy | null
    }
  | { ok: false; error: string }

type BillingMirrorRow = {
  id: string
  agency_profile_id: string | null
  status: string | null
  razorpay_subscription_id: string | null
}

async function selectBillingRows(
  admin: SupabaseClient,
  column: 'razorpay_subscription_id' | 'razorpay_customer_id' | 'agency_profile_id',
  value: string,
): Promise<{ rows: BillingMirrorRow[] | null; error: string | null }> {
  const { data, error } = await admin
    .from('billing_subscriptions')
    .select('id, agency_profile_id, status, razorpay_subscription_id')
    .eq(column, value)
  if (error) return { rows: null, error: error.message }
  return { rows: (data ?? []) as BillingMirrorRow[], error: null }
}

async function lookupMirrorRow(
  admin: SupabaseClient,
  subscription: Record<string, unknown>,
  remoteStatus: string,
): Promise<
  | {
      ok: true
      row: BillingMirrorRow
      subscriptionId: string
      agencyFromNotes: string | null
      remoteStatus: string
    }
  | { ok: false; error: string }
> {
  const subscriptionId = String(subscription.id ?? '').trim()
  if (!subscriptionId) return { ok: false, error: 'Missing subscription id' }

  const notes = asRecord(subscription.notes) ?? {}
  const agencyFromNotes = String(notes.agency_profile_id ?? '').trim() || null

  const bySub = await selectBillingRows(admin, 'razorpay_subscription_id', subscriptionId)
  if (bySub.error) return { ok: false, error: bySub.error }
  if ((bySub.rows?.length ?? 0) > 1) {
    return { ok: false, error: 'More than one workspace is linked to this Razorpay subscription.' }
  }
  if (bySub.rows?.length === 1) {
    return { ok: true, row: bySub.rows[0], subscriptionId, agencyFromNotes, remoteStatus }
  }

  const customerId = typeof subscription.customer_id === 'string' ? subscription.customer_id.trim() : ''
  if (customerId) {
    const byCustomer = await selectBillingRows(admin, 'razorpay_customer_id', customerId)
    if (byCustomer.error) return { ok: false, error: byCustomer.error }
    const fallback = singleUnclaimedRow(byCustomer.rows ?? [], subscriptionId, agencyFromNotes)
    if (fallback && 'error' in fallback) return { ok: false, error: fallback.error }
    if (fallback) return { ok: true, row: fallback, subscriptionId, agencyFromNotes, remoteStatus }
  }

  if (agencyFromNotes) {
    const byAgency = await selectBillingRows(admin, 'agency_profile_id', agencyFromNotes)
    if (byAgency.error) return { ok: false, error: byAgency.error }
    const fallback = singleUnclaimedRow(byAgency.rows ?? [], subscriptionId, agencyFromNotes)
    if (fallback && 'error' in fallback) return { ok: false, error: fallback.error }
    if (fallback) return { ok: true, row: fallback, subscriptionId, agencyFromNotes, remoteStatus }
  }

  return {
    ok: false,
    error: 'No billing_subscriptions row matched this Razorpay subscription.',
  }
}

/**
 * Read-only check for a payment reported after local cancellation.
 * Never updates a billing row and never promotes a workspace.
 */
export async function findCancellationPaymentDiscrepancy(
  admin: SupabaseClient,
  subscription: Record<string, unknown>,
): Promise<
  | { ok: true; discrepancy: RazorpayCancellationDiscrepancy | null }
  | { ok: false; error: string }
> {
  const remoteStatus = normalizeRazorpayStatus(String(subscription.status ?? ''))
  const found = await lookupMirrorRow(admin, subscription, remoteStatus)
  if (!found.ok) {
    if (found.error === 'No billing_subscriptions row matched this Razorpay subscription.') {
      return { ok: true, discrepancy: null }
    }
    return found
  }
  if (tenantNoteConflicts(found.agencyFromNotes, found.row.agency_profile_id)) {
    return { ok: false, error: 'Subscription notes do not match this workspace.' }
  }
  if (cancelledSubscriptionMirrorAction(found.row.status, found.remoteStatus) !== 'discrepancy') {
    return { ok: true, discrepancy: null }
  }
  const agencyProfileId = String(found.row.agency_profile_id ?? '').trim()
  if (!agencyProfileId) return { ok: false, error: 'Billing row is not linked to a workspace.' }
  return {
    ok: true,
    discrepancy: {
      code: CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
      subscriptionId: found.subscriptionId,
      agencyProfileId,
      localStatus: String(found.row.status ?? ''),
      remoteStatus: found.remoteStatus,
    },
  }
}

/** Shared Razorpay → billing_subscriptions mirror used by webhook and GET sync. */
export async function mirrorSubscriptionEntity(
  admin: SupabaseClient,
  subscription: Record<string, unknown>,
): Promise<MirrorSubscriptionResult> {
  const subscriptionId = String(subscription.id ?? '').trim()
  if (!subscriptionId) return { ok: false, error: 'Missing subscription id' }

  const notes = asRecord(subscription.notes) ?? {}
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

  const found = await lookupMirrorRow(admin, subscription, status)
  if (!found.ok) return { ok: false, error: found.error }
  return applyMirroredSubscription(
    admin,
    found.row,
    found.subscriptionId,
    found.agencyFromNotes,
    payload,
    found.remoteStatus,
  )
}

function singleUnclaimedRow(
  rows: BillingMirrorRow[],
  subscriptionId: string,
  agencyFromNotes: string | null,
): BillingMirrorRow | { error: string } | null {
  const eligible = rows.filter((row) => !subscriptionIdsConflict(row.razorpay_subscription_id, subscriptionId))
  if (eligible.length === 0) return null
  if (eligible.length > 1) return { error: 'More than one billing row matched this Razorpay event.' }
  if (tenantNoteConflicts(agencyFromNotes, eligible[0].agency_profile_id)) {
    return { error: 'Subscription notes do not match this workspace.' }
  }
  return eligible[0]
}

async function applyMirroredSubscription(
  admin: SupabaseClient,
  row: BillingMirrorRow,
  subscriptionId: string,
  agencyFromNotes: string | null,
  payload: Record<string, unknown>,
  remoteStatus: string,
): Promise<MirrorSubscriptionResult> {
  const agencyProfileId = String(row.agency_profile_id ?? '').trim()
  if (!agencyProfileId) return { ok: false, error: 'Billing row is not linked to a workspace.' }
  if (tenantNoteConflicts(agencyFromNotes, agencyProfileId)) {
    return { ok: false, error: 'Subscription notes do not match this workspace.' }
  }

  const action = cancelledSubscriptionMirrorAction(row.status, remoteStatus)
  if (action === 'discrepancy') {
    return {
      ok: true,
      agencyProfileId,
      applied: false,
      discrepancy: {
        code: CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
        subscriptionId,
        agencyProfileId,
        localStatus: String(row.status ?? ''),
        remoteStatus,
      },
    }
  }
  if (action === 'hold') {
    return { ok: true, agencyProfileId, applied: false, discrepancy: null }
  }

  let update = admin
    .from('billing_subscriptions')
    .update(payload)
    .eq('id', row.id)
    .eq('agency_profile_id', agencyProfileId)
  const storedSubscriptionId = String(row.razorpay_subscription_id ?? '').trim()
  if (storedSubscriptionId) {
    update = update.eq('razorpay_subscription_id', subscriptionId)
  } else {
    update = update.is('razorpay_subscription_id', null)
  }

  const { data, error } = await update.select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) {
    return { ok: false, error: 'Billing row changed before the Razorpay event was saved.' }
  }

  await maybeMarkBillingPending(admin, agencyProfileId, remoteStatus)
  return { ok: true, agencyProfileId, applied: true, discrepancy: null }
}
