import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
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
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { SearchInput } from '../../components/ui/SearchInput'
import { useAuth } from '../../lib/auth'
import {
  archiveProducer,
  createProducer,
  isAdminDirectoryRole,
  updateProducer,
} from '../../lib/directory'
import {
  fetchCommissionTransactions,
  formatCurrency,
  type CommissionTransaction,
} from '../../lib/commission'
import { supabase } from '../../lib/supabase'

type ProducerStatus = 'active' | 'inactive'

interface Producer {
  id: string
  name: string
  email: string
  phone: string
  status: ProducerStatus
  notes: string
  licenseNumber: string
  defaultSplitPercentage: number | null
}

interface ProducerListRevenue {
  currentMonth: number
  currentYear: number
  priorYear: number
  totalEarned: number
}

interface ProducerDetailRevenue {
  currentMonth: number
  currentYear: number
  priorCalendarYear: number
  totalEarned: number
  ready: number
  paid: number
  selectedYearRevenue: number
  priorYearRevenue: number
  yoyChange: number
  yoyPct: number | null
  monthlyCompare: {
    month: string
    selected: number
    prior: number
    change: number
  }[]
  yearly: {
    year: number
    count: number
    premium: number
    revenue: number
    paid: number
    ready: number
  }[]
}

const PAGE_SIZE = 10
const ALL = 'all'
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const statusLabels: Record<ProducerStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const statusStyles: Record<ProducerStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function normalizeStatus(value: string | null): ProducerStatus {
  return (value ?? '').toLowerCase() === 'inactive' ? 'inactive' : 'active'
}

/** Match producers.producer_name ↔ transactions.producer TEXT (no producer_id FK yet). */
function normalizeProducerKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function currentYear(): number {
  return new Date().getFullYear()
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function emptyListRevenue(): ProducerListRevenue {
  return { currentMonth: 0, currentYear: 0, priorYear: 0, totalEarned: 0 }
}

function emptyDetailRevenue(): ProducerDetailRevenue {
  return {
    currentMonth: 0,
    currentYear: 0,
    priorCalendarYear: 0,
    totalEarned: 0,
    ready: 0,
    paid: 0,
    selectedYearRevenue: 0,
    priorYearRevenue: 0,
    yoyChange: 0,
    yoyPct: null,
    monthlyCompare: MONTH_LABELS.map((month) => ({
      month,
      selected: 0,
      prior: 0,
      change: 0,
    })),
    yearly: [],
  }
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

function buildListRevenueMap(transactions: CommissionTransaction[]): Map<string, ProducerListRevenue> {
  const map = new Map<string, ProducerListRevenue>()
  const nowYear = String(currentYear())
  const priorYear = String(currentYear() - 1)
  const nowMonth = currentMonthKey()

  function ensure(key: string): ProducerListRevenue {
    let row = map.get(key)
    if (!row) {
      row = emptyListRevenue()
      map.set(key, row)
    }
    return row
  }

  for (const tx of transactions) {
    if (!tx.producer || tx.producer === '—') continue
    const key = normalizeProducerKey(tx.producer)
    const row = ensure(key)
    const amount = tx.producerCommissionAmount
    row.totalEarned += amount
    const y = tx.transactionDate.slice(0, 4)
    const ym = tx.transactionDate.slice(0, 7)
    if (ym === nowMonth) row.currentMonth += amount
    if (y === nowYear) row.currentYear += amount
    if (y === priorYear) row.priorYear += amount
  }

  return map
}

function buildProducerDetail(
  transactions: CommissionTransaction[],
  producerName: string,
  selectedYear: number,
): ProducerDetailRevenue {
  const key = normalizeProducerKey(producerName)
  const matched = transactions.filter(
    (tx) => tx.producer && tx.producer !== '—' && normalizeProducerKey(tx.producer) === key,
  )

  const nowY = currentYear()
  const nowMonth = currentMonthKey()
  const priorSelected = selectedYear - 1
  const detail = emptyDetailRevenue()
  const yearlyMap = new Map<
    number,
    { count: number; premium: number; revenue: number; paid: number; ready: number }
  >()

  for (const tx of matched) {
    const amount = tx.producerCommissionAmount
    const y = Number(tx.transactionDate.slice(0, 4))
    const monthIdx = Number(tx.transactionDate.slice(5, 7)) - 1
    const ym = tx.transactionDate.slice(0, 7)

    detail.totalEarned += amount
    if (tx.producerPaymentStatus === 'ready') detail.ready += amount
    if (tx.producerPaymentStatus === 'paid') detail.paid += amount
    if (ym === nowMonth) detail.currentMonth += amount
    if (y === nowY) detail.currentYear += amount
    if (y === nowY - 1) detail.priorCalendarYear += amount
    if (y === selectedYear) detail.selectedYearRevenue += amount
    if (y === priorSelected) detail.priorYearRevenue += amount

    if (monthIdx >= 0 && monthIdx < 12) {
      if (y === selectedYear) detail.monthlyCompare[monthIdx].selected += amount
      if (y === priorSelected) detail.monthlyCompare[monthIdx].prior += amount
    }

    if (Number.isFinite(y) && y > 0) {
      const yearRow = yearlyMap.get(y) ?? { count: 0, premium: 0, revenue: 0, paid: 0, ready: 0 }
      yearRow.count += 1
      yearRow.premium += tx.amount
      yearRow.revenue += amount
      if (tx.producerPaymentStatus === 'paid') yearRow.paid += amount
      if (tx.producerPaymentStatus === 'ready') yearRow.ready += amount
      yearlyMap.set(y, yearRow)
    }
  }

  for (const row of detail.monthlyCompare) {
    row.change = row.selected - row.prior
  }

  detail.yoyChange = detail.selectedYearRevenue - detail.priorYearRevenue
  detail.yoyPct =
    detail.priorYearRevenue === 0
      ? null
      : (detail.yoyChange / detail.priorYearRevenue) * 100

  detail.yearly = [...yearlyMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, row]) => ({ year, ...row }))

  return detail
}

