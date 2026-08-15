import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { fetchActivityHistory, type ActivityHistoryRow } from '../../lib/activity'
import {
  activityDrawerDetailLines,
  activityDrawerHeadline,
} from '../../lib/activityPresentation'

function formatWhen(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function EntityActivityHistory(props: {
  transactionId?: string
  policyId?: string
  clientId?: string
  limit?: number
  title?: string
}) {
  const { transactionId, policyId, clientId, limit = 25, title = 'Activity History' } = props
  const [rows, setRows] = useState<ActivityHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const result = await fetchActivityHistory({
        transactionId,
        policyId,
        clientId,
        limit,
      })
      if (cancelled) return
      if (result.error) setError(result.error)
      setRows(result.data)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [transactionId, policyId, clientId, limit])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-slate-500" />
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-slate-500">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No activity recorded yet.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {rows.map((row) => {
            const lines = activityDrawerDetailLines(row)
            return (
              <li key={row.id} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
                <p className="text-xs text-slate-500">{formatWhen(row.createdAt)}</p>
                <p className="mt-0.5 font-medium text-slate-900">{activityDrawerHeadline(row)}</p>
                {lines.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
