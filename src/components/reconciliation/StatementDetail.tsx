import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { formatTypeLabel } from '../../lib/commission'
import {
  computeStatementPresentationSummary,
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
  statementSourceLabel,
  unmatchRow,
  updateStatementStatus,
  updateStatementTolerance,
  type ReconciliationStatement,
  type ReconciliationStatementRow,
} from '../../lib/reconciliation'
import { varianceRequiresReview } from '../../lib/reconciliationMatching'
import { MatchSearchDialog } from './MatchSearchDialog'
import { MissingTransactionRow } from './MissingTransactionRow'

const inputClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

type RowView = 'review' | 'all'

export function StatementDetail(props: {
  statement: ReconciliationStatement
  rows: ReconciliationStatementRow[]
  canConfigure: boolean
  canConfirmReceipts: boolean
  onRefresh: () => Promise<void>
}) {
  const open = openExceptions(props.rows)
  const presentation = useMemo(
    () => computeStatementPresentationSummary(props.rows),
    [props.rows],
  )
  const defaultView: RowView = open.length > 0 ? 'review' : 'all'
  const [rowView, setRowView] = useState<RowView>(defaultView)
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
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    setRowView(open.length > 0 ? 'review' : 'all')
  }, [props.statement.id, open.length])

  const filtered = useMemo(() => {
    const base =
      rowView === 'review'
        ? open
        : props.rows.filter((row) => {
            if (statusFilter !== 'all' && row.matchStatus !== statusFilter) return false
            if (sourceFilter !== 'all' && row.rowSource !== sourceFilter) return false
            return true
          })
    return base
  }, [props.rows, rowView, open, statusFilter, sourceFilter])

  const confirmable = props.rows.filter(
    (r) =>
      ['auto_matched', 'manual_matched'].includes(r.matchStatus) &&
      !r.receiptId &&
      (r.matchStatus === 'manual_matched' || !varianceRequiresReview(r.discrepancyType)),
  )

  const sourceTitle = statementSourceLabel(props.statement)
  const periodLabel = `${props.statement.periodStart} → ${props.statement.periodEnd}`
  const commissionsChecked = presentation.imported

  async function run(
    label: string,
    fn: () => Promise<
      | { error: string | null }
      | {
          error: string | null
          occupancy?: { statementId: string; statementFileName: string; receiptConfirmed: boolean }
        }
    >,
  ) {
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

  const primary = (() => {
    if (open.length > 0) {
      return {
        key: 'review',
        label: `Review ${open.length} Item${open.length === 1 ? '' : 's'}`,
        onClick: () => setRowView('review'),
        disabled: false,
      }
    }
    if (props.statement.status === 'matched') {
      return {
        key: 'submit',
        label: 'Submit for Approval',
        onClick: () => void run('reviewed', () => updateStatementStatus(props.statement.id, 'reviewed')),
        disabled: Boolean(busy),
      }
    }
    if (props.statement.status === 'reviewed') {
      if (props.canConfirmReceipts && confirmable.length > 0) {
        return {
          key: 'approve',
          label: 'Approve & Record Receipts',
          onClick: () =>
            void run('confirm', async () => {
              const result = await confirmReconciliationReceipts(props.statement.id)
              return { error: result.error }
            }),
          disabled: Boolean(busy),
        }
      }
      if (props.canConfirmReceipts && props.canConfigure) {
        return {
          key: 'complete',
          label: 'Complete',
          onClick: () => void run('complete', () => updateStatementStatus(props.statement.id, 'completed')),
          disabled: Boolean(busy),
        }
      }
      return null
    }
    if (props.canConfigure && props.statement.status !== 'completed' && props.statement.status !== 'cancelled') {
      if (presentation.confirmed > 0 || confirmable.length === 0) {
        return {
          key: 'complete',
          label: 'Complete',
          onClick: () => void run('complete', () => updateStatementStatus(props.statement.id, 'completed')),
          disabled: Boolean(busy),
        }
      }
    }
    return null
  })()

  const guidance =
    open.length > 0
      ? 'ALZA matched what it could automatically. Review the items below that need your attention.'
      : props.statement.status === 'reviewed'
        ? props.canConfirmReceipts
          ? 'This reconciliation is ready for approval. Approving will record the matched commission receipts.'
          : 'All commission entries are resolved. Waiting for Owner/Admin approval.'
        : props.statement.status === 'matched'
          ? 'All commission entries are resolved and ready to submit for approval.'
          : props.statement.status === 'completed'
            ? 'This statement is complete.'
            : 'ALZA Flow compared this statement with your recorded transactions.'

  function showRowActions(row: ReconciliationStatementRow): boolean {
    if (row.matchStatus === 'confirmed') return false
    return (
      row.matchStatus === 'exception' ||
      row.matchStatus === 'unmatched' ||
      Boolean(row.matchedTransactionId) ||
      rowView === 'review'
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {sourceTitle} — {periodLabel}
            </h3>
            <p className="mt-1 text-sm text-slate-600">{commissionsChecked} commissions checked</p>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">{guidance}</p>
          </div>
          {props.statement.status === 'reviewed' && !props.canConfirmReceipts && (
            <span className="rounded-full bg-alza-blue-50 px-3 py-1 text-xs font-medium text-alza-blue-800 ring-1 ring-inset ring-alza-blue-600/20">
              Waiting for Owner/Admin approval
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <SummaryPill label="Matched" value={presentation.matched} tone="ok" />
          <SummaryPill label="Already Processed" value={presentation.alreadyProcessed} tone="muted" />
          <SummaryPill label="Needs Review" value={presentation.needsReview} tone="warn" />
          {presentation.missing > 0 && <SummaryPill label="Missing" value={presentation.missing} tone="warn" />}
          {presentation.underpaid > 0 && (
            <SummaryPill label="Underpaid" value={presentation.underpaid} tone="warn" />
          )}
          {presentation.overpaid > 0 && (
            <SummaryPill label="Overpaid" value={presentation.overpaid} tone="warn" />
          )}
          {presentation.confirmed > 0 && (
            <SummaryPill label="Confirmed" value={presentation.confirmed} tone="ok" />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {primary && (
            <button
              type="button"
              disabled={primary.disabled}
              onClick={primary.onClick}
              className="h-10 rounded-lg bg-alza-blue-700 px-4 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
            >
              {busy === 'confirm' || busy === 'reviewed' || busy === 'complete' ? 'Working…' : primary.label}
            </button>
          )}
          {rowView === 'review' ? (
            <button
              type="button"
              onClick={() => setRowView('all')}
              className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View all rows
            </button>
          ) : open.length > 0 ? (
            <button
              type="button"
              onClick={() => setRowView('review')}
              className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Show items needing review
            </button>
          ) : null}

          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              More actions
              <ChevronDown className="h-4 w-4" />
            </button>
            {moreOpen && (
              <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  onClick={() => {
                    setMoreOpen(false)
                    void run('match', () => runReconciliationMatching(props.statement.id, { rerun: true }))
                  }}
                >
                  Re-run matching
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || props.statement.detectMissing}
                  className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  onClick={() => {
                    const ok = window.confirm(
                      'Use this only if this file is the complete commission statement for this carrier or MGA and period. ALZA Flow will then list unpaid transactions that are not on the file. Continue?',
                    )
                    if (!ok) return
                    setMoreOpen(false)
                    void run('detect-missing', () =>
                      runReconciliationMatching(props.statement.id, { rerun: true, detectMissing: true }),
                    )
                  }}
                >
                  {props.statement.detectMissing ? 'Missing detection already on' : 'Detect missing for full period'}
                </button>
                {props.canConfirmReceipts && (
                  <button
                    type="button"
                    disabled={Boolean(busy) || selected.size === 0}
                    className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => {
                      setMoreOpen(false)
                      void run('confirm-selected', async () => {
                        const result = await confirmReconciliationReceipts(props.statement.id, [...selected])
                        return { error: result.error }
                      })
                    }}
                  >
                    Confirm selected rows
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    Boolean(busy) || (props.statement.status === 'completed' && !props.canConfigure)
                  }
                  className="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                  onClick={() => {
                    setMoreOpen(false)
                    void run('cancel', () => updateStatementStatus(props.statement.id, 'cancelled'))
                  }}
                >
                  Cancel statement
                </button>
                {props.canConfigure && (
                  <label className="mt-1 flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
                    Tolerance
                    <input
                      className={`${inputClass} w-20`}
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
            )}
          </div>
        </div>
      </div>

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

      {rowView === 'all' && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {['pending', 'auto_matched', 'manual_matched', 'exception', 'unmatched', 'confirmed', 'skipped'].map(
              (s) => (
                <option key={s} value={s}>
                  {formatReconciliationStatus(s)}
                </option>
              ),
            )}
          </select>
          <select className={selectClass} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All sources</option>
            <option value="import">Imported</option>
            <option value="missing">Missing from statement</option>
          </select>
        </div>
      )}

      {rowView === 'review' && open.length === 0 && (
        <p className="text-sm text-slate-500">No items need review. Use View all rows to see matched commissions.</p>
      )}

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
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Detail</th>
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
                  <td className="px-3 py-2">
                    {row.transactionType ? formatTypeLabel(row.transactionType) : '—'}
                  </td>
                  <td className="px-3 py-2">{formatSignedCurrency(row.expectedCommission)}</td>
                  <td className="px-3 py-2">{formatSignedCurrency(row.commissionAmount)}</td>
                  <td className="px-3 py-2">{formatSignedCurrency(row.variance)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationMatchLabelClass(row)}`}
                    >
                      {formatReconciliationMatchLabel(row)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationStatusClass(row.discrepancyType)}`}
                    >
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
                      <Link
                        className="text-alza-blue-700 hover:underline"
                        to={`/transactions/${row.matchedTransactionId}`}
                      >
                        {row.transactionNumber || 'Open'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {showRowActions(row) ? (
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
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                    {row.resolutionNotes &&
                      !isPreviouslyConfirmedSkip(row.resolutionNotes) &&
                      !String(row.resolutionNotes).includes('Already matched on another statement') && (
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

function SummaryPill(props: {
  label: string
  value: number
  tone: 'ok' | 'warn' | 'muted'
}) {
  const tone =
    props.tone === 'ok'
      ? 'bg-emerald-50 text-emerald-900 ring-emerald-600/15'
      : props.tone === 'warn'
        ? 'bg-orange-50 text-orange-900 ring-orange-600/15'
        : 'bg-slate-50 text-slate-700 ring-slate-500/15'
  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ring-inset ${tone}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{props.label}</p>
      <p className="text-xl font-semibold">{props.value}</p>
    </div>
  )
}
