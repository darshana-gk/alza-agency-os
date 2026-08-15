import { useEffect } from 'react'
import { useAuth } from '../lib/auth'

export function AccessDeniedPage() {
  const { accessDeniedReason, authUser, signOut } = useAuth()

  useEffect(() => {
    document.title = 'Access Denied | ALZA Flow'
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Access denied</h1>
        <p className="mt-2 text-sm text-slate-600">
          {accessDeniedReason ??
            'Your account is authenticated with Supabase, but it is not authorized for ALZA Flow.'}
        </p>
        {authUser?.email && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Signed in as <span className="font-medium">{authUser.email}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
