import { isAlzaSupportRole, type RoleInput } from './permissions'

/** Matches the existing invite Set Password rule. */
export const MIN_PASSWORD_LENGTH = 8

export const RESET_PASSWORD_PATH = '/auth/reset-password'

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

/** True when the browser URL is a Supabase password-recovery callback. */
export function urlIndicatesPasswordRecovery(href: string): boolean {
  try {
    const url = new URL(href, 'https://alza.local')
    if (
      url.pathname === RESET_PASSWORD_PATH ||
      url.pathname.startsWith(`${RESET_PASSWORD_PATH}/`)
    ) {
      return true
    }
    return parseAuthCallbackParams(href).get('type') === 'recovery'
  } catch {
    return false
  }
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
