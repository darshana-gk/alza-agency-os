import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CalendarRange,
  CircleDollarSign,
  Download,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import {
  fetchCommissionTransactions,
  formatCurrency,
  formatDate,
  formatLabel,
  formatTypeLabel,
  paymentStatusStyles,
  PRODUCER_PAYMENT_STATUSES,
  TRANSACTION_TYPES,
  type CommissionTransaction,
} from '../lib/commission'
import {
  isProducerBookScoped,
  resolveProducerBookName,
  roleInputFromProfile,
} from '../lib/permissions'
import { exportProducerRevenueReport } from '../lib/reportsExport'

const ALL = 'all'
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function currentYear(): string {
  return String(new Date().getFullYear())
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthKeyFromDate(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function yearFromDate(isoDate: string): string {
  return isoDate.slice(0, 4)
}

function monthIndex(isoDate: string): number {
  const m = Number(isoDate.slice(5, 7))
  return Number.isFinite(m) ? m - 1 : -1
}

function sumProducer(rows: CommissionTransaction[]): number {
  return rows.reduce((sum, tx) => sum + tx.producerCommissionAmount, 0)
}

function sumAgency(rows: CommissionTransaction[]): number {
  return rows.reduce((sum, tx) => sum + tx.agencyCommissionAmount, 0)
}

function sumBroker(rows: CommissionTransaction[]): number {
  return rows.reduce((sum, tx) => sum + tx.brokerFee, 0)
}

function sumAgencyNet(rows: CommissionTransaction[]): number {
  return rows.reduce((sum, tx) => sum + tx.agencyNetCommission, 0)
}

function sumPremium(rows: CommissionTransaction[]): number {
  return rows.reduce((sum, tx) => sum + tx.amount, 0)
}

function formatSignedCurrency(amount: number): string {
  const abs = formatCurrency(Math.abs(amount))
  if (amount > 0) return `+${abs}`
  if (amount < 0) return `-${abs}`
  return abs
}

function formatYoyPct(pct: number | null): string {
  if (pct === null) return '—'
  const rounded = Math.round(pct * 10) / 10
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded.toFixed(1)}%`
}

export function Reports() {
  const { profile } = useAuth()
  const roleInput = roleInputFromProfile(profile)
  const [searchParams] = useSearchParams()
  const [transactions, setTransactions] = useState<CommissionTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [yearFilter, setYearFilter] = useState(currentYear())
  const [monthFilter, setMonthFilter] = useState(ALL)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [producerFilter, setProducerFilter] = useState(ALL)
  const [clientFilter, setClientFilter] = useState(ALL)
  const [policyFilter, setPolicyFilter] = useState(ALL)
  const [typeFilter, setTypeFilter] = useState(ALL)
  const [paymentFilter, setPaymentFilter] = useState(ALL)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    const { data, error } = await fetchCommissionTransactions()
    if (error) {
      setFetchError(error.message)
      setTransactions([])
    } else {
      setTransactions(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allProducerNames = useMemo(() => {
    return [...new Set(transactions.map((tx) => tx.producer).filter((p) => p && p !== '—'))].sort(
      (a, b) => a.localeCompare(b),
    )
  }, [transactions])

  const producerLocked = isProducerBookScoped(roleInput)
  const producerScope = useMemo(
    () =>
      resolveProducerBookName(roleInput, profile?.fullName, allProducerNames, {
        linkedProducerName: profile?.linkedProducerName,
      }),
    [roleInput, profile?.fullName, profile?.linkedProducerName, allProducerNames],
  )

  // Role lock wins over URL ?producer= — producers never inherit another producer's filter.
  const effectiveProducerFilter = producerLocked
    ? producerScope.lockedName ?? '__no_producer_match__'
    : producerFilter
  const producerFilterLocked = producerLocked

  useEffect(() => {
    if (producerLocked) {
      setProducerFilter(producerScope.lockedName ?? ALL)
      return
    }
    const raw = searchParams.get('producer')
    if (!raw) return
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      decoded = raw
    }
    const wanted = decoded.trim()
    if (!wanted) return
    const match =
      allProducerNames.find((p) => p === wanted) ??
      allProducerNames.find((p) => p.toLowerCase() === wanted.toLowerCase())
    // Prefer canonical transaction.producer spelling; if none match, keep encoded name
    // so the report filters to empty rather than exposing another producer.
    setProducerFilter(match ?? wanted)
  }, [producerLocked, producerScope.lockedName, searchParams, allProducerNames])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const tx of transactions) {
      if (!tx.clientId) continue
      map.set(tx.clientId, tx.clientName || tx.clientId)
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [transactions])

  const policyOptions = useMemo(() => {
    const map = new Map<string, { number: string; clientId: string }>()
    for (const tx of transactions) {
      if (!tx.policyId) continue
      if (clientFilter !== ALL && tx.clientId !== clientFilter) continue
      map.set(tx.policyId, { number: tx.policyNumber || tx.policyId, clientId: tx.clientId })
    }
    return [...map.entries()]
      .map(([id, meta]) => ({ id, number: meta.number }))
      .sort((a, b) => a.number.localeCompare(b.number))
  }, [transactions, clientFilter])

  const yearOptions = useMemo(() => {
    const years = new Set(transactions.map((tx) => yearFromDate(tx.transactionDate)).filter(Boolean))
    years.add(currentYear())
    return [...years].sort((a, b) => b.localeCompare(a))
  }, [transactions])

  const filtered = useMemo(() => {
    if (producerLocked && producerScope.limitation) {
      return [] as CommissionTransaction[]
    }
    return transactions.filter((tx) => {
      if (yearFilter !== ALL && yearFromDate(tx.transactionDate) !== yearFilter) return false
      if (monthFilter !== ALL) {
        const idx = monthIndex(tx.transactionDate)
        if (idx < 0 || String(idx + 1).padStart(2, '0') !== monthFilter) return false
      }
      if (dateFrom && tx.transactionDate < dateFrom) return false
      if (dateTo && tx.transactionDate > dateTo) return false
      if (effectiveProducerFilter !== ALL && tx.producer !== effectiveProducerFilter) return false
      if (clientFilter !== ALL && tx.clientId !== clientFilter) return false
      if (policyFilter !== ALL && tx.policyId !== policyFilter) return false
      if (typeFilter !== ALL && tx.type !== typeFilter) return false
      if (paymentFilter !== ALL && tx.producerPaymentStatus !== paymentFilter) return false
      return true
    })
  }, [
    transactions,
    yearFilter,
    monthFilter,
    dateFrom,
    dateTo,
    effectiveProducerFilter,
    clientFilter,
    policyFilter,
    typeFilter,
    paymentFilter,
    producerLocked,
    producerScope.limitation,
  ])

  const kpis = useMemo(() => {
    const nowYear = currentYear()
    const nowMonth = currentMonthKey()
    const total = sumProducer(filtered)
    const currentMonth = sumProducer(
      filtered.filter((tx) => monthKeyFromDate(tx.transactionDate) === nowMonth),
    )
    const currentYearTotal = sumProducer(
      filtered.filter((tx) => yearFromDate(tx.transactionDate) === nowYear),
    )
    const agencyNet = sumAgencyNet(filtered)
    const earned = sumProducer(filtered)
    const ready = sumProducer(filtered.filter((tx) => tx.producerPaymentStatus === 'ready'))
    const paid = sumProducer(filtered.filter((tx) => tx.producerPaymentStatus === 'paid'))
    return {
      total,
      currentMonth,
      currentYearTotal,
      agencyNet,
      agencyCommission: sumAgency(filtered),
      brokerFees: sumBroker(filtered),
      earned,
      ready,
      paid,
    }
  }, [filtered])

  const chartYear = yearFilter === ALL ? currentYear() : yearFilter
  const priorChartYear = String(Number(chartYear) - 1)

  const monthlySeries = useMemo(() => {
    // Use unfiltered-by-year rows for prior-year comparison while respecting other filters.
    const base = transactions.filter((tx) => {
      if (producerLocked && producerScope.limitation) return false
      if (effectiveProducerFilter !== ALL && tx.producer !== effectiveProducerFilter) return false
      if (clientFilter !== ALL && tx.clientId !== clientFilter) return false
      if (policyFilter !== ALL && tx.policyId !== policyFilter) return false
      if (typeFilter !== ALL && tx.type !== typeFilter) return false
      if (paymentFilter !== ALL && tx.producerPaymentStatus !== paymentFilter) return false
      if (dateFrom && tx.transactionDate < dateFrom) return false
      if (dateTo && tx.transactionDate > dateTo) return false
      if (monthFilter !== ALL && tx.transactionDate.slice(5, 7) !== monthFilter) return false
      return true
    })
    const selectedRows = base.filter((tx) => yearFromDate(tx.transactionDate) === chartYear)
    const priorRows = base.filter((tx) => yearFromDate(tx.transactionDate) === priorChartYear)
    return MONTH_LABELS.map((label, index) => {
      const monthNum = String(index + 1).padStart(2, '0')
      const selected = selectedRows.filter((tx) => tx.transactionDate.slice(5, 7) === monthNum)
      const prior = priorRows.filter((tx) => tx.transactionDate.slice(5, 7) === monthNum)
      const selectedAmt = sumProducer(selected)
      const priorAmt = sumProducer(prior)
      return {
        month: label,
        producerCommission: selectedAmt,
        priorYearCommission: priorAmt,
        yoyChange: selectedAmt - priorAmt,
        agencyCommission: sumAgency(selected),
        brokerFee: sumBroker(selected),
        agencyNet: sumAgencyNet(selected),
        count: selected.length,
      }
    })
  }, [
    transactions,
    chartYear,
    priorChartYear,
    effectiveProducerFilter,
    clientFilter,
    policyFilter,
    typeFilter,
    paymentFilter,
    dateFrom,
    dateTo,
    monthFilter,
    producerLocked,
    producerScope.limitation,
  ])

  const yearlySeries = useMemo(() => {
    const byYear = new Map<string, CommissionTransaction[]>()
    for (const tx of filtered) {
      const y = yearFromDate(tx.transactionDate)
      if (!y) continue
      const list = byYear.get(y) ?? []
      list.push(tx)
      byYear.set(y, list)
    }
    const rows = [...byYear.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, yearRows]) => ({
        year,
        producerCommission: sumProducer(yearRows),
        agencyCommission: sumAgency(yearRows),
        brokerFee: sumBroker(yearRows),
        agencyNet: sumAgencyNet(yearRows),
        count: yearRows.length,
      }))
    return rows.map((row, index) => {
      const prior = rows.find((r) => r.year === String(Number(row.year) - 1))
      const priorAmt = prior?.producerCommission ?? 0
      const change = row.producerCommission - priorAmt
      const yoyPct = priorAmt === 0 ? null : (change / priorAmt) * 100
      return { ...row, priorYearCommission: priorAmt, yoyChange: change, yoyPct, _i: index }
    })
  }, [filtered])

  const producerComparison = useMemo(() => {
    if (effectiveProducerFilter !== ALL) return []
    const byProducer = new Map<string, CommissionTransaction[]>()
    for (const tx of filtered) {
      const name = tx.producer && tx.producer !== '—' ? tx.producer : 'Unassigned'
      const list = byProducer.get(name) ?? []
      list.push(tx)
      byProducer.set(name, list)
    }

    // Prior calendar year totals for YoY when a specific year is selected.
    const compareYear = yearFilter === ALL ? null : yearFilter
    const priorYear = compareYear ? String(Number(compareYear) - 1) : null
    const priorByProducer = new Map<string, number>()
    if (priorYear) {
      for (const tx of transactions) {
        if (yearFromDate(tx.transactionDate) !== priorYear) continue
        if (clientFilter !== ALL && tx.clientId !== clientFilter) continue
        if (policyFilter !== ALL && tx.policyId !== policyFilter) continue
        if (typeFilter !== ALL && tx.type !== typeFilter) continue
        if (paymentFilter !== ALL && tx.producerPaymentStatus !== paymentFilter) continue
        const name = tx.producer && tx.producer !== '—' ? tx.producer : 'Unassigned'
        priorByProducer.set(name, (priorByProducer.get(name) ?? 0) + tx.producerCommissionAmount)
      }
    }

    return [...byProducer.entries()]
      .map(([producer, rows]) => {
        const producerCommission = sumProducer(rows)
        const prior = priorByProducer.get(producer) ?? 0
        const yoyChange = producerCommission - prior
        const yoyPct = prior === 0 ? null : (yoyChange / prior) * 100
        return {
          producer,
          producerCommission,
          priorYearCommission: prior,
          yoyChange,
          yoyPct,
          agencyCommission: sumAgency(rows),
          brokerFees: sumBroker(rows),
          agencyNet: sumAgencyNet(rows),
          count: rows.length,
        }
      })
      .sort((a, b) => b.producerCommission - a.producerCommission)
  }, [
    filtered,
    effectiveProducerFilter,
    yearFilter,
    transactions,
    clientFilter,
    policyFilter,
    typeFilter,
    paymentFilter,
  ])


  const monthlyBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        month: string
        producer: string
        rows: CommissionTransaction[]
      }
    >()
    for (const tx of filtered) {
      const y = yearFromDate(tx.transactionDate)
      const m = tx.transactionDate.slice(5, 7)
      if (!y || !m) continue
      const producer = tx.producer && tx.producer !== '—' ? tx.producer : 'Unassigned'
      const key = `${y}-${m}::${producer}`
      const existing = map.get(key)
      if (existing) {
        existing.rows.push(tx)
      } else {
        map.set(key, {
          month: `${y}-${m}`,
          producer,
          rows: [tx],
        })
      }
    }
    return [...map.values()]
      .map((entry) => ({
        month: entry.month,
        producer: entry.producer,
        count: entry.rows.length,
        premiumVolume: sumPremium(entry.rows),
        agencyCommission: sumAgency(entry.rows),
        brokerFees: sumBroker(entry.rows),
        producerCommission: sumProducer(entry.rows),
        agencyNet: sumAgencyNet(entry.rows),
      }))
      .sort((a, b) => {
        if (a.month !== b.month) return b.month.localeCompare(a.month)
        return b.producerCommission - a.producerCommission
      })
  }, [filtered])

  const hasActiveFilters =
    yearFilter !== ALL ||
    monthFilter !== ALL ||
    dateFrom !== '' ||
    dateTo !== '' ||
    (!producerFilterLocked && producerFilter !== ALL) ||
    clientFilter !== ALL ||
    policyFilter !== ALL ||
    typeFilter !== ALL ||
    paymentFilter !== ALL

  function clearFilters() {
    setYearFilter(currentYear())
    setMonthFilter(ALL)
    setDateFrom('')
    setDateTo('')
    if (!producerFilterLocked) setProducerFilter(ALL)
    setClientFilter(ALL)
    setPolicyFilter(ALL)
    setTypeFilter(ALL)
    setPaymentFilter(ALL)
  }

  const detailRows = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) return b.transactionDate.localeCompare(a.transactionDate)
      return (b.transactionNumber || '').localeCompare(a.transactionNumber || '')
    })
  }, [filtered])

  async function handleExportExcel() {
    setExportError(null)
    setExporting(true)
    try {
      const clientLabel =
        clientFilter === ALL
          ? ALL
          : clientOptions.find((c) => c.id === clientFilter)?.name ?? clientFilter
      const policyLabel =
        policyFilter === ALL
          ? ALL
          : policyOptions.find((p) => p.id === policyFilter)?.number ?? policyFilter
      const monthLabel =
        monthFilter === ALL
          ? ALL
          : MONTH_LABELS[Number(monthFilter) - 1]
            ? `${MONTH_LABELS[Number(monthFilter) - 1]} (${monthFilter})`
            : monthFilter

      await exportProducerRevenueReport({
        filters: {
          year: yearFilter,
          month: monthLabel,
          dateFrom,
          dateTo,
          producer: effectiveProducerFilter,
          client: clientLabel,
          policy: policyLabel,
          transactionType: typeFilter === ALL ? ALL : formatTypeLabel(typeFilter),
          producerPaymentStatus: paymentFilter === ALL ? ALL : formatLabel(paymentFilter),
        },
        kpis: {
          total: kpis.total,
          currentMonth: kpis.currentMonth,
          currentYearTotal: kpis.currentYearTotal,
          agencyNet: kpis.agencyNet,
          earned: kpis.earned,
          ready: kpis.ready,
          paid: kpis.paid,
        },
        monthlyBreakdown,
        detailRows,
        security: {
          producerBookScoped: producerLocked,
          lockedProducerName: producerScope.lockedName,
        },
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Producer Revenue</h2>
        <p className="mt-1 text-sm text-slate-500">
          Stored <span className="font-medium">producer_commission_amount</span> from non-archived
          transactions (Gross Producer Commission). Recoveries are payment adjustments shown
          separately on Financials — they do not rewrite earned commission. Broker fee is not added
          again — it is already inside the producer share snapshot.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Payout view: Gross Producer Commission − Recovery Applied = Net Producer Payment (never below $0).
        </p>
      </div>

      {producerLocked && producerScope.limitation && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {producerScope.limitation}
        </div>
      )}

      {fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load transactions: {fetchError}
        </div>
      )}

      {exportError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Export failed: {exportError}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <CalendarRange className="h-4 w-4 text-slate-400" />
            Filters
            <span className="text-xs font-normal text-slate-400">
              {filtered.length} {filtered.length === 1 ? 'transaction' : 'transactions'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleExportExcel()}
              disabled={loading || exporting}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4 text-slate-500" />
              {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterSelect id="rep-year" label="Year" value={yearFilter} onChange={setYearFilter}>
            <option value={ALL}>All years</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="rep-month" label="Month" value={monthFilter} onChange={setMonthFilter}>
            <option value={ALL}>All months</option>
            {MONTH_LABELS.map((label, index) => (
              <option key={label} value={String(index + 1).padStart(2, '0')}>{label}</option>
            ))}
          </FilterSelect>
          <div>
            <label htmlFor="rep-from" className="mb-1.5 block text-xs font-medium text-slate-500">Date From</label>
            <input id="rep-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selectClassName} />
          </div>
          <div>
            <label htmlFor="rep-to" className="mb-1.5 block text-xs font-medium text-slate-500">Date To</label>
            <input id="rep-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selectClassName} />
          </div>
          <FilterSelect
            id="rep-producer"
            label="Producer"
            value={effectiveProducerFilter}
            onChange={setProducerFilter}
            disabled={producerFilterLocked}
          >
            <option value={ALL}>All producers</option>
            {allProducerNames.map((producer) => (
              <option key={producer} value={producer}>{producer}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="rep-client"
            label="Client"
            value={clientFilter}
            onChange={(value) => {
              setClientFilter(value)
              setPolicyFilter(ALL)
            }}
          >
            <option value={ALL}>All clients</option>
            {clientOptions.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="rep-policy" label="Policy" value={policyFilter} onChange={setPolicyFilter}>
            <option value={ALL}>All policies</option>
            {policyOptions.map((policy) => (
              <option key={policy.id} value={policy.id}>{policy.number}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="rep-type" label="Transaction Type" value={typeFilter} onChange={setTypeFilter}>
            <option value={ALL}>All types</option>
            {TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>{formatTypeLabel(type)}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="rep-payment" label="Producer Payment Status" value={paymentFilter} onChange={setPaymentFilter}>
            <option value={ALL}>All payment statuses</option>
            {PRODUCER_PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>{formatLabel(status)}</option>
            ))}
          </FilterSelect>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Producer Commission" value={formatCurrency(kpis.total)} icon={Users} tone="blue" />
        <KpiCard label="Current Month Producer Commission" value={formatCurrency(kpis.currentMonth)} icon={TrendingUp} tone="teal" />
        <KpiCard label="Current Year Producer Commission" value={formatCurrency(kpis.currentYearTotal)} icon={Wallet} tone="amber" />
        <KpiCard label="Agency Net Commission" value={formatCurrency(kpis.agencyNet)} icon={CircleDollarSign} tone="violet" />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <StatusCard label="Producer Commission Earned" value={formatCurrency(kpis.earned)} hint="All filtered non-archived transactions" />
        <StatusCard label="Producer Commission Ready" value={formatCurrency(kpis.ready)} hint="producer_payment_status = ready" />
        <StatusCard label="Producer Commission Paid" value={formatCurrency(kpis.paid)} hint="producer_payment_status = paid" />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Monthly Producer Revenue</h3>
            <p className="text-sm text-slate-500">
              {chartYear} vs {priorChartYear} · SUM(producer_commission_amount)
              {yearFilter === ALL ? ' (defaults to current year when All Years is selected)' : ''}
            </p>
          </div>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    tickFormatter={(v) =>
                      new Intl.NumberFormat('en-US', {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(Number(v))
                    }
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0' }}
                  />
                  <Legend />
                  <Bar dataKey="producerCommission" name={chartYear} fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="priorYearCommission" name={priorChartYear} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Txns</th>
                    <th className="px-3 py-2 text-right">{chartYear}</th>
                    <th className="px-3 py-2 text-right">{priorChartYear}</th>
                    <th className="px-3 py-2 text-right">Change</th>
                    <th className="px-3 py-2 text-right">Agency Commission</th>
                    <th className="px-3 py-2 text-right">Agency Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlySeries.map((row) => (
                    <tr key={row.month}>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.month}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.count}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.producerCommission)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(row.priorYearCommission)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatSignedCurrency(row.yoyChange)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyCommission)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Year-over-Year Revenue</h3>
        <p className="mt-1 text-sm text-slate-500">YEAR(transaction_date) → SUM(producer_commission_amount) with YoY change</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Year</th>
                <th className="px-3 py-2 text-right">Transactions</th>
                <th className="px-3 py-2 text-right">Producer Commission</th>
                <th className="px-3 py-2 text-right">Prior Year</th>
                <th className="px-3 py-2 text-right">Change</th>
                <th className="px-3 py-2 text-right">YoY %</th>
                <th className="px-3 py-2 text-right">Agency Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {yearlySeries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">No yearly data for current filters.</td>
                </tr>
              ) : (
                yearlySeries.map((row) => (
                  <tr key={row.year}>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{row.year}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.count}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.producerCommission)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(row.priorYearCommission)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatSignedCurrency(row.yoyChange)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatYoyPct(row.yoyPct)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyNet)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {yearlySeries.length > 0 && (
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearlySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat('en-US', {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(Number(v))
                  }
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0' }}
                />
                <Bar dataKey="producerCommission" name="Producer Commission" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {effectiveProducerFilter === ALL && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Producer Performance</h3>
            <p className="mt-1 text-sm text-slate-500">
              Grouped by producer · sorted by producer commission
              {yearFilter !== ALL ? ` · YoY vs ${Number(yearFilter) - 1}` : ''}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Producer</th>
                  <th className="px-4 py-3 text-right">Producer Commission</th>
                  {yearFilter !== ALL && (
                    <>
                      <th className="px-4 py-3 text-right">Prior Year</th>
                      <th className="px-4 py-3 text-right">Change</th>
                      <th className="px-4 py-3 text-right">YoY %</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right">Agency Commission</th>
                  <th className="px-4 py-3 text-right">Agency Net</th>
                  <th className="px-4 py-3 text-right">Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {producerComparison.length === 0 ? (
                  <tr>
                    <td colSpan={yearFilter !== ALL ? 8 : 5} className="px-4 py-8 text-center text-slate-500">No producer rows for current filters.</td>
                  </tr>
                ) : (
                  producerComparison.map((row) => (
                    <tr key={row.producer} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.producer}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.producerCommission)}</td>
                      {yearFilter !== ALL && (
                        <>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.priorYearCommission)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatSignedCurrency(row.yoyChange)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatYoyPct(row.yoyPct)}</td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyCommission)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyNet)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Monthly Breakdown</h3>
          <p className="mt-1 text-sm text-slate-500">Month · Producer · stored commission snapshots</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Producer</th>
                <th className="px-4 py-3 text-right">Transactions</th>
                <th className="px-4 py-3 text-right">Premium Volume</th>
                <th className="px-4 py-3 text-right">Agency Commission</th>
                <th className="px-4 py-3 text-right">Broker Fees</th>
                <th className="px-4 py-3 text-right">Producer Commission</th>
                <th className="px-4 py-3 text-right">Agency Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthlyBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">No monthly breakdown for current filters.</td>
                </tr>
              ) : (
                monthlyBreakdown.map((row) => (
                  <tr key={`${row.month}-${row.producer}`} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{row.month}</td>
                    <td className="px-4 py-3 text-slate-800">{row.producer}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.count}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.premiumVolume)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyCommission)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.brokerFees)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.producerCommission)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(row.agencyNet)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Transaction Detail</h3>
          <p className="mt-1 text-sm text-slate-500">Underlying stored rows for the current filters</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Transaction #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Policy</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Producer</th>
                <th className="px-4 py-3 text-right">Agency Commission</th>
                <th className="px-4 py-3 text-right">Broker Fee</th>
                <th className="px-4 py-3 text-right">Producer Commission</th>
                <th className="px-4 py-3 text-right">Agency Net</th>
                <th className="px-4 py-3">Payment Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">Loading transactions…</td>
                </tr>
              ) : detailRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">No transactions match the selected filters.</td>
                </tr>
              ) : (
                detailRows.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(tx.transactionDate)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/transactions/${tx.id}`} className="font-medium text-alza-blue-700 hover:underline">
                        {tx.transactionNumber || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{tx.clientName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{tx.policyNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatTypeLabel(tx.type)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${tx.amount < 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{tx.producer}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(tx.agencyCommissionAmount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(tx.brokerFee)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(tx.producerCommissionAmount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(tx.agencyNetCommission)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${paymentStatusStyles[tx.producerPaymentStatus]}`}>
                        {formatLabel(tx.producerPaymentStatus)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      <select
        id={id}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectClassName} ${disabled ? 'bg-slate-50 text-slate-600' : ''}`}
      >
        {children}
      </select>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: typeof Wallet
  tone: 'blue' | 'teal' | 'amber' | 'violet'
}) {
  const tones = {
    blue: 'bg-alza-blue-50 text-alza-blue-600',
    teal: 'bg-alza-teal-50 text-alza-teal-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900">{value}</p>
        </div>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  )
}

function StatusCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  )
}
