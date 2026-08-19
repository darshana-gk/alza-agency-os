import type { AppUserProfile } from './auth'
import { supabase } from './supabase'

/** Supported public.users.role / user_roles.role values. */
export const APP_ROLES = ['owner', 'admin', 'csr', 'producer', 'viewer'] as const
export type AppRole = (typeof APP_ROLES)[number]

/** Single role string or additive roles array (multi-role). */
export type RoleInput = string | string[] | null | undefined

export function normalizeAppRole(role: string | null | undefined): AppRole | null {
  const value = (role ?? '').trim().toLowerCase()
  return (APP_ROLES as readonly string[]).includes(value) ? (value as AppRole) : null
}

export function isAppRole(role: string | null | undefined): role is AppRole {
  return normalizeAppRole(role) !== null
}

export function toAppRoles(input: RoleInput): AppRole[] {
  if (Array.isArray(input)) {
    const roles = input
      .map((r) => normalizeAppRole(r))
      .filter((r): r is AppRole => Boolean(r))
    return [...new Set(roles)]
  }
  const one = normalizeAppRole(input)
  return one ? [one] : []
}

/** Prefer highest-privilege role for legacy single-role fields. */
export function primaryAppRole(roles: AppRole[]): AppRole | null {
  for (const role of ['owner', 'admin', 'csr', 'producer', 'viewer'] as AppRole[]) {
    if (roles.includes(role)) return role
  }
  return null
}

/** Match producers.producer_name ↔ clients/policies/transactions.producer TEXT. */
export function normalizeProducerKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function producerKeysMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeProducerKey(left)
  const b = normalizeProducerKey(right)
  return Boolean(a) && Boolean(b) && a === b
}

/**
 * CSR identity match for notifications/dashboard.
 * Exact match preferred; also allow "Reese" ↔ "Reese Krishna" style containment
 * when one normalized name fully contains the other as a whole-name prefix/suffix set.
 */
/**
 * Match transaction.csr TEXT to a logged-in CSR user.
 * Accepts exact, normalized, and given-name matches (e.g. "Reese" ↔ "Reese Krishna").
 * Does not require the CSR directory row to use the exact same string as users.full_name.
 */
export function csrIdentityMatches(
  transactionCsr: string | null | undefined,
  userFullName: string | null | undefined,
  userEmail?: string | null | undefined,
): boolean {
  if (producerKeysMatch(transactionCsr, userFullName)) return true
  const a = normalizeProducerKey(transactionCsr)
  const b = normalizeProducerKey(userFullName)
  if (!a || !b) {
    // Fall back: email local-part vs CSR text (e.g. reese@… ↔ Reese)
    const local = normalizeProducerKey((userEmail ?? '').split('@')[0] ?? '')
    if (a && local && (a === local || a.startsWith(local) || local.startsWith(a))) return true
    return false
  }
  if (a === b) return true
  if (a.startsWith(b) || b.startsWith(a)) return true
  const aTokens = a.split(' ').filter((t) => t.length >= 2)
  const bTokens = b.split(' ').filter((t) => t.length >= 2)
  if (aTokens.length === 0 || bTokens.length === 0) return false
  const overlap = aTokens.filter((t) => bTokens.includes(t))
  // Given-name match: first tokens equal (Reese ↔ Reese Krishna)
  if (aTokens[0] && aTokens[0] === bTokens[0]) return true
  return overlap.includes(aTokens[0]) && overlap.includes(bTokens[0])
}

/**
 * Match transaction CSR assignment to the logged-in user.
 * Prefer stable csr_user_id when present; fall back to name/email identity.
 */
export function csrAssignmentMatches(params: {
  csrUserId?: string | null
  csrName?: string | null
  profileId?: string | null
  profileFullName?: string | null
  profileEmail?: string | null
}): boolean {
  const profileId = (params.profileId ?? '').trim()
  const csrUserId = (params.csrUserId ?? '').trim()
  if (profileId && csrUserId) return profileId === csrUserId
  return csrIdentityMatches(params.csrName, params.profileFullName, params.profileEmail)
}

/** Prefer additive roles[]; fall back to primary role string. */
export function roleInputFromProfile(
  profile: Pick<AppUserProfile, 'role' | 'roles'> | null | undefined,
): RoleInput {
  if (!profile) return null
  if (profile.roles?.length) return profile.roles
  return profile.role
}

/**
 * Broadest operational visibility for record lists (Clients / Policies / Transactions).
 * Precedence: Owner/Admin → CSR → Producer → Viewer.
 * CSR+Producer must use CSR (agency-wide) visibility — Producer must not shrink the book.
 */
export function hasAgencyOperationalVisibility(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  return roles.includes('owner') || roles.includes('admin') || roles.includes('csr')
}

