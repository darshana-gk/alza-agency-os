import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { formatTypeLabel } from '../../lib/commission'
import { formatSignedCurrency, searchMatchTransactions } from '../../lib/reconciliation'

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export function MatchSearchDialog(props: {
  open: boolean
  initialQuery?: string
  onClose: () => void
  onSelect: (txn: {
    id: string
    expectedCommission: number
    transactionNumber: string
  }) => void
}) {
  const [query, setQuery] = useState(props.initialQuery ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Awaited<ReturnType<typeof searchMatchTransactions>>['data']>([])

  useEffect(() => {
    if (!props.open) return
    setQuery(props.initialQuery ?? '')
  }, [props.open, props.initialQuery])

  useEffect(() => {
    if (!props.open) return
    const handle = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        setError(null)
        const result = await searchMatchTransactions(query)
        if (result.error) setError(result.error)
        setRows(result.data)
        setLoading(false)
      })()
    }, 250)
    return () => window.clearTimeout(handle)
  }, [props.open, query])

  if (!props.open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Match to transaction</h2>
          <button type="button" onClick={props.onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search policy number, transaction number, carrier, or MGA"
            autoFocus
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Transaction</th>
                  <th className="px-3 py-2">Policy</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Expected</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Searching…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No transactions found.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{row.transactionNumber || '—'}</td>
                    <td className="px-3 py-2">{row.policyNumber || '—'}</td>
                    <td className="px-3 py-2">{row.clientName || '—'}</td>
                    <td className="px-3 py-2">{formatTypeLabel(row.type)}</td>
                    <td className="px-3 py-2">{formatSignedCurrency(row.expectedCommission)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={row.confirmed}
                        onClick={() =>
                          props.onSelect({
                            id: row.id,
                            expectedCommission: row.expectedCommission,
                            transactionNumber: row.transactionNumber,
                          })
                        }
                        className="rounded-lg bg-alza-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
                      >
                        {row.confirmed ? 'Already confirmed' : 'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
