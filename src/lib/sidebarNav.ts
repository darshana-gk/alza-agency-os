/** Pure sidebar nav decisions — testable without React. */

import {
  canAccessPath,
  getNavVisibility,
  type NavVisibility,
  type RoleInput,
} from './permissions'

export type AdminNavUmbrella = 'data_integrations' | 'agency_network'

export type SidebarNavItemSpec = {
  label: string
  path: string
  section: 'main' | 'administration'
  /** Administration-only umbrella. Standalone admin items omit this. */
  adminGroup?: AdminNavUmbrella
}

/** Same placement rules the Sidebar UI uses. */
export function buildSidebarNavItems(nav: NavVisibility): SidebarNavItemSpec[] {
  const items: SidebarNavItemSpec[] = []

  if (nav.dashboard) items.push({ label: 'Dashboard', path: '/', section: 'main' })
  if (nav.clients) items.push({ label: 'Clients', path: '/clients', section: 'main' })
  if (nav.policyFiles) items.push({ label: 'Policy Files', path: '/policy-files', section: 'main' })
  if (nav.transactions) {
    items.push({ label: 'Transactions', path: '/transactions', section: 'main' })
  }
  if (nav.financials) items.push({ label: 'Financials', path: '/financials', section: 'main' })
  if (nav.reconciliation) {
    items.push({ label: 'Reconciliation', path: '/reconciliation', section: 'main' })
  }
  if (nav.reports) items.push({ label: 'Reports', path: '/reports', section: 'main' })
  if (nav.activityHistory) {
    items.push({ label: 'Activity History', path: '/activity', section: 'main' })
  }
  if (nav.support) items.push({ label: 'Help & Support', path: '/support', section: 'main' })
  if (nav.alzaSupportInbox) {
    items.push({ label: 'ALZA Support Inbox', path: '/admin/support-inbox', section: 'main' })
  }

  // Owner/Admin-only onboarding belongs under Administration (not main ops nav).
  if (nav.onboardingImport) {
    items.push({
      label: 'Onboarding Import',
      path: '/onboarding',
      section: 'administration',
      adminGroup: 'data_integrations',
    })
  }
  if (nav.integrations) {
    items.push({
      label: 'Integrations',
      path: '/integrations',
      section: 'administration',
      adminGroup: 'data_integrations',
    })
  }
  if (nav.producers) {
    items.push({
      label: 'Producers',
      path: '/admin/producers',
      section: 'administration',
      adminGroup: 'agency_network',
    })
  }
  if (nav.csrs) {
    items.push({
      label: 'CSRs',
      path: '/admin/csrs',
      section: 'administration',
      adminGroup: 'agency_network',
    })
  }
  if (nav.mgas) {
    items.push({
      label: 'MGAs',
      path: '/admin/mgas',
      section: 'administration',
      adminGroup: 'agency_network',
    })
  }
  if (nav.carriers) {
    items.push({
      label: 'Carriers',
      path: '/admin/carriers',
      section: 'administration',
      adminGroup: 'agency_network',
    })
  }
  if (nav.users) items.push({ label: 'Users', path: '/admin/users', section: 'administration' })
  if (nav.agencySettings) {
    items.push({
      label: 'Agency Settings',
      path: '/admin/agency-settings',
      section: 'administration',
    })
  }
  if (nav.subscriptionBilling) {
    items.push({
      label: 'Subscription & Billing',
      path: '/admin/subscription-billing',
      section: 'administration',
    })
  }

  return items
}

export function sidebarNavForRole(role: RoleInput): SidebarNavItemSpec[] {
  return buildSidebarNavItems(getNavVisibility(role))
}

export function roleCanOpenOnboarding(role: RoleInput): boolean {
  return canAccessPath(role, '/onboarding')
}

export function roleCanOpenIntegrations(role: RoleInput): boolean {
  return canAccessPath(role, '/integrations')
}

export const ADMIN_UMBRELLA_LABELS: Record<AdminNavUmbrella, string> = {
  data_integrations: 'Data & Integrations',
  agency_network: 'Agency Network',
}

export function navItemMatchesPath(itemPath: string, pathname: string): boolean {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function adminGroupHasActivePath(
  items: Pick<SidebarNavItemSpec, 'path' | 'adminGroup'>[],
  group: AdminNavUmbrella,
  pathname: string,
): boolean {
  return items.some(
    (item) => item.adminGroup === group && navItemMatchesPath(item.path, pathname),
  )
}