/**
 * True only when lists must be restricted to the user's own producer book.
 * Producer-only (or Producer+Viewer without CSR/Owner/Admin) → scoped.
 * CSR+Producer / Owner+Producer / Admin+Producer → NOT scoped.
 */
export function isProducerBookScoped(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  if (!roles.includes('producer')) return false
  if (hasAgencyOperationalVisibility(roles)) return false
  return true
}

/**
 * Resolve this user's producer identity for producer-specific widgets
 * (My Book / My Commission / own payout summaries) and for Producer-only book locks.
 *
 * Prefer `users.producer_id` → `producers.producer_name` when available.
 * Display-name matching is a fallback only — never the primary security boundary
 * when a linked producer directory row exists.
 *
 * Limitation messages apply ONLY when `isProducerBookScoped` is true
 * (Producer-only). CSR+Producer / Owner+Producer / Admin+Producer never get
 * empty-book warnings from this helper — they keep agency-wide operational reads.
 */
export function resolveProducerBookName(
  role: RoleInput,
  fullName: string | null | undefined,
  knownProducerNames: string[],
  options?: { linkedProducerName?: string | null },
): { lockedName: string | null; limitation: string | null } {
  if (!toAppRoles(role).includes('producer')) {
    return { lockedName: null, limitation: null }
  }

  const bookScoped = isProducerBookScoped(role)
  const linked = (options?.linkedProducerName ?? '').trim()
  const displayName = (fullName ?? '').trim()

  let lockedName: string | null = null
  if (linked) {
    // Prefer exact TEXT spelling from the loaded dataset when present.
    lockedName = knownProducerNames.find((p) => producerKeysMatch(p, linked)) ?? linked
  } else if (displayName) {
    lockedName = knownProducerNames.find((p) => producerKeysMatch(p, displayName)) ?? null
  }

  // Agency-ops multi-role (incl. CSR+Producer): keep optional own-book identity, never warn.
  if (!bookScoped) {
    return { lockedName, limitation: null }
  }

  if (lockedName) {
    return { lockedName, limitation: null }
  }

  if (!linked && !displayName) {
    return {
      lockedName: null,
      limitation:
        'Producer role has no linked producer directory row and no usable full name. Showing empty scoped results.',
    }
  }

  return {
    lockedName: null,
    limitation: linked
      ? `Linked producer “${linked}” could not be applied to producer TEXT fields. Showing empty scoped results.`
      : `Producer login “${displayName}” does not match a linked producer directory row or producer TEXT value. Showing empty scoped results.`,
  }
}

export function roleOf(profile: AppUserProfile | null | undefined): AppRole | null {
  if (!profile) return null
  const roles = profile.roles?.length ? profile.roles : toAppRoles(profile.role)
  return primaryAppRole(roles)
}

export function rolesOf(profile: AppUserProfile | null | undefined): AppRole[] {
  if (!profile) return []
  if (profile.roles?.length) return profile.roles
  return toAppRoles(profile.role)
}

/** Owner | Admin — directory + users + full financials. */
export function isAdminDirectoryRole(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  return roles.includes('owner') || roles.includes('admin')
}

/**
 * Owner | Admin | CSR — operational client/policy/transaction mutators.
 * Does NOT imply producer-payment authority.
 */
export function isOpsMutatorRole(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  return roles.includes('owner') || roles.includes('admin') || roles.includes('csr')
}

/** True if Producer role is present (additive). Does NOT imply book-scoped lists. */
export function isProducerRole(role: RoleInput): boolean {
  return toAppRoles(role).includes('producer')
}

export function isViewerRole(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  return roles.includes('viewer') && !roles.some((r) => r !== 'viewer')
}

export function canViewDashboard(role: RoleInput): boolean {
  return toAppRoles(role).length > 0
}

export function canViewClients(role: RoleInput): boolean {
  return toAppRoles(role).length > 0
}

export function canManageClients(role: RoleInput): boolean {
  return isOpsMutatorRole(role)
}

export function canViewPolicies(role: RoleInput): boolean {
  return toAppRoles(role).length > 0
}

export function canManagePolicies(role: RoleInput): boolean {
  return isOpsMutatorRole(role)
}

export function canViewTransactions(role: RoleInput): boolean {
  return toAppRoles(role).length > 0
}

export function canManageTransactions(role: RoleInput): boolean {
  return isOpsMutatorRole(role)
}

export function canConfirmReceipts(role: RoleInput): boolean {
  return isOpsMutatorRole(role)
}

/** CSR+ may submit a confirmed transaction into the Owner/Admin review queue. */
export function canSubmitTransactionReview(role: RoleInput): boolean {
  return isOpsMutatorRole(role)
}

