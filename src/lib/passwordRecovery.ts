import { isAlzaSupportRole, type RoleInput } from './permissions'

/** Matches the existing invite Set Password rule. */
export const MIN_PASSWORD_LENGTH = 8

export const RESET_PASSWORD_PATH = '/auth/reset-password'

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
  if (isAlzaSupportRole(role)) return '/admin/support-inbox'
  return '/'
}

// Capture before createClient() runs when this module is imported first from auth.tsx.
if (typeof window !== 'undefined') {
  capturePasswordRecoveryFromLocation(window.location.href)
}
