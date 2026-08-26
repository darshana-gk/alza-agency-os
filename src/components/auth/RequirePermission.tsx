import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { canAccessPath, rolesOf } from '../../lib/permissions'
import { agencyAllowsOpsAccess, PROSPECT_HOME_PATH } from '../../lib/agencyLifecycle'

/**
 * In-layout access denied for unauthorized routes.
 * Does not expose restricted record details.
 */
export function RouteAccessDenied({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">
        {message ?? 'You do not have permission to access this area.'}
      </p>
    </div>
  )
}

/** Protect a route subtree / page by path allow-list for the current role + agency lifecycle. */
export function RequirePathAccess({
  path,
  children,
}: {
  path: string
  children: React.ReactNode
}) {
  const { profile } = useAuth()
  if (!canAccessPath(rolesOf(profile), path, profile?.agencyLifecycle)) {
    return (
      <RouteAccessDenied
        message={
          profile && !agencyAllowsOpsAccess(profile.agencyLifecycle)
            ? 'This workspace is not activated for operational ALZA Flow yet. Complete subscription & billing, or contact ALZA.'
            : undefined
        }
      />
    )
  }
  return <>{children}</>
}

/** Boolean gate for page-level permission checks. */
export function RequirePermission({
  allow,
  children,
  fallback,
}: {
  allow: boolean
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  if (!allow) {
    return <>{fallback ?? <RouteAccessDenied />}</>
  }
  return <>{children}</>
}

export function RedirectHome() {
  const { profile } = useAuth()
  if (profile && !agencyAllowsOpsAccess(profile.agencyLifecycle)) {
    return <Navigate to={PROSPECT_HOME_PATH} replace />
  }
  return <Navigate to="/" replace />
}
