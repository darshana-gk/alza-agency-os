import { isAdminDirectoryRole, isAlzaSupportRole, type RoleInput } from '../permissions'

/** Integration Center management: Owner/Admin only. Not ALZA Support staff. */
export function canAccessIntegrations(role: RoleInput): boolean {
  if (isAlzaSupportRole(role) && !isAdminDirectoryRole(role)) return false
  return isAdminDirectoryRole(role)
}

export function canManageIntegrationConnections(role: RoleInput): boolean {
  return canAccessIntegrations(role)
}

export const ONBOARDING_FALLBACK_PATH = '/onboarding' as const
export const RECONCILIATION_FALLBACK_PATH = '/reconciliation' as const
export const INTEGRATIONS_PATH = '/integrations' as const

/** Existing Support Center category — no new Support enum / migration. */
export const INTEGRATION_SUPPORT_CATEGORY = 'feature_request' as const

export const INTEGRATION_SUPPORT_MESSAGE =
  'Please describe the system you need connected and how you use it. Do not include API keys, passwords, tokens, or other credentials.'

export function integrationSupportRequestPath(providerName: string): string {
  const params = new URLSearchParams({
    category: INTEGRATION_SUPPORT_CATEGORY,
    subject: `Request integration: ${providerName.trim()}`,
    message: INTEGRATION_SUPPORT_MESSAGE,
  })
  return `/support?${params.toString()}`
}
