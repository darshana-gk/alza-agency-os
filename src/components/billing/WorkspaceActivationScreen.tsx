import { LifeBuoy, LogOut, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { customerFacingRestriction, type RestrictedReason } from '@/lib/subscriptionAccess'

export function WorkspaceActivationScreen({
  agencyName,
  reason,
  checking,
  onCheck,
}: {
  agencyName: string | null
  reason: RestrictedReason
  checking: boolean
  onCheck: () => Promise<void>
}) {
  const { signOut } = useAuth()
  const copy = customerFacingRestriction(reason)

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-alza-teal-800">ALZA Flow</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">{copy.heading}</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{copy.body}</p>

      <dl className="mt-6 space-y-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-slate-500">Workspace</dt>
          <dd className="text-right font-medium text-slate-900">{agencyName || 'Your agency'}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-slate-500">Subscription</dt>
          <dd className="text-right font-medium text-slate-900">{copy.stateLabel}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={checking}
          onClick={() => void onCheck()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg gradient-alza text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking…' : 'Check activation status'}
        </button>
        <Link
          to="/admin/subscription-billing"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Subscription & Billing
        </Link>
        <Link
          to="/support"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          <LifeBuoy className="h-4 w-4" />
          Help & Support
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}
