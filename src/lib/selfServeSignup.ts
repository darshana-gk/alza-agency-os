import { supabase } from './supabase'

export type SelfServeSignupInput = {
  fullName: string
  agencyName: string
  email: string
  password: string
  /** Optional Phase 2 purchase intent */
  product?: string | null
  userBand?: string | null
  interval?: 'monthly' | 'annual' | null
  planKey?: string | null
}

export type SelfServeSignupResult = {
  agencyId: string | null
  ownerUserId: string | null
  email: string
  role: string
  billingIntentId: string | null
  error: string | null
  code: string | null
}

/**
 * Public self-serve signup. Browser never sees the service role.
 * Server creates Auth user + agency + Owner, then client signs in with password.
 */
export async function createSelfServeAgencySignup(
  input: SelfServeSignupInput,
): Promise<SelfServeSignupResult> {
  const body: Record<string, unknown> = {
    fullName: input.fullName.trim(),
    agencyName: input.agencyName.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
  }
  if (input.product) body.product = input.product
  if (input.userBand) body.userBand = input.userBand
  if (input.interval) body.interval = input.interval
  if (input.planKey) body.planKey = input.planKey

  const { data, error } = await supabase.functions.invoke('create-agency-signup', { body })

  if (error) {
    const fromBody =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message?: string }).message ?? '')
        : ''
    return {
      agencyId: null,
      ownerUserId: null,
      email: input.email,
      role: '',
      billingIntentId: null,
      error: fromBody || error.message || 'Unable to create account.',
      code:
        data && typeof data === 'object' && 'code' in data
          ? String((data as { code?: string }).code ?? '')
          : 'invoke_failed',
    }
  }

  const payload = (data ?? {}) as Record<string, unknown>
  if (payload.ok === false) {
    return {
      agencyId: null,
      ownerUserId: null,
      email: input.email,
      role: '',
      billingIntentId: null,
      error: String(payload.message ?? 'Unable to create account.'),
      code: String(payload.code ?? 'signup_failed'),
    }
  }

  return {
    agencyId: payload.agencyId ? String(payload.agencyId) : null,
    ownerUserId: payload.ownerUserId ? String(payload.ownerUserId) : null,
    email: String(payload.email ?? input.email),
    role: String(payload.role ?? 'owner'),
    billingIntentId: payload.billingIntentId ? String(payload.billingIntentId) : null,
    error: null,
    code: null,
  }
}
