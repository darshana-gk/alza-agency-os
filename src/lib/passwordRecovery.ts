import { homePathForRoles, type RoleInput } from './permissions'

/** Matches the existing invite Set Password rule. */
export const MIN_PASSWORD_LENGTH = 8

export const RESET_PASSWORD_PATH = '/auth/reset-password'

/** Shown when Auth refuses another recovery email (project-wide or per-user send limit). */
export const PASSWORD_RECOVERY_RATE_LIMIT_COPY =
  'Too many password reset requests were made. Please wait a few minutes and try again, or contact ALZA Support.'

const EMAIL_RATE_LIMIT_CODE = 'over_email_send_rate_limit'
const EMAIL_RATE_LIMIT_MESSAGE = 'email rate limit exceeded'
const EMAIL_FREQUENCY_MESSAGE =
  /^for security purposes, you can only request this after \d+ seconds\.?$/i

type AuthErrorLike = {
  message?: string | null
  code?: string | null
  status?: number | null
}

export function isPasswordRecoveryRateLimitError(error: AuthErrorLike | null | undefined): boolean {
  const code = String(error?.code ?? '').trim().toLowerCase()
  if (code === EMAIL_RATE_LIMIT_CODE) return true
  const message = String(error?.message ?? '').trim()
  if (message.toLowerCase().includes(EMAIL_RATE_LIMIT_MESSAGE)) return true
  if (EMAIL_FREQUENCY_MESSAGE.test(message)) return true
  return false
}

/** Map resetPasswordForEmail failures. Rate-limits get friendly copy; all other errors stay as returned. */
export function passwordRecoveryRequestErrorMessage(
  error: AuthErrorLike | null | undefined,
): string {
  if (!error) return ''
  if (isPasswordRecoveryRateLimitError(error)) return PASSWORD_RECOVERY_RATE_LIMIT_COPY
  return String(error.message ?? '').trim()
}

export const RECOVERY_PENDING_STORAGE_KEY = 'alza.passwordRecoveryPending'

const NON_RECOVERY_TYPES = new Set(['signup', 'invite', 'magiclink', 'email', 'email_change'])

export function parseAuthCallbackParams(href: string): URLSearchParams {
  const url = new URL(href, 'https://alza.local')
  const merged = new URLSearchParams(url.search)
  const hash = url.hash.replace(/^#/, '')
  if (hash) {
    const fromHash = new URLSearchParams(hash)
    fromHash.forEach((value, key) => {
      merged.set(key, value)
    })
  }
  return merged
}

export function isResetPasswordPath(href: string): boolean {
  try {
    const url = new URL(href, 'https://alza.local')
    return (
      url.pathname === RESET_PASSWORD_PATH || url.pathname.startsWith(`${RESET_PASSWORD_PATH}/`)
    )
  } catch {
    return false
  }
}

/**
 * True when the browser URL is a Supabase password-recovery callback.
 * Does not require `type=recovery` to remain after detectSessionInUrl strips the hash.
 */
export function urlIndicatesPasswordRecovery(href: string): boolean {
  try {
    const url = new URL(href, 'https://alza.local')
    if (url.pathname === '/auth/set-password' || url.pathname.startsWith('/auth/set-password/')) {
      return false
    }
    if (isResetPasswordPath(href)) {
      const type = parseAuthCallbackParams(href).get('type')
      if (type && NON_RECOVERY_TYPES.has(type)) return false
      return true
    }
    const params = parseAuthCallbackParams(href)
    const type = params.get('type')
    if (type === 'recovery') return true
    if (type && NON_RECOVERY_TYPES.has(type)) return false
    return false
  } catch {
    return false
  }
}

export function getRecoveryTokenHash(href: string): string | null {
  try {
    const params = parseAuthCallbackParams(href)
    const type = params.get('type')
    if (type && type !== 'recovery') return null
    const tokenHash = (params.get('token_hash') || '').trim()
    if (!tokenHash) return null
    if (type === 'recovery' || isResetPasswordPath(href)) return tokenHash
    return null
  } catch {
    return null
  }
}

export function passwordResetRedirectTo(origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${RESET_PASSWORD_PATH}`
}

export function markPasswordRecoveryPending(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(RECOVERY_PENDING_STORAGE_KEY, '1')
  } catch {
    // sessionStorage may be blocked
  }
}

export function clearPasswordRecoveryPending(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(RECOVERY_PENDING_STORAGE_KEY)
  } catch {
    // sessionStorage may be blocked
  }
}

export function isStoredPasswordRecoveryPending(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(RECOVERY_PENDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Stamp sessionStorage when the URL still has recovery signals, before the hash is cleared. */
export function capturePasswordRecoveryFromLocation(href?: string): boolean {
  if (typeof window === 'undefined') return false
  const found = urlIndicatesPasswordRecovery(href ?? window.location.href)
  if (found) markPasswordRecoveryPending()
  return found || isStoredPasswordRecoveryPending()
}

export function isPasswordRecoveryPending(href?: string): boolean {
  if (typeof window === 'undefined') return false
  return (
    isStoredPasswordRecoveryPending() ||
    urlIndicatesPasswordRecovery(href ?? window.location.href)
  )
}

export function validateNewPassword(
  password: string,
  confirm: string,
): { ok: true } | { ok: false; error: string } {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }
  if (password !== confirm) {
    return { ok: false, error: 'Passwords do not match.' }
  }
  return { ok: true }
}

export function postPasswordResetPath(role: RoleInput): string {
  return homePathForRoles(role)
}

// Capture before createClient() runs when this module is imported first from auth.tsx.
if (typeof window !== 'undefined') {
  capturePasswordRecoveryFromLocation(window.location.href)
}
