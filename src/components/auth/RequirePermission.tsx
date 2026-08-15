import { Navigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { canAccessPath } from '../../lib/permissions'

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

/** Protect a route subtree / page by path allow-list for the current role. */
export function RequirePathAccess({
  path,
  children,
}: {
  path: string
  children: React.ReactNode
}) {
  const { profile } = useAuth()
  if (!canAccessPath(profile?.role, path)) {
    return <RouteAccessDenied />
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
  return <Navigate to="/" replace />
}
