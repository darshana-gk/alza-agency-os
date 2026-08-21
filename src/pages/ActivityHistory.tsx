import { useCallback, useEffect, useMemo, useState } from 'react'
import { History, Search } from 'lucide-react'
import { ExportMenu } from '../components/ui/ExportMenu'
import { fetchActivityHistory, type ActivityHistoryRow } from '../lib/activity'
import {
  formatActivityActionLabel,
  formatActivityDetailsSummary,
  formatActivityEntityLabel,
} from '../lib/activityPresentation'
import { activityExportColumns, activityRowForExport } from '../lib/exportDefinitions'
import { downloadTableExport } from '../lib/tableExport'
import { supabase } from '../lib/supabase'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function formatWhen(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function ActivityHistoryPage() {
  const [rows, setRows] = useState<ActivityHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    actorUserId: '',
    action: '',
    entityType: '',
    clientId: '',
    policyId: '',
    transactionId: '',
  })

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, full_name')
        .is('archived_at', null)
        .order('full_name')
      setUsers(
        (data ?? []).map((u) => ({
          id: String(u.id),
          name: String(u.full_name ?? u.id),
        })),
      )
    })()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchActivityHistory({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      actorUserId: filters.actorUserId || undefined,
      action: filters.action || undefined,
      entityType: filters.entityType || undefined,
      clientId: filters.clientId || undefined,
      policyId: filters.policyId || undefined,
      transactionId: filters.transactionId || undefined,
      limit: 300,
    })
    if (result.error) setError(result.error)
    setRows(result.data)
    setLoading(false)
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  const actionOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.action).filter(Boolean))
    return [...set].sort()
  }, [rows])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <History className="h-6 w-6 text-alza-blue-700" />
          Activity History
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Append-only audit trail. Records are not editable or deletable from the UI.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Date from</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Date to</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">User</span>
          <select
            value={filters.actorUserId}
            onChange={(e) => setFilters((f) => ({ ...f, actorUserId: e.target.value }))}
            className={selectClassName}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Action</span>
          <input
            list="activity-actions"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            placeholder="e.g. transaction_void"
            className={inputClassName}
          />
          <datalist id="activity-actions">
            {actionOptions.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Entity type</span>
          <select
            value={filters.entityType}
            onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
            className={selectClassName}
          >
            <option value="">All</option>
            {[
              'client',
              'policy',
              'transaction',
              'recovery',
              'payment_batch',
              'document',
              'user',
              'agency',
              'producer',
              'reconciliation',
            ].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Client ID</span>
          <input
            value={filters.clientId}
            onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value }))}
            className={inputClassName}
            placeholder="UUID"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Policy ID</span>
          <input
            value={filters.policyId}
            onChange={(e) => setFilters((f) => ({ ...f, policyId: e.target.value }))}
            className={inputClassName}
            placeholder="UUID"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Transaction ID</span>
          <input
            value={filters.transactionId}
            onChange={(e) => setFilters((f) => ({ ...f, transactionId: e.target.value }))}
            className={inputClassName}
            placeholder="UUID"
          />
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <ExportMenu
            rowCount={rows.length}
            disabled={loading}
            hint="Exports up to 300 matching activity records."
            onExport={(format) =>
              downloadTableExport({
                format,
                sheetName: 'Activity',
                columns: activityExportColumns,
                rows: rows.map(activityRowForExport),
                filenameBase: 'Activity',
                label: 'activity records',
              })
            }
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm text-slate-500">
          <Search className="h-4 w-4" />
          {loading ? 'Loading…' : `${rows.length} event${rows.length === 1 ? '' : 's'}`}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Date/Time</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Details / Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {formatWhen(row.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{row.actorName || '—'}</div>
                    <div className="text-xs capitalize text-slate-500">{row.actorRole || '—'}</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {formatActivityActionLabel(row.action)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatActivityEntityLabel(row.entityType)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.recordReference || '—'}</td>
                  <td className="max-w-md px-4 py-3 text-slate-700">
                    {formatActivityDetailsSummary(row)}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No activity matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
