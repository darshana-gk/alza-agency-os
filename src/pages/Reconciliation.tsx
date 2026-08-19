import { useCallback, useEffect, useMemo, useState } from 'react'
import { Scale, Upload } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { canConfigureReconciliation, roleInputFromProfile } from '../lib/permissions'
import {
  fetchExceptionRows,
  fetchReconciliationRows,
  fetchReconciliationStatement,
  fetchReconciliationStatements,
  formatReconciliationStatus,
  reconciliationStatusClass,
  type ReconciliationStatement,
  type ReconciliationStatementRow,
} from '../lib/reconciliation'
import { ExceptionQueue } from '../components/reconciliation/ExceptionQueue'
import { ImportWizard } from '../components/reconciliation/ImportWizard'
import { ReconciliationSummaryCards } from '../components/reconciliation/ReconciliationSummaryCards'
import { StatementDetail } from '../components/reconciliation/StatementDetail'

type Tab = 'statements' | 'exceptions'

export function Reconciliation() {
  const { profile } = useAuth()
  const canConfigure = canConfigureReconciliation(roleInputFromProfile(profile))
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('statements')
  const [statements, setStatements] = useState<ReconciliationStatement[]>([])
  const [exceptions, setExceptions] = useState<
    Awaited<ReturnType<typeof fetchExceptionRows>>['data']
  >([])
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('statement'))
  const [selected, setSelected] = useState<ReconciliationStatement | null>(null)
  const [rows, setRows] = useState<ReconciliationStatementRow[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [stmt, ex] = await Promise.all([fetchReconciliationStatements(), fetchExceptionRows()])
    if (stmt.error) setError(stmt.error)
    setStatements(stmt.data)
    setExceptions(ex.data)
    setLoading(false)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const [stmt, detailRows] = await Promise.all([
      fetchReconciliationStatement(id),
      fetchReconciliationRows(id),
    ])
    if (stmt.error) setError(stmt.error)
    setSelected(stmt.data)
    setRows(detailRows.data)
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    const fromUrl = searchParams.get('statement')
    if (fromUrl && fromUrl !== selectedId) setSelectedId(fromUrl)
  }, [searchParams, selectedId])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
    else {
      setSelected(null)
      setRows([])
    }
  }, [selectedId, loadDetail])

  function openStatement(id: string | null) {
    setSelectedId(id)
    setTab('statements')
    if (id) setSearchParams({ statement: id }, { replace: true })
    else setSearchParams({}, { replace: true })
  }

  const totals = useMemo(
    () => ({
      statements: statements.filter((s) => s.status !== 'cancelled').length,
      exceptions: exceptions.length,
      unmatched: statements.reduce((sum, s) => sum + s.unmatchedCount, 0),
      missing: statements.reduce((sum, s) => sum + s.missingCount, 0),
    }),
    [statements, exceptions],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <Scale className="h-6 w-6 text-alza-blue-700" />
            Reconciliation
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Import carrier/MGA statements, match them to transactions, and confirm agency commission receipts.
            Producer splits, broker fees, recoveries, and payouts are unchanged.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800"
        >
          <Upload className="h-4 w-4" />
          Import statement
        </button>
      </div>

      {!selectedId && <ReconciliationSummaryCards totals={totals} />}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        {([
          ['statements', 'Statements'],
          ['exceptions', 'Exceptions'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id)
              if (id === 'exceptions') setSelectedId(null)
            }}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id
                ? 'border-alza-blue-700 text-alza-blue-800'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
            {id === 'exceptions' ? ` (${exceptions.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'exceptions' && (
        <ExceptionQueue
          rows={exceptions}
          onOpenStatement={(id) => openStatement(id)}
          onRefresh={loadList}
        />
      )}

      {tab === 'statements' && selectedId && selected && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              openStatement(null)
              void loadList()
            }}
            className="text-sm font-medium text-alza-blue-700 hover:underline"
          >
            ← Back to statements
          </button>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{selected.fileName}</h2>
            <p className="text-sm text-slate-500">
              {selected.carrier || selected.mga || '—'} · {selected.periodStart} to {selected.periodEnd}
            </p>
          </div>
          <StatementDetail
            statement={selected}
            rows={rows}
            canConfigure={canConfigure}
            onRefresh={async () => {
              await loadDetail(selectedId)
              await loadList()
            }}
          />
        </div>
      )}

      {tab === 'statements' && !selectedId && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Carrier / MGA</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Rows</th>
                <th className="px-4 py-3">Matched</th>
                <th className="px-4 py-3">Exceptions</th>
                <th className="px-4 py-3">Missing</th>
                <th className="px-4 py-3">Imported</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Loading statements…
                  </td>
                </tr>
              )}
              {!loading && statements.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No statements imported yet.
                  </td>
                </tr>
              )}
              {statements.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => openStatement(row.id)}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{row.fileName}</td>
                  <td className="px-4 py-3">{row.carrier || row.mga || '—'}</td>
                  <td className="px-4 py-3">
                    {row.periodStart} → {row.periodEnd}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationStatusClass(row.status)}`}>
                      {formatReconciliationStatus(row.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.rowCount}</td>
                  <td className="px-4 py-3">{row.matchedCount}</td>
                  <td className="px-4 py-3">{row.exceptionCount}</td>
                  <td className="px-4 py-3">{row.missingCount}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportWizard
        open={importOpen}
        canDeleteMappings={canConfigure}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          setImportOpen(false)
          openStatement(id)
          void loadList()
        }}
      />
    </div>
  )
}