export function Producers() {
  const { profile } = useAuth()
  const canMutate = isAdminDirectoryRole(profile?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const statusFilter = searchParams.get('status') ?? ALL
  const revenueYear = Number(searchParams.get('revenueYear') || currentYear()) || currentYear()
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Producer[]>([])
  const [transactions, setTransactions] = useState<CommissionTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Producer | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [detailYear, setDetailYear] = useState(currentYear())
  const [form, setForm] = useState({
    producerName: '',
    email: '',
    phone: '',
    status: 'active',
    notes: '',
    licenseNumber: '',
    defaultSplitPercentage: '',
  })

  const loadRows = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    const [producerRes, txRes] = await Promise.all([
      supabase
        .from('producers')
        .select('id, producer_name, email, phone, status, notes, license_number, default_split_percentage, archived_at')
        .is('archived_at', null)
        .order('producer_name', { ascending: true }),
      fetchCommissionTransactions(),
    ])

    if (producerRes.error) {
      setFetchError(producerRes.error.message)
      setRows([])
    } else {
      setRows(
        (producerRes.data ?? []).map((row) => ({
          id: row.id as string,
          name: String(row.producer_name ?? '').trim() || '—',
          email: String(row.email ?? '').trim(),
          phone: String(row.phone ?? '').trim(),
          status: normalizeStatus(row.status as string | null),
          notes: String(row.notes ?? '').trim(),
          licenseNumber: String(row.license_number ?? '').trim(),
          defaultSplitPercentage:
            row.default_split_percentage === null || row.default_split_percentage === undefined
              ? null
              : Number(row.default_split_percentage),
        })),
      )
    }

    if (txRes.error) {
      setFetchError((prev) => prev ?? txRes.error.message)
      setTransactions([])
    } else {
      setTransactions(txRes.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter])

  const revenueByProducer = useMemo(() => buildListRevenueMap(transactions), [transactions])

  function listRevenueFor(name: string): ProducerListRevenue {
    return revenueByProducer.get(normalizeProducerKey(name)) ?? emptyListRevenue()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((p) => {
      if (statusFilter !== ALL && p.status !== statusFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q) ||
        statusLabels[p.status].toLowerCase().includes(q)
      )
    })
  }, [rows, search, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const activeCount = rows.filter((p) => p.status === 'active').length

  const kpiRevenue = useMemo(() => {
    let month = 0
    let year = 0
    let allTime = 0
    for (const producer of rows) {
      const rev = listRevenueFor(producer.name)
      month += rev.currentMonth
      year += rev.currentYear
      allTime += rev.totalEarned
    }
    return { month, year, allTime }
  }, [rows, revenueByProducer])

  const selectedRevenue = useMemo(() => {
    if (!selected) return emptyDetailRevenue()
    return buildProducerDetail(transactions, selected.name, detailYear)
  }, [selected, transactions, detailYear])

  const yearOptions = useMemo(() => {
    const years = new Set(
      transactions
        .map((tx) => Number(tx.transactionDate.slice(0, 4)))
        .filter((y) => Number.isFinite(y) && y > 0),
    )
    years.add(currentYear())
    years.add(revenueYear)
    years.add(detailYear)
    return [...years].sort((a, b) => b - a)
  }, [transactions, revenueYear, detailYear])

  function setParam(key: string, value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === ALL) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  function openAdd() {
    setSelected(null)
    setForm({
      producerName: '',
      email: '',
      phone: '',
      status: 'active',
      notes: '',
      licenseNumber: '',
      defaultSplitPercentage: '',
    })
    setFormError(null)
    setArchiveConfirm(false)
    setDetailYear(currentYear())
    setModalMode('add')
  }

  function openEdit(producer: Producer) {
    setSelected(producer)
    setForm({
      producerName: producer.name,
      email: producer.email,
      phone: producer.phone,
      status: producer.status,
      notes: producer.notes,
      licenseNumber: producer.licenseNumber,
      defaultSplitPercentage:
        producer.defaultSplitPercentage === null ? '' : String(producer.defaultSplitPercentage),
    })
    setFormError(null)
    setArchiveConfirm(false)
    setDetailYear(currentYear())
    setModalMode('edit')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canMutate || saving) return
    setSaving(true)
    setFormError(null)

    const splitRaw = form.defaultSplitPercentage.trim()
    const split =
      splitRaw === ''
        ? null
        : Number.isFinite(Number(splitRaw))
          ? Number(splitRaw)
          : NaN
    if (splitRaw !== '' && (!Number.isFinite(split) || (split as number) < 0)) {
      setSaving(false)
      setFormError('Default split % must be a non-negative number.')
      return
    }

    if (modalMode === 'add') {
      const result = await createProducer({
        producerName: form.producerName,
        email: form.email,
        phone: form.phone,
        status: form.status,
        notes: form.notes,
        licenseNumber: form.licenseNumber,
        defaultSplitPercentage: split,
      })
      setSaving(false)
      if (result.error) {
        setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
        return
      }
    } else if (modalMode === 'edit' && selected) {
      const result = await updateProducer({
        id: selected.id,
        email: form.email,
        phone: form.phone,
        status: form.status,
        notes: form.notes,
        licenseNumber: form.licenseNumber,
        defaultSplitPercentage: split,
      })
      setSaving(false)
      if (result.error) {
        setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
        return
      }
    }

    setModalMode(null)
    await loadRows()
  }

  async function handleArchive() {
    if (!canMutate || !selected || saving) return
    setSaving(true)
    setFormError(null)
    const result = await archiveProducer(selected.id)
    setSaving(false)
    if (result.error) {
      setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
      setArchiveConfirm(false)
      return
    }
    setModalMode(null)
    setArchiveConfirm(false)
    await loadRows()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <SearchInput
              value={search}
              onChange={(e) => setParam('search', e.currentTarget.value)}
              onSearch={(e) => setParam('search', e.currentTarget.value)}
              placeholder="Search producers..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setParam('status', e.target.value)}
            className={`${selectClassName} sm:w-40`}
          >
            <option value={ALL}>All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={String(revenueYear)}
            onChange={(e) => setParam('revenueYear', e.target.value)}
            className={`${selectClassName} sm:w-36`}
            title="Revenue year context"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        {canMutate && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Producer
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Producers" value={String(rows.length)} icon={UserCog} tone="blue" />
        <KpiCard label="Active Producers" value={String(activeCount)} icon={Users} tone="teal" />
        <KpiCard label="Current Month Producer Revenue" value={formatCurrency(kpiRevenue.month)} icon={TrendingUp} tone="amber" />
        <KpiCard label="Current Year Producer Revenue" value={formatCurrency(kpiRevenue.year)} icon={Wallet} tone="violet" />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        All-time producer revenue earned (stored commission):{' '}
        <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(kpiRevenue.allTime)}</span>
        <span className="mt-1 block text-xs text-slate-400">
          Matched by normalized producer name text. Long-term should use producer_id UUID FK.
        </span>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load producers: {fetchError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {['Producer', 'Email', 'Phone', 'Split %', 'Current Month', 'Current Year', 'Total Earned', 'Status'].map((col) => (
                  <th
                    key={col}
                    className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      ['Current Month', 'Current Year', 'Total Earned', 'Split %'].includes(col) ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-600">
                    Loading producers...
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                    No producers found
                  </td>
                </tr>
              ) : (
                paginated.map((producer) => {
                  const rev = listRevenueFor(producer.name)
                  return (
                    <tr
                      key={producer.id}
                      onClick={() => openEdit(producer)}
                      className="cursor-pointer hover:bg-alza-blue-50/60"
                    >
                      <td className="px-4 py-4 text-sm font-medium text-alza-blue-700">{producer.name}</td>
                      <td className="px-4 py-4 text-sm text-slate-700">{producer.email || '—'}</td>
                      <td className="px-4 py-4 text-sm text-slate-700">{producer.phone || '—'}</td>
                      <td className="px-4 py-4 text-right text-sm tabular-nums text-slate-700">
                        {producer.defaultSplitPercentage === null ? '—' : `${producer.defaultSplitPercentage}%`}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium tabular-nums text-slate-900">
                        {formatCurrency(rev.currentMonth)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium tabular-nums text-slate-900">
                        {formatCurrency(rev.currentYear)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatCurrency(rev.totalEarned)}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[producer.status]}`}>
                          {statusLabels[producer.status]}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-sm text-slate-600">Page {currentPage} of {totalPages}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={() => !saving && setModalMode(null)} />
          <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{modalMode === 'add' ? 'Add Producer' : 'Edit Producer'}</h3>
              <button type="button" disabled={saving} onClick={() => setModalMode(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
              {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Producer name *</label>
                <input
                  required
                  disabled={modalMode === 'edit'}
                  className={`${inputClassName} ${modalMode === 'edit' ? 'bg-slate-50 text-slate-600' : ''}`}
                  value={form.producerName}
                  onChange={(e) => setForm((f) => ({ ...f, producerName: e.target.value }))}
                />
                {modalMode === 'edit' && (
                  <p className="mt-1 text-xs text-slate-500">
                    Name is locked because clients, policies, and transactions store the producer as text.
                  </p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Email</label>
                  <input type="email" className={inputClassName} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Phone</label>
                  <input className={inputClassName} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">License #</label>
                  <input className={inputClassName} value={form.licenseNumber} onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Default split %</label>
                  <input type="number" min="0" step="0.01" className={inputClassName} value={form.defaultSplitPercentage} onChange={(e) => setForm((f) => ({ ...f, defaultSplitPercentage: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Status</label>
                <select className={selectClassName} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Notes</label>
                <textarea rows={3} className={textareaClassName} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              {modalMode === 'edit' && selected && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Revenue Summary</p>
                      <p className="text-xs text-slate-500">Stored producer_commission_amount · name-matched</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={String(detailYear)}
                        onChange={(e) => setDetailYear(Number(e.target.value))}
                        className={`${selectClassName} w-28`}
                      >
                        {yearOptions.map((year) => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                      <Link
                        to={`/reports?producer=${encodeURIComponent(selected.name)}`}
                        className="inline-flex items-center rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-3 py-2 text-sm font-medium text-alza-blue-800 hover:bg-alza-blue-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Full Revenue Report
                      </Link>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <MiniStat label="Current Month" value={formatCurrency(selectedRevenue.currentMonth)} />
                    <MiniStat label="Current Year" value={formatCurrency(selectedRevenue.currentYear)} />
                    <MiniStat label="Prior Year" value={formatCurrency(selectedRevenue.priorCalendarYear)} />
                    <MiniStat label="All Time" value={formatCurrency(selectedRevenue.totalEarned)} />
                    <MiniStat
                      label="YoY (calendar)"
                      value={
                        selectedRevenue.priorCalendarYear === 0
                          ? '—'
                          : formatYoyPct(
                              ((selectedRevenue.currentYear - selectedRevenue.priorCalendarYear) /
                                selectedRevenue.priorCalendarYear) *
                                100,
                            )
                      }
                      hint={formatSignedCurrency(selectedRevenue.currentYear - selectedRevenue.priorCalendarYear)}
                    />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat label={`${detailYear} Revenue`} value={formatCurrency(selectedRevenue.selectedYearRevenue)} />
                    <MiniStat label={`${detailYear - 1} Revenue`} value={formatCurrency(selectedRevenue.priorYearRevenue)} />
                    <MiniStat label="Change" value={formatSignedCurrency(selectedRevenue.yoyChange)} />
                    <MiniStat label="YoY" value={formatYoyPct(selectedRevenue.yoyPct)} />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <MiniStat label="Earned" value={formatCurrency(selectedRevenue.totalEarned)} hint="All non-archived" />
                    <MiniStat label="Ready" value={formatCurrency(selectedRevenue.ready)} hint="payment_status = ready" />
                    <MiniStat label="Paid" value={formatCurrency(selectedRevenue.paid)} hint="payment_status = paid" />
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Monthly comparison · {detailYear} vs {detailYear - 1}
                    </p>
                    <div className="mb-3 h-52 w-full rounded-lg border border-slate-200 bg-white p-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={selectedRevenue.monthlyCompare} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
                          <YAxis
                            tick={{ fill: '#64748b', fontSize: 11 }}
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
                          <Bar dataKey="selected" name={String(detailYear)} fill="#2563eb" radius={[3, 3, 0, 0]} />
                          <Bar dataKey="prior" name={String(detailYear - 1)} fill="#94a3b8" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                            <th className="px-2 py-1.5">Month</th>
                            <th className="px-2 py-1.5 text-right">{detailYear}</th>
                            <th className="px-2 py-1.5 text-right">{detailYear - 1}</th>
                            <th className="px-2 py-1.5 text-right">Change</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedRevenue.monthlyCompare.map((row) => (
                            <tr key={row.month}>
                              <td className="px-2 py-1.5 font-medium text-slate-900">{row.month}</td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.selected)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatCurrency(row.prior)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatSignedCurrency(row.change)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      All-years performance
                    </p>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                          <th className="px-2 py-1.5">Year</th>
                          <th className="px-2 py-1.5 text-right">Transactions</th>
                          <th className="px-2 py-1.5 text-right">Premium Volume</th>
                          <th className="px-2 py-1.5 text-right">Producer Revenue</th>
                          <th className="px-2 py-1.5 text-right">Paid</th>
                          <th className="px-2 py-1.5 text-right">Ready</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedRevenue.yearly.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                              No transactions for this producer
                            </td>
                          </tr>
                        ) : (
                          selectedRevenue.yearly.map((row) => (
                            <tr key={row.year}>
                              <td className="px-2 py-1.5 font-semibold text-slate-900">{row.year}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{row.count}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatCurrency(row.premium)}</td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(row.revenue)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatCurrency(row.paid)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{formatCurrency(row.ready)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {modalMode === 'edit' && archiveConfirm && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <p className="font-medium">Archive this producer?</p>
                  <p className="mt-1 text-amber-800">Soft-archives the record (sets archived_at). Historical text references on policies/transactions are unchanged. This cannot be undone from this screen.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={saving} onClick={() => setArchiveConfirm(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">Cancel</button>
                    <button type="button" disabled={saving} onClick={() => void handleArchive()} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60">
                      {saving ? 'Archiving…' : 'Confirm archive'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                {modalMode === 'edit' && canMutate && !archiveConfirm ? (
                  <button type="button" disabled={saving} onClick={() => setArchiveConfirm(true)} className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
                    Soft Archive
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={saving} onClick={() => setModalMode(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Cancel
                  </button>
                  {canMutate && (
                    <button type="submit" disabled={saving || archiveConfirm} className="rounded-lg gradient-alza px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
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

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  )
}
