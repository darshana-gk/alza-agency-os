import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CircleDollarSign,
  FileText,
  RotateCcw,
  TrendingUp,
  Wallet,
} from 'lucide-react'
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
  fetchCommissionTransactions,
  formatCurrency,
  formatDate,
  formatTypeLabel,
  isCorrectionRequired,
  isReadyForPayout,
  type CommissionTransaction,
} from '../lib/commission'
import { useAuth } from '../lib/auth'
import { useAgency } from '../lib/agencyContext'
import {
  fetchOperationalNotifications,
  type AttentionSummaryItem,
} from '../lib/notifications'
import {
  canAccessFinancials,
  csrAssignmentMatches,
  isAdminDirectoryRole,
  isProducerBookScoped,
  isViewerRole,
  producerKeysMatch,
  resolveProducerBookName,
  roleInputFromProfile,
  toAppRoles,
} from '../lib/permissions'
import { supabase } from '../lib/supabase'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function currentYear(): number {
  return new Date().getFullYear()
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function daysFromToday(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function sumField(
  rows: CommissionTransaction[],
  pick: (tx: CommissionTransaction) => number,
): number {
  return rows.reduce((sum, tx) => sum + pick(tx), 0)
}

function periodMetrics(rows: CommissionTransaction[]) {
  return {
    premium: sumField(rows, (tx) => tx.amount),
    agency: sumField(rows, (tx) => tx.agencyCommissionAmount),
    producer: sumField(rows, (tx) => tx.producerCommissionAmount),
    agencyNet: sumField(rows, (tx) => tx.agencyNetCommission),
  }
}

export function Dashboard() {
  const { profile } = useAuth()
  const { agency } = useAgency()
  const roleInput = roleInputFromProfile(profile)
  const appRoles = toAppRoles(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const showAgencyOps = canAccessFinancials(roleInput) && !isViewerRole(roleInput)
  const isOwnerOrAdmin = isAdminDirectoryRole(roleInput)
  const isCsrViewer =
    appRoles.includes('csr') ||
    profile?.role === 'csr' ||
    (appRoles.includes('csr') && !appRoles.every((r) => r === 'producer'))
  const showReturnedForCorrectionCard = isCsrViewer || isOwnerOrAdmin
  const [transactions, setTransactions] = useState<CommissionTransaction[]>([])
  const [openRecoveries, setOpenRecoveries] = useState<{ count: number; amount: number; usesRemaining: boolean }>({
    count: 0,
    amount: 0,
    usesRemaining: false,
  })
  const [attention, setAttention] = useState<AttentionSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [producerScopeLimitation, setProducerScopeLimitation] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setProducerScopeLimitation(null)

    const today = new Date()
    const in90 = new Date(today)
    in90.setDate(in90.getDate() + 90)
    const todayIso = today.toISOString().slice(0, 10)
    const in90Iso = in90.toISOString().slice(0, 10)

    const [txRes, recoveriesRes, policiesRes, notificationsRes] = await Promise.all([
      fetchCommissionTransactions(),
      producerLocked
        ? Promise.resolve({ data: [] as { id: string; amount: number | null; remaining_amount: number | null; status: string | null; voided_at: string | null }[], error: null })
        : supabase
            .from('producer_commission_recoveries')
            .select('id, amount, remaining_amount, status, voided_at'),
      supabase
        .from('policies')
        .select('id, expiration_date, producer')
        .is('archived_at', null)
        .gte('expiration_date', todayIso)
        .lte('expiration_date', in90Iso),
      fetchOperationalNotifications({
        role: roleInput,
        fullName: profile?.fullName,
        email: profile?.email,
        profileId: profile?.id,
        linkedProducerName: profile?.linkedProducerName,
      }),
    ])

    let scopedTx = txRes.error ? ([] as CommissionTransaction[]) : txRes.data
    let scopedPolicies = policiesRes.data ?? []

    if (producerLocked) {
      const known = [
        ...new Set([
          ...scopedTx.map((tx) => tx.producer).filter((p) => p && p !== '—'),
          ...scopedPolicies.map((p) => String(p.producer ?? '').trim()).filter(Boolean),
        ]),
      ]
      const scope = resolveProducerBookName(roleInput, profile?.fullName, known, {
        linkedProducerName: profile?.linkedProducerName,
      })
      setProducerScopeLimitation(scope.limitation)
      if (!scope.lockedName) {
        scopedTx = []
        scopedPolicies = []
      } else {
        scopedTx = scopedTx.filter((tx) => producerKeysMatch(tx.producer, scope.lockedName))
        scopedPolicies = scopedPolicies.filter((p) =>
          producerKeysMatch(String(p.producer ?? ''), scope.lockedName),
        )
      }
    }

    if (txRes.error) {
      setError(txRes.error.message)
      setTransactions([])
    } else {
      setTransactions(scopedTx)
    }

    if (!producerLocked && !recoveriesRes.error) {
      const rows = recoveriesRes.data ?? []
      const hasRemaining = rows.some((r) => r.remaining_amount !== null && r.remaining_amount !== undefined)
      const openRows = rows.filter((r) => {
        const status = String(r.status ?? '').toLowerCase()
        if (r.voided_at) return false
        if (status === 'voided' || status === 'applied') return false
        if (hasRemaining) {
          const remaining = Number(r.remaining_amount ?? 0)
          return remaining > 0 || status === 'open' || status === 'pending'
        }
        return status === 'open' || status === 'pending' || status === ''
      })
      const amount = openRows.reduce((sum, r) => {
        if (hasRemaining) {
          const remaining = Number(r.remaining_amount)
          if (Number.isFinite(remaining)) return sum + remaining
        }
        return sum + (Number(r.amount) || 0)
      }, 0)
      setOpenRecoveries({
        count: openRows.length,
        amount,
        usesRemaining: hasRemaining,
      })
    } else {
      setOpenRecoveries({ count: 0, amount: 0, usesRemaining: false })
    }

    setAttention(notificationsRes.attention)
    if (notificationsRes.producerLimitation) {
      setProducerScopeLimitation(notificationsRes.producerLimitation)
    }
    setLoading(false)
  }, [producerLocked, profile?.fullName, profile?.linkedProducerName, profile?.id, roleInput])

  useEffect(() => {
    void load()
  }, [load])

  const nowMonth = currentMonthKey()
  const nowYear = String(currentYear())

  const returnedForCorrectionCount = useMemo(() => {
    return transactions.filter((tx) => {
      if (!isCorrectionRequired(tx)) return false
      if (tx.voidedAt || tx.archived) return false
      if (isOwnerOrAdmin) return true
      if (isCsrViewer) {
        return csrAssignmentMatches({
          csrUserId: tx.csrUserId,
          csrName: tx.csr,
          profileId: profile?.id,
          profileFullName: profile?.fullName,
          profileEmail: profile?.email,
        })
      }
      return false
    }).length
  }, [transactions, isOwnerOrAdmin, isCsrViewer, profile?.id, profile?.fullName, profile?.email])

  const kpis = useMemo(() => {
    const totalPremium = sumField(transactions, (tx) => tx.amount)
    const agencyCommission = sumField(transactions, (tx) => tx.agencyCommissionAmount)
    const producerCommission = sumField(transactions, (tx) => tx.producerCommissionAmount)
    const agencyNet = sumField(transactions, (tx) => tx.agencyNetCommission)
    const agencyReceived = transactions
      .filter((tx) => tx.agencyCommissionConfirmed)
      .reduce((sum, tx) => sum + (tx.amountReceived ?? 0), 0)
    const producerReady = transactions
      .filter((tx) => isReadyForPayout(tx))
      .reduce((sum, tx) => sum + tx.producerCommissionAmount, 0)
    const producerPaid = transactions
      .filter((tx) => tx.producerPaymentStatus === 'paid' || Boolean(tx.paidDate))
      .reduce((sum, tx) => sum + (tx.paidAmount ?? tx.producerCommissionAmount), 0)

    return {
      totalPremium,
      agencyCommission,
      producerCommission,
      agencyNet,
      agencyReceived,
      producerReady,
      producerPaid,
    }
  }, [transactions])

  const monthRows = useMemo(
    () => transactions.filter((tx) => tx.transactionDate.slice(0, 7) === nowMonth),
    [transactions, nowMonth],
  )
  const yearRows = useMemo(
    () => transactions.filter((tx) => tx.transactionDate.slice(0, 4) === nowYear),
    [transactions, nowYear],
  )
  const monthMetrics = useMemo(() => periodMetrics(monthRows), [monthRows])
  const yearMetrics = useMemo(() => periodMetrics(yearRows), [yearRows])

  const monthlyChart = useMemo(() => {
    const yearTx = transactions.filter((tx) => tx.transactionDate.slice(0, 4) === nowYear)
    return MONTH_LABELS.map((label, index) => {
      const monthNum = String(index + 1).padStart(2, '0')
      const rows = yearTx.filter((tx) => tx.transactionDate.slice(5, 7) === monthNum)
      return {
        month: label,
        premium: sumField(rows, (tx) => tx.amount),
        agency: sumField(rows, (tx) => tx.agencyCommissionAmount),
        producer: sumField(rows, (tx) => tx.producerCommissionAmount),
      }
    })
  }, [transactions, nowYear])

  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((a, b) => {
        const byDate = b.transactionDate.localeCompare(a.transactionDate)
        if (byDate !== 0) return byDate
        return b.transactionNumber.localeCompare(a.transactionNumber)
      })
      .slice(0, 8)
  }, [transactions])

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl gradient-alza p-6 text-white shadow-lg">
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/5" />
        <div className="relative">
          <h2 className="text-2xl font-bold">Welcome to ALZA Flow</h2>
          <p className="mt-2 max-w-2xl text-sm text-blue-100">
            {producerLocked
              ? 'Your producer book — live premium and commission from matched non-archived transactions.'
              : 'Live premium, commission, and operational metrics from non-archived transactions.'}
          </p>
          {agency?.agencyName ? (
            <p className="mt-3 text-sm font-medium text-white/90">
              Workspace: {agency.agencyName}
            </p>
          ) : null}
        </div>
      </div>

      {producerScopeLimitation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {producerScopeLimitation}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load dashboard: {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Total Premium" value={formatCurrency(kpis.totalPremium)} icon={CircleDollarSign} tone="blue" hint="SUM(transaction amount)" />
        <Kpi title="Agency Commission" value={formatCurrency(kpis.agencyCommission)} icon={Wallet} tone="teal" hint="Stored agency_commission_amount" />
        <Kpi title="Producer Commission" value={formatCurrency(kpis.producerCommission)} icon={TrendingUp} tone="violet" hint="Stored producer_commission_amount" />
        <Kpi title="Agency Net Commission" value={formatCurrency(kpis.agencyNet)} icon={FileText} tone="amber" hint="Stored agency_net_commission" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!producerLocked && (
          <Kpi title="Agency Commission Received" value={formatCurrency(kpis.agencyReceived)} icon={Wallet} tone="teal" hint="Confirmed amount_received" />
        )}
        <Kpi title="Producer Commission Ready" value={formatCurrency(kpis.producerReady)} icon={TrendingUp} tone="amber" hint="Eligible ready payouts" />
        <Kpi title="Producer Commission Paid" value={formatCurrency(kpis.producerPaid)} icon={CircleDollarSign} tone="violet" hint="Paid producer commission" />
        {showAgencyOps && (
          <Kpi
            title={openRecoveries.usesRemaining ? 'Open Recoveries' : 'Recorded Recoveries'}
            value={formatCurrency(openRecoveries.amount)}
            icon={RotateCcw}
            tone="orange"
            hint={
              openRecoveries.usesRemaining
                ? `${openRecoveries.count} open · remaining_amount`
                : `${openRecoveries.count} recorded/open · not production-consumed`
            }
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h3 className="text-base font-semibold text-slate-900">Needs Attention</h3>
          </div>
          {showReturnedForCorrectionCard && (
            <Link
              to="/transactions?correction=yes"
              className="mb-4 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50/70 px-4 py-3 transition-colors hover:border-orange-300 hover:bg-orange-50"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-orange-950">Returned for Correction</p>
                <p className="text-xs text-orange-900/80">
                  {isCsrViewer
                    ? 'Transactions returned to you that need updates before resubmit.'
                    : 'Transactions returned for CSR correction.'}
                </p>
              </div>
              <span className="ml-3 shrink-0 text-2xl font-bold tabular-nums text-orange-950">
                {loading ? '—' : returnedForCorrectionCount}
              </span>
            </Link>
          )}
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
          ) : attention.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No open attention items from live data.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {attention.map((item) => (
                <Link
                  key={item.label}
                  to={item.href}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3 transition-colors hover:border-alza-blue-200 hover:bg-alza-blue-50/50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    {item.hint ? <p className="text-xs text-slate-500">{item.hint}</p> : null}
                  </div>
                  <span className="ml-3 shrink-0 text-lg font-bold tabular-nums text-slate-900">{item.count}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-alza-blue-600" />
            <h3 className="text-base font-semibold text-slate-900">Period Performance</h3>
          </div>
          <PeriodBlock title={`Current Month · ${nowMonth}`} metrics={monthMetrics} />
          <div className="my-3 border-t border-slate-100" />
          <PeriodBlock title={`Current Year · ${nowYear}`} metrics={yearMetrics} />
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Monthly Premium & Commission · {nowYear}</h3>
          <p className="text-sm text-slate-500">Live from transaction_date · no fake trend %</p>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12 }} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 12 }}
                tickFormatter={(v) =>
                  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v))
                }
              />
              <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0' }} />
              <Legend />
              <Bar dataKey="premium" name="Total Premium" fill="#2563eb" radius={[3, 3, 0, 0]} />
              <Bar dataKey="agency" name="Agency Commission" fill="#0d9488" radius={[3, 3, 0, 0]} />
              <Bar dataKey="producer" name="Producer Commission" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-alza-teal-600" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Recent Transactions</h3>
              <p className="text-sm text-slate-500">Live transaction feed (no fabricated activity log)</p>
            </div>
          </div>
          <Link to="/transactions" className="text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {loading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Loading…</p>
          ) : recentTransactions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No transactions yet.</p>
          ) : (
            recentTransactions.map((tx) => (
              <Link
                key={tx.id}
                to={`/transactions/${tx.id}`}
                className="flex flex-col gap-1 px-5 py-3.5 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {tx.transactionNumber} · {formatTypeLabel(tx.type)}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {tx.clientName} · {tx.policyNumber}
                    {daysFromToday(tx.transactionDate) <= 7 ? '' : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(tx.amount)}</p>
                  <p className="text-xs text-slate-400">{formatDate(tx.transactionDate)}</p>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function Kpi({
  title,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  title: string
  value: string
  hint?: string
  icon: typeof Wallet
  tone: 'blue' | 'teal' | 'violet' | 'amber' | 'orange'
}) {
  const tones = {
    blue: 'bg-alza-blue-50 text-alza-blue-600',
    teal: 'bg-alza-teal-50 text-alza-teal-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-600',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 truncate text-xl font-bold tabular-nums text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}

function PeriodBlock({
  title,
  metrics,
}: {
  title: string
  metrics: { premium: number; agency: number; producer: number; agencyNet: number }
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Total Premium</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{formatCurrency(metrics.premium)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Agency Commission</dt>
          <dd className="tabular-nums text-slate-800">{formatCurrency(metrics.agency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Producer Commission</dt>
          <dd className="tabular-nums text-slate-800">{formatCurrency(metrics.producer)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Agency Net</dt>
          <dd className="tabular-nums text-slate-800">{formatCurrency(metrics.agencyNet)}</dd>
        </div>
      </dl>
    </div>
  )
}
