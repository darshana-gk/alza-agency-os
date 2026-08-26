/**
 * Agency lifecycle for prospect signup + restricted billing identity.
 * Paid Razorpay must never imply ops-active.
 */

export const AGENCY_LIFECYCLES = [
  'prospect',
  'billing_pending',
  'active',
  'suspended',
] as const

export type AgencyLifecycle = (typeof AGENCY_LIFECYCLES)[number]

/** Default when column missing / not loaded — preserves Production singleton behavior. */
export const DEFAULT_AGENCY_LIFECYCLE_WHEN_UNKNOWN: AgencyLifecycle = 'active'

export function isAgencyLifecycle(value: string | null | undefined): value is AgencyLifecycle {
  return (AGENCY_LIFECYCLES as readonly string[]).includes(String(value ?? '').trim().toLowerCase())
}

export function normalizeAgencyLifecycle(
  value: string | null | undefined,
): AgencyLifecycle {
  const v = String(value ?? '').trim().toLowerCase()
  if (isAgencyLifecycle(v)) return v
  return DEFAULT_AGENCY_LIFECYCLE_WHEN_UNKNOWN
}

/** Ops app (clients, financials, onboarding, directory, …) — active only. */
export function agencyAllowsOpsAccess(lifecycle: AgencyLifecycle | null | undefined): boolean {
  return normalizeAgencyLifecycle(lifecycle) === 'active'
}

/** Restricted shell: billing, agency settings, support (includes suspended for support/settings). */
export function agencyAllowsRestrictedShell(
  lifecycle: AgencyLifecycle | null | undefined,
): boolean {
  const v = normalizeAgencyLifecycle(lifecycle)
  return (
    v === 'prospect' ||
    v === 'billing_pending' ||
    v === 'active' ||
    v === 'suspended'
  )
}

export function agencyAllowsBillingCheckout(
  lifecycle: AgencyLifecycle | null | undefined,
): boolean {
  const v = normalizeAgencyLifecycle(lifecycle)
  return v === 'prospect' || v === 'billing_pending' || v === 'active'
}

/** Paths allowed for non-active (prospect / billing_pending / suspended treated as blocked for ops). */
export function isRestrictedShellPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '/'
  if (path.startsWith('/admin/subscription-billing')) return true
  if (path.startsWith('/admin/agency-settings')) return true
  if (path.startsWith('/support') || path.startsWith('/help')) return true
  if (path.startsWith('/auth/')) return true
  return false
}

export const PROSPECT_HOME_PATH = '/admin/subscription-billing'
