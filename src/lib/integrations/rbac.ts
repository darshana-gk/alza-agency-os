import { isAdminDirectoryRole, type RoleInput } from '../permissions'

/** Integration Center management: Owner/Admin only. */
export function canAccessIntegrations(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canManageIntegrationConnections(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export const ONBOARDING_FALLBACK_PATH = '/onboarding' as const
export const INTEGRATIONS_PATH = '/integrations' as const
