import { supabase } from './supabase'

export const SELF_SERVE_SIGNUP_LIMITS = {
  fullName: 120,
  fullNameMin: 2,
  agencyName: 160,
  agencyNameMin: 2,
  jobTitle: 120,
  jobTitleMin: 2,
  workPhone: 40,
  workPhoneDigitMin: 7,
  workPhoneDigitMax: 15,
  email: 254,
  passwordMin: 8,
} as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_CHARS_RE = /^\+?[\d\s().\-]+$/

export type SelfServeSignupInput = {
  fullName: string
  agencyName: string
  jobTitle: string
  workPhone: string
  email: string
  password: string
  confirmPassword?: string
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

export type SelfServeSignupValidation =
  | {
      ok: true
      value: {
        fullName: string
        agencyName: string
        jobTitle: string
        workPhone: string
        email: string
      }
    }
  | { ok: false; code: string; message: string }

export function digitsFromWorkPhone(value: string): string {
  return value.replace(/\D/g, '')
}

export function isValidWorkPhone(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > SELF_SERVE_SIGNUP_LIMITS.workPhone) return false
  if (!PHONE_CHARS_RE.test(trimmed)) return false
  const digits = digitsFromWorkPhone(trimmed)
  return (
    digits.length >= SELF_SERVE_SIGNUP_LIMITS.workPhoneDigitMin &&
    digits.length <= SELF_SERVE_SIGNUP_LIMITS.workPhoneDigitMax
  )
}

export function validateSelfServeSignupProfile(
  input: Pick<SelfServeSignupInput, 'fullName' | 'agencyName' | 'jobTitle' | 'workPhone' | 'email'> & {
    password?: string
    confirmPassword?: string
  },
): SelfServeSignupValidation {
  const fullName = String(input.fullName ?? '').trim().replace(/\s+/g, ' ')
  const agencyName = String(input.agencyName ?? '').trim().replace(/\s+/g, ' ')
  const jobTitle = String(input.jobTitle ?? '').trim().replace(/\s+/g, ' ')
  const workPhone = String(input.workPhone ?? '').trim()
  const email = String(input.email ?? '').trim().toLowerCase()

  if (!fullName || fullName.length < SELF_SERVE_SIGNUP_LIMITS.fullNameMin) {
    return { ok: false, code: 'invalid_name', message: 'Enter your full name.' }
  }
  if (fullName.length > SELF_SERVE_SIGNUP_LIMITS.fullName) {
    return { ok: false, code: 'name_too_long', message: 'Full name is too long.' }
  }
  if (!agencyName || agencyName.length < SELF_SERVE_SIGNUP_LIMITS.agencyNameMin) {
    return { ok: false, code: 'invalid_agency', message: 'Enter your company name.' }
  }
  if (agencyName.length > SELF_SERVE_SIGNUP_LIMITS.agencyName) {
    return { ok: false, code: 'agency_too_long', message: 'Company name is too long.' }
  }
  if (!jobTitle || jobTitle.length < SELF_SERVE_SIGNUP_LIMITS.jobTitleMin) {
    return { ok: false, code: 'invalid_job_title', message: 'Enter your job title or designation.' }
  }
  if (jobTitle.length > SELF_SERVE_SIGNUP_LIMITS.jobTitle) {
    return { ok: false, code: 'job_title_too_long', message: 'Job title is too long.' }
  }
  if (!email) {
    return { ok: false, code: 'invalid_email', message: 'Enter a valid work email.' }
  }
  if (email.length > SELF_SERVE_SIGNUP_LIMITS.email || !EMAIL_RE.test(email)) {
    return { ok: false, code: 'invalid_email', message: 'Enter a valid work email.' }
  }
  if (!workPhone) {
    return { ok: false, code: 'invalid_phone', message: 'Enter your work phone.' }
  }
  if (!isValidWorkPhone(workPhone)) {
    return {
      ok: false,
      code: 'invalid_phone',
      message: 'Enter a valid work phone, including country code if applicable.',
    }
  }
  if (input.password !== undefined) {
    if (!input.password) {
      return { ok: false, code: 'invalid_password', message: 'Password must be at least 8 characters.' }
    }
    if (input.password.length < SELF_SERVE_SIGNUP_LIMITS.passwordMin) {
      return { ok: false, code: 'invalid_password', message: 'Password must be at least 8 characters.' }
    }
  }
  if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
    return { ok: false, code: 'password_mismatch', message: 'Passwords do not match.' }
  }

  return {
    ok: true,
    value: { fullName, agencyName, jobTitle, workPhone, email },
  }
}

/**
 * Public self-serve signup. Browser never sees the service role.
 * Server creates Auth user + agency + Owner, then client signs in with password.
 */
export async function createSelfServeAgencySignup(
  input: SelfServeSignupInput,
): Promise<SelfServeSignupResult> {
  const checked = validateSelfServeSignupProfile(input)
  if (!checked.ok) {
    return {
      agencyId: null,
      ownerUserId: null,
      email: input.email,
      role: '',
      billingIntentId: null,
      error: checked.message,
      code: checked.code,
    }
  }

  const body: Record<string, unknown> = {
    fullName: checked.value.fullName,
    agencyName: checked.value.agencyName,
    jobTitle: checked.value.jobTitle,
    workPhone: checked.value.workPhone,
    email: checked.value.email,
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
