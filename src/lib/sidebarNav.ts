/** Pure sidebar nav decisions — testable without React. */

import {
  canAccessPath,
  getNavVisibility,
  type NavVisibility,
  type RoleInput,
} from './permissions'

export type SidebarNavItemSpec = {
  label: string
  path: string
  section: 'main' | 'administration'
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
    items.push({ label: 'Onboarding Import', path: '/onboarding', section: 'administration' })
  }
  if (nav.producers) {
    items.push({ label: 'Producers', path: '/admin/producers', section: 'administration' })
  }
  if (nav.csrs) items.push({ label: 'CSRs', path: '/admin/csrs', section: 'administration' })
  if (nav.mgas) items.push({ label: 'MGAs', path: '/admin/mgas', section: 'administration' })
  if (nav.carriers) {
    items.push({ label: 'Carriers', path: '/admin/carriers', section: 'administration' })
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

export function sidebarNavForRole(
  role: RoleInput,
  lifecycle?: import('./agencyLifecycle').AgencyLifecycle | null,
): SidebarNavItemSpec[] {
  return buildSidebarNavItems(getNavVisibility(role, lifecycle))
}

export function roleCanOpenOnboarding(
  role: RoleInput,
  lifecycle?: import('./agencyLifecycle').AgencyLifecycle | null,
): boolean {
  return canAccessPath(role, '/onboarding', lifecycle)
}
