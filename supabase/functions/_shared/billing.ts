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
  | { ok: true; authUserId: string; profileId: string }
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
    .select('id, role, status, archived_at')
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

  return { ok: true, authUserId: user.id, profileId: String(profile.id) }
}

export async function getSingletonAgency(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('agency_profile')
    .select('id, agency_name, email')
    .limit(1)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'agency_profile is missing.' }
  return { data, error: null }
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
