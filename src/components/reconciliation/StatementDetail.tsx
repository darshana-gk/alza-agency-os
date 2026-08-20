import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatTypeLabel } from '../../lib/commission'
import {
  confirmReconciliationReceipts,
  formatReconciliationMatchLabel,
  formatReconciliationStatus,
  formatSignedCurrency,
  isPreviouslyConfirmedSkip,
  manualMatchRow,
  openExceptions,
  reconciliationMatchLabelClass,
  reconciliationStatusClass,
  resolveStatementRow,
  runReconciliationMatching,
  unmatchRow,
  updateStatementStatus,
  updateStatementTolerance,
  type ReconciliationStatement,
  type ReconciliationStatementRow,
} from '../../lib/reconciliation'
import { varianceRequiresReview } from '../../lib/reconciliationMatching'
import { MatchSearchDialog } from './MatchSearchDialog'
import { MissingTransactionRow } from './MissingTransactionRow'
import { ReconciliationSummaryCards } from './ReconciliationSummaryCards'

const inputClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export function StatementDetail(props: {
  statement: ReconciliationStatement
  rows: ReconciliationStatementRow[]
  canConfigure: boolean
  canConfirmReceipts: boolean
  onRefresh: () => Promise<void>
}) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [matchRow, setMatchRow] = useState<ReconciliationStatementRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [occupancy, setOccupancy] = useState<{ statementId: string; label: string; confirmed: boolean } | null>(
    null,
  )
  const [tolerance, setTolerance] = useState(String(props.statement.roundingTolerance))
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    return props.rows.filter((row) => {
      if (statusFilter !== 'all' && row.matchStatus !== statusFilter) return false
      if (sourceFilter !== 'all' && row.rowSource !== sourceFilter) return false
      return true
    })
  }, [props.rows, statusFilter, sourceFilter])

  const open = openExceptions(props.rows)
  const confirmable = props.rows.filter(
    (r) =>
      ['auto_matched', 'manual_matched'].includes(r.matchStatus) &&
      !r.receiptId &&
      (r.matchStatus === 'manual_matched' || !varianceRequiresReview(r.discrepancyType)),
  )

  async function run(label: string, fn: () => Promise<{ error: string | null } | { error: string | null; occupancy?: { statementId: string; statementFileName: string; receiptConfirmed: boolean } }>) {
    setBusy(label)
    setMessage(null)
    setOccupancy(null)
    const result = await fn()
    if (result.error) setMessage(result.error)
    if ('occupancy' in result && result.occupancy?.statementId) {
      setOccupancy({
        statementId: result.occupancy.statementId,
        label: result.occupancy.statementFileName || 'statement',
        confirmed: result.occupancy.receiptConfirmed,
      })
    }
    await props.onRefresh()
    setBusy(null)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <ReconciliationSummaryCards statement={props.statement} rows={props.rows} />

      {message && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{message}</p>
          {occupancy && occupancy.statementId && (
            <button
              type="button"
              className="mt-2 text-sm font-medium text-alza-blue-800 underline"
              onClick={() => navigate(`/reconciliation?statement=${occupancy.statementId}`)}
            >
              {occupancy.confirmed
                ? `This commission already has a confirmed receipt on ${occupancy.label}. Open that statement.`
                : `This commission is already matched on ${occupancy.label} and is awaiting receipt confirmation.`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {['pending', 'auto_matched', 'manual_matched', 'exception', 'unmatched', 'confirmed', 'skipped'].map((s) => (
            <option key={s} value={s}>
              {formatReconciliationStatus(s)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          <option value="import">Imported</option>
          <option value="missing">Missing from statement</option>
        </select>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void run('match', () => runReconciliationMatching(props.statement.id, { rerun: true }))}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Re-run matching
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || props.statement.detectMissing}
          title="Use this only when the file is the full commission statement for this carrier or MGA and period. ALZA Flow will list unpaid transactions that did not appear on the statement."
          onClick={() => {
            const ok = window.confirm(
              'Use this only if this file is the complete commission statement for this carrier or MGA and period. ALZA Flow will then list unpaid transactions that are not on the file. Continue?',
            )
            if (!ok) return
            void run('detect-missing', () =>
              runReconciliationMatching(props.statement.id, { rerun: true, detectMissing: true }),
            )
          }}
          className="h-10 rounded-lg border border-amber-200 px-3 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-40"
        >
          {props.statement.detectMissing ? 'Missing detection on' : 'Detect missing for full period'}
        </button>
        {props.canConfirmReceipts && (
          <button
            type="button"
            disabled={Boolean(busy) || confirmable.length === 0}
            onClick={() =>
              void run('confirm', async () => {
                const result = await confirmReconciliationReceipts(props.statement.id)
                return { error: result.error }
              })
            }
            className="h-10 rounded-lg bg-alza-blue-700 px-3 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
          >
            Confirm all matched
          </button>
        )}
        {props.canConfirmReceipts && (
          <button
            type="button"
            disabled={Boolean(busy) || selected.size === 0}
            onClick={() =>
              void run('confirm-selected', async () => {
                const result = await confirmReconciliationReceipts(props.statement.id, [...selected])
                return { error: result.error }
              })
            }
            className="h-10 rounded-lg border border-alza-blue-200 px-3 text-sm font-medium text-alza-blue-800 hover:bg-alza-blue-50 disabled:opacity-40"
          >
            Confirm selected
          </button>
        )}
        <button
          type="button"
          disabled={Boolean(busy) || open.length > 0}
          onClick={() => void run('reviewed', () => updateStatementStatus(props.statement.id, 'reviewed'))}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Mark reviewed
        </button>
        {props.canConfigure && (
          <button
            type="button"
            disabled={Boolean(busy) || props.statement.status === 'cancelled'}
            onClick={() => void run('complete', () => updateStatementStatus(props.statement.id, 'completed'))}
            className="h-10 rounded-lg border border-emerald-200 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
          >
            Complete
          </button>
        )}
        <button
          type="button"
          disabled={
            Boolean(busy) ||
            (props.statement.status === 'completed' && !props.canConfigure)
          }
          onClick={() => void run('cancel', () => updateStatementStatus(props.statement.id, 'cancelled'))}
          className="h-10 rounded-lg border border-rose-200 px-3 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
        >
          Cancel statement
        </button>
        {props.canConfigure && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            Tolerance
            <input
              className={`${inputClass} w-24`}
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              onBlur={() => {
                const n = Number(tolerance)
                if (!Number.isFinite(n) || n === props.statement.roundingTolerance) return
                void run('tolerance', () => updateStatementTolerance(props.statement.id, n))
              }}
            />
          </label>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
            {props.canConfirmReceipts && <th className="px-3 py-2" />}
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Policy</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Expected</th>
              <th className="px-3 py-2">Actual</th>
              <th className="px-3 py-2">Variance</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Discrepancy</th>
              <th className="px-3 py-2">Transaction</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const cells = (
                <>
                  {props.canConfirmReceipts && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={!['auto_matched', 'manual_matched'].includes(row.matchStatus)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">{row.rowSource === 'missing' ? 'Missing' : 'Import'}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{row.policyNumber || '—'}</td>
                  <td className="px-3 py-2">{row.transactionType ? formatTypeLabel(row.transactionType) : '—'}</td>
                  <td className="px-3 py-2">{formatSignedCurrency(row.expectedCommission)}</td>
                  <td className="px-3 py-2">{formatSignedCurrency(row.commissionAmount)}</td>
                  <td className="px-3 py-2">{formatSignedCurrency(row.variance)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationMatchLabelClass(row)}`}>
                      {formatReconciliationMatchLabel(row)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationStatusClass(row.discrepancyType)}`}>
                      {formatReconciliationStatus(row.discrepancyType)}
                    </span>
                    {row.matchStatus === 'skipped' &&
                      isPreviouslyConfirmedSkip(row.resolutionNotes) &&
                      row.discrepancyType &&
                      ['underpaid', 'overpaid'].includes(row.discrepancyType) && (
                        <p className="mt-1 max-w-xs text-xs text-amber-800">
                          Amount on this statement differs from the confirmed receipt.
                        </p>
                      )}
                  </td>
                  <td className="px-3 py-2">
                    {row.matchedTransactionId ? (
                      <Link className="text-alza-blue-700 hover:underline" to={`/transactions/${row.matchedTransactionId}`}>
                        {row.transactionNumber || 'Open'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.matchStatus !== 'confirmed' && (
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-alza-blue-800 hover:bg-alza-blue-50"
                          onClick={() => setMatchRow(row)}
                        >
                          Match
                        </button>
                      )}
                      {row.matchedTransactionId && row.matchStatus !== 'confirmed' && (
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          onClick={() => void run(`unmatch-${row.id}`, () => unmatchRow(row.id))}
                        >
                          Unmatch
                        </button>
                      )}
                      {row.matchStatus !== 'confirmed' && (
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          onClick={() =>
                            void run(`skip-${row.id}`, () =>
                              resolveStatementRow({ rowId: row.id, resolutionStatus: 'ignored', skip: true }),
                            )
                          }
                        >
                          Skip
                        </button>
                      )}
                      {(row.matchStatus === 'exception' || row.matchStatus === 'unmatched') && (
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          onClick={() => {
                            const notes = window.prompt('Resolution notes', row.resolutionNotes ?? '') ?? ''
                            return run(`resolve-${row.id}`, () =>
                              resolveStatementRow({
                                rowId: row.id,
                                resolutionStatus: 'resolved',
                                notes,
                              }),
                            )
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                    {row.resolutionNotes && (
                      <p className="mt-1 max-w-xs text-xs text-slate-500">{row.resolutionNotes}</p>
                    )}
                  </td>
                </>
              )
              return row.rowSource === 'missing' ? (
                <MissingTransactionRow key={row.id}>{cells}</MissingTransactionRow>
              ) : (
                <tr key={row.id} className="border-t border-slate-100">
                  {cells}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <MatchSearchDialog
        open={Boolean(matchRow)}
        initialQuery={matchRow?.policyNumber ?? ''}
        onClose={() => setMatchRow(null)}
        onSelect={(txn) => {
          if (!matchRow) return
          const row = matchRow
          setMatchRow(null)
          void run(`manual-${row.id}`, () =>
            manualMatchRow({
              rowId: row.id,
              transactionId: txn.id,
              expectedCommission: txn.expectedCommission,
              commissionAmount: row.commissionAmount,
              roundingTolerance: props.statement.roundingTolerance,
            }),
          )
        }}
      />
    </div>
  )
}