/** Final Approve / Return for Correction — Owner/Admin only (not CSR). */
export function canApproveTransactions(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

/**
 * Assigned-reviewer gate for Approve / Return / Mark Ready.
 * - Assigned Admin/Owner: normal access
 * - Owner (not assigned): allowed with ownerOverride = true
 * - Unrelated Admin: denied
 */
export function canActOnAssignedReview(params: {
  role: RoleInput
  profileUserId: string | null | undefined
  reviewerUserId: string | null | undefined
}): { allowed: boolean; ownerOverride: boolean } {
  const roles = toAppRoles(params.role)
  if (!roles.includes('owner') && !roles.includes('admin')) {
    return { allowed: false, ownerOverride: false }
  }
  const profileId = (params.profileUserId ?? '').trim()
  const reviewerId = (params.reviewerUserId ?? '').trim()
  // No reviewer assigned yet — Owner/Admin may still approve / mark ready.
  if (!reviewerId) {
    return { allowed: true, ownerOverride: false }
  }
  const assigned = Boolean(profileId && reviewerId && profileId === reviewerId)
  if (assigned) return { allowed: true, ownerOverride: false }
  if (roles.includes('owner')) return { allowed: true, ownerOverride: true }
  return { allowed: false, ownerOverride: false }
}

/** Mark Ready is producer-payment pathway — Owner/Admin only. */
export function canMarkProducerReady(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canManageRecoveries(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canManageProducerPayments(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

/**
 * Financials workspace:
 * - Owner/Admin: full (receipts + payment batches + recoveries mutations)
 * - CSR: access all tabs; receipt confirm allowed; payments & recoveries read-only
 * - Producer/Viewer: none
 * Multi-role: CSR+Producer still gets CSR financial access; no Approve/batch escalation.
 */
export function canAccessFinancials(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  return roles.includes('owner') || roles.includes('admin') || roles.includes('csr')
}

/** Carrier/MGA statement reconciliation — same visibility as Financials. */
export function canAccessReconciliation(role: RoleInput): boolean {
  return canAccessFinancials(role)
}

/** Tolerance, cancel completed statements, delete saved mappings. */
export function canConfigureReconciliation(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canMutateFinancialPayments(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canViewReports(role: RoleInput): boolean {
  return toAppRoles(role).length > 0
}

export function canManageDirectory(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canManageUsers(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

/** Agency Settings — Owner/Admin only (same gate as directory). */
export function canManageAgencySettings(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

/** SaaS Razorpay subscription / billing (Owner/Admin). */
export function canManageBilling(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function canAccessAdminSection(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

export function isReadOnlyRole(role: RoleInput): boolean {
  const roles = toAppRoles(role)
  // Pure producer or pure viewer are read-oriented; CSR+Producer keeps ops mutator rights.
  if (roles.includes('owner') || roles.includes('admin') || roles.includes('csr')) return false
  return roles.includes('viewer') || roles.includes('producer')
}

/** Sidebar / route path allow-list. */
export function canAccessPath(role: RoleInput, pathname: string): boolean {
  const roles = toAppRoles(role)
  if (roles.length === 0) return false

  const path = pathname.split('?')[0] || '/'

  if (path.startsWith('/admin/')) {
    return canAccessAdminSection(roles)
  }
  if (path.startsWith('/financials')) {
    return canAccessFinancials(roles)
  }
  if (path.startsWith('/reconciliation')) {
    return canAccessReconciliation(roles)
  }
  if (path.startsWith('/activity') || path.startsWith('/activity-history')) {
    return roles.includes('owner') || roles.includes('admin') || roles.includes('csr')
  }
  if (path.startsWith('/test-supabase')) {
    return roles.includes('owner') || roles.includes('admin')
  }

  // Core operational screens — all authenticated app roles (with data scoping for producer)
  if (
    path === '/' ||
    path.startsWith('/clients') ||
    path.startsWith('/policy-files') ||
    path.startsWith('/policies') ||
    path.startsWith('/transactions') ||
    path.startsWith('/reports') ||
    path.startsWith('/notifications')
  ) {
    return true
  }

  return false
}

export type NavVisibility = {
  dashboard: boolean
  clients: boolean
  policyFiles: boolean
  transactions: boolean
  financials: boolean
  reconciliation: boolean
  reports: boolean
  activityHistory: boolean
  administration: boolean
  producers: boolean
  csrs: boolean
  mgas: boolean
  carriers: boolean
  users: boolean
  agencySettings: boolean
  subscriptionBilling: boolean
}

export function getNavVisibility(role: RoleInput): NavVisibility {
  const roles = toAppRoles(role)
  const admin = isAdminDirectoryRole(roles)
  const ops = isOpsMutatorRole(roles) || roles.includes('viewer') || roles.includes('producer')
  return {
    dashboard: roles.length > 0,
    clients: ops,
    policyFiles: ops,
    transactions: ops,
    financials: canAccessFinancials(roles),
    reconciliation: canAccessReconciliation(roles),
    reports: roles.length > 0,
    activityHistory: roles.includes('owner') || roles.includes('admin') || roles.includes('csr'),
    administration: admin,
    producers: admin,
    csrs: admin,
    mgas: admin,
    carriers: admin,
    users: admin,
    agencySettings: admin,
    subscriptionBilling: admin,
  }
}

/**
 * Admin may not modify Owner accounts.
 * Owner may not demote/remove the last remaining Owner.
 */
export function canChangeUserRole(params: {
  actorRole: string | null | undefined
  targetRole: string | null | undefined
  nextRole: string | null | undefined
  ownerCount: number
  targetIsSelf: boolean
}): { allowed: boolean; reason: string | null } {
  const actor = normalizeAppRole(params.actorRole)
  const target = normalizeAppRole(params.targetRole)
  const next = normalizeAppRole(params.nextRole)

  if (!actor || !canManageUsers(actor)) {
    return { allowed: false, reason: 'You do not have permission to manage users.' }
  }
  if (!next) {
    return { allowed: false, reason: 'Select a valid application role.' }
  }
  if (actor === 'admin' && (target === 'owner' || next === 'owner')) {
    return { allowed: false, reason: 'Admins cannot modify Owner accounts or assign the Owner role.' }
  }
  if (target === 'owner' && next !== 'owner' && params.ownerCount <= 1) {
    return { allowed: false, reason: 'Cannot demote or remove the last Owner account.' }
  }
  if (params.targetIsSelf && actor === 'owner' && next !== 'owner' && params.ownerCount <= 1) {
    return { allowed: false, reason: 'Cannot demote your own Owner role when you are the last Owner.' }
  }
  return { allowed: true, reason: null }
}

export function canChangeUserStatus(params: {
  actorRole: string | null | undefined
  targetRole: string | null | undefined
  targetIsSelf: boolean
  ownerCount: number
  nextStatus: string
}): { allowed: boolean; reason: string | null } {
  const actor = normalizeAppRole(params.actorRole)
  const target = normalizeAppRole(params.targetRole)
  if (!actor || !canManageUsers(actor)) {
    return { allowed: false, reason: 'You do not have permission to manage users.' }
  }
  if (actor === 'admin' && target === 'owner') {
    return { allowed: false, reason: 'Admins cannot modify Owner accounts.' }
  }
  if (
    target === 'owner' &&
    params.nextStatus !== 'active' &&
    params.ownerCount <= 1
  ) {
    return { allowed: false, reason: 'Cannot deactivate the last Owner account.' }
  }
  if (params.targetIsSelf && params.nextStatus !== 'active') {
    return { allowed: false, reason: 'You cannot deactivate your own account from this screen.' }
  }
  return { allowed: true, reason: null }
}

/** Load the authenticated app user's roles from public.users + user_roles. */
export async function loadCurrentAppRole(): Promise<{
  role: AppRole | null
  roles: AppRole[]
  profileId: string | null
  error: string | null
}> {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return {
      role: null,
      roles: [],
      profileId: null,
      error: authError?.message ?? 'Not authenticated.',
    }
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, role, status, archived_at')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()
  if (error) {
    return { role: null, roles: [], profileId: null, error: error.message }
  }
  if (!data || data.archived_at || String(data.status ?? '').toLowerCase() !== 'active') {
    return { role: null, roles: [], profileId: null, error: 'No active ALZA user profile.' }
  }

  const profileId = data.id as string
  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', profileId)

  const roles = toAppRoles([
    ...(roleRows ?? []).map((r) => String(r.role ?? '')),
    String(data.role ?? ''),
  ])
  const role = primaryAppRole(roles) ?? normalizeAppRole(data.role as string | null)

  return {
    role,
    roles,
    profileId,
    error: null,
  }
}

/** Reject write helpers when the current role fails a permission predicate. */
export async function rejectUnlessRole(
  allowed: (role: AppRole) => boolean,
  message = 'You do not have permission to perform this action.',
): Promise<
  { ok: true; role: AppRole; roles: AppRole[]; profileId: string | null } | { ok: false; message: string }
> {
  const current = await loadCurrentAppRole()
  // Pass additive roles into predicates that accept RoleInput via casting primary —
  // predicates use toAppRoles, so check against any matching role.
  const allowedByAny = current.roles.some((r) => allowed(r)) || (current.role ? allowed(current.role) : false)
  if (current.error || !current.role || !allowedByAny) {
    return { ok: false, message: current.error ?? message }
  }
  return {
    ok: true,
    role: current.role,
    roles: current.roles,
    profileId: current.profileId,
  }
}
