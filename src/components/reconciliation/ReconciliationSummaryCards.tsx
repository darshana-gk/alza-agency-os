import type { ReconciliationStatement } from '../../lib/reconciliation'
import { formatReconciliationStatus, reconciliationStatusClass } from '../../lib/reconciliation'

export function ReconciliationSummaryCards(props: {
  statement?: ReconciliationStatement | null
  totals?: {
    statements: number
    exceptions: number
    unmatched: number
    missing: number
  }
}) {
  const s = props.statement
  const items = s
    ? [
        { label: 'Imported rows', value: s.rowCount },
        { label: 'Matched', value: s.matchedCount },
        { label: 'Needs Review', value: s.exceptionCount },
        { label: 'Unmatched', value: s.unmatchedCount },
        { label: 'Missing', value: s.missingCount },
        { label: 'Confirmed', value: s.confirmedCount },
        { label: 'Skipped', value: s.skippedCount },
      ]
    : [
        { label: 'Statements', value: props.totals?.statements ?? 0 },
        { label: 'Needs Review', value: props.totals?.exceptions ?? 0 },
        { label: 'Unmatched', value: props.totals?.unmatched ?? 0 },
        { label: 'Missing from statement', value: props.totals?.missing ?? 0 },
      ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {s && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</p>
          <span
            className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationStatusClass(s.status)}`}
          >
            {formatReconciliationStatus(s.status)}
          </span>
        </div>
      )}
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
        </div>
      ))}
    </div>
  )
}
