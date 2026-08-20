import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatTypeLabel } from '../../lib/commission'
import {
  formatReconciliationStatus,
  formatSignedCurrency,
  reconciliationStatusClass,
  resolveStatementRow,
  type ReconciliationStatement,
  type ReconciliationStatementRow,
} from '../../lib/reconciliation'

const selectClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

type ExceptionRow = ReconciliationStatementRow & { statement?: ReconciliationStatement }

export function ExceptionQueue(props: {
  rows: ExceptionRow[]
  onOpenStatement: (id: string) => void
  onRefresh: () => Promise<void>
}) {
  const [discrepancy, setDiscrepancy] = useState('all')
  const [party, setParty] = useState('all')
  const [busy, setBusy] = useState(false)

  const parties = useMemo(() => {
    const set = new Set<string>()
    for (const row of props.rows) {
      const label = row.statement?.carrier || row.statement?.mga || row.carrierName || row.mgaName
      if (label) set.add(label)
    }
    return [...set].sort()
  }, [props.rows])

  const filtered = useMemo(() => {
    return props.rows.filter((row) => {
      if (discrepancy !== 'all' && row.discrepancyType !== discrepancy) return false
      if (party !== 'all') {
        const label = row.statement?.carrier || row.statement?.mga || row.carrierName || row.mgaName
        if (label !== party) return false
      }
      return true
    })
  }, [props.rows, discrepancy, party])

  async function bulk(status: 'acknowledged' | 'resolved') {
    setBusy(true)
    for (const row of filtered) {
      await resolveStatementRow({
        rowId: row.id,
        resolutionStatus: status,
        notes: status === 'acknowledged' ? 'Acknowledged from Needs Review' : 'Resolved from Needs Review',
      })
    }
    await props.onRefresh()
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select className={selectClass} value={party} onChange={(e) => setParty(e.target.value)}>
          <option value="all">All carriers / MGAs</option>
          {parties.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className={selectClass} value={discrepancy} onChange={(e) => setDiscrepancy(e.target.value)}>
          <option value="all">All discrepancy types</option>
          {['underpaid', 'overpaid', 'missing_from_statement', 'unmatched_row', 'zero_amount', 'exact_match'].map(
            (d) => (
              <option key={d} value={d}>
                {formatReconciliationStatus(d)}
              </option>
            ),
          )}
        </select>
        <button
          type="button"
          disabled={busy || filtered.length === 0}
          onClick={() => void bulk('acknowledged')}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Acknowledge visible
        </button>
        <button
          type="button"
          disabled={busy || filtered.length === 0}
          onClick={() => void bulk('resolved')}
          className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Resolve visible
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Statement</th>
              <th className="px-3 py-2">Policy</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Expected</th>
              <th className="px-3 py-2">Actual</th>
              <th className="px-3 py-2">Discrepancy</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  Nothing needs review.
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-alza-blue-700 hover:underline"
                    onClick={() => props.onOpenStatement(row.statementId)}
                  >
                    {row.statement?.fileName || row.statementId}
                  </button>
                </td>
                <td className="px-3 py-2 font-medium">{row.policyNumber || '—'}</td>
                <td className="px-3 py-2">{row.transactionType ? formatTypeLabel(row.transactionType) : '—'}</td>
                <td className="px-3 py-2">{formatSignedCurrency(row.expectedCommission)}</td>
                <td className="px-3 py-2">{formatSignedCurrency(row.commissionAmount)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${reconciliationStatusClass(row.discrepancyType)}`}>
                    {formatReconciliationStatus(row.discrepancyType)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {row.matchedTransactionId && (
                    <Link className="text-xs text-alza-blue-700 hover:underline" to={`/transactions/${row.matchedTransactionId}`}>
                      Transaction
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
