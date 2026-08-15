import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileText,
  Plus,
  Search as SearchIcon,
  ShieldCheck,
} from 'lucide-react'
import { AddPolicyModal } from '../components/policies/AddPolicyModal'
import { SearchInput } from '../components/ui/SearchInput'
import { useAuth } from '../lib/auth'
import {
  canManagePolicies,
  isProducerBookScoped,
  producerKeysMatch,
  resolveProducerBookName,
  roleInputFromProfile,
} from '../lib/permissions'
import { supabase } from '../lib/supabase'

type PolicyStatus = 'active' | 'pending' | 'expired' | 'cancelled' | 'renewal_due'

interface PolicyRow {
  id: string
  clientName: string
  clientId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  effectiveDate: string
  expirationDate: string
  producer: string
  csr: string
  premium: number
  status: PolicyStatus
}

const PAGE_SIZE = 10
const ALL = 'all'

const statusLabels: Record<PolicyStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  expired: 'Expired',
  cancelled: 'Cancelled',
  renewal_due: 'Renewal Due',
}

const statusStyles: Record<PolicyStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  expired: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  cancelled: 'bg-red-50 text-red-700 ring-red-600/20',
  renewal_due: 'bg-orange-50 text-orange-700 ring-orange-600/20',
}

function normalizeStatus(value: string | null): PolicyStatus {
  const v = (value ?? '').toLowerCase()
  if (v === 'active' || v === 'pending' || v === 'expired' || v === 'cancelled' || v === 'renewal_due') {
    return v
  }
  return 'pending'
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isRenewalDueWithin90Days(expirationDate: string): boolean {
  if (!expirationDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiration = new Date(`${expirationDate}T00:00:00`)
  const diffDays = (expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 90
}

export function PolicyFiles() {
  const { profile } = useAuth()
  const roleInput = roleInputFromProfile(profile)
  const canAdd = canManagePolicies(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const clientFilter = searchParams.get('client') ?? ALL
  const typeFilter = searchParams.get('type') ?? ALL
  const carrierFilter = searchParams.get('carrier') ?? ALL
  const mgaFilter = searchParams.get('mga') ?? ALL
  const producerFilter = searchParams.get('producer') ?? ALL
  const csrFilter = searchParams.get('csr') ?? ALL
  const statusFilter = searchParams.get('status') ?? ALL
  const effectiveYearFilter = searchParams.get('effYear') ?? ALL
  const expirationYearFilter = searchParams.get('expYear') ?? ALL
  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [producerScopeLimitation, setProducerScopeLimitation] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [page, setPage] = useState(1)

  const loadPolicies = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    setProducerScopeLimitation(null)
    const { data, error } = await supabase
      .from('policies')
      .select(
        `
        id,
        client_id,
        policy_number,
        policy_type,
        carrier,
        mga,
        producer,
        csr,
        effective_date,
        expiration_date,
        premium,
        status,
        clients ( business_name )
      `,
      )
      .is('archived_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      setPolicies([])
      setFetchError(error.message)
      setLoading(false)
      return
    }

    const mapped = (data ?? []).map((row) => {
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients
      return {
        id: String(row.id),
        clientId: String(row.client_id ?? ''),
        clientName: String(client?.business_name ?? '—'),
        policyNumber: String(row.policy_number ?? '—'),
        policyType: String(row.policy_type ?? '—'),
        carrier: String(row.carrier ?? '—'),
        mga: String(row.mga ?? '—'),
        effectiveDate: String(row.effective_date ?? ''),
        expirationDate: String(row.expiration_date ?? ''),
        producer: String(row.producer ?? '—'),
        csr: String(row.csr ?? '—'),
        premium: toNumber(row.premium),
        status: normalizeStatus(row.status as string | null),
      }
    })

    if (isProducerBookScoped(roleInput)) {
      const names = [...new Set(mapped.map((p) => p.producer).filter((p) => p && p !== '—'))]
      const scope = resolveProducerBookName(roleInput, profile?.fullName, names)
      setProducerScopeLimitation(scope.limitation)
      setPolicies(
        scope.lockedName
          ? mapped.filter((p) => producerKeysMatch(p.producer, scope.lockedName))
          : [],
      )
    } else {
      setProducerScopeLimitation(null)
      setPolicies(mapped)
    }
    setLoading(false)
  }, [roleInput, profile?.fullName])

  useEffect(() => {
    void loadPolicies()
  }, [loadPolicies])

  useEffect(() => {
    setPage(1)
  }, [
    search,
    clientFilter,
    statusFilter,
    typeFilter,
    carrierFilter,
    mgaFilter,
    producerFilter,
    csrFilter,
    effectiveYearFilter,
    expirationYearFilter,
  ])

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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return policies.filter((policy) => {
      if (clientFilter !== ALL && policy.clientId !== clientFilter) return false
      if (statusFilter !== ALL && policy.status !== statusFilter) return false
      if (typeFilter !== ALL && policy.policyType !== typeFilter) return false
      if (carrierFilter !== ALL && policy.carrier !== carrierFilter) return false
      if (mgaFilter !== ALL && policy.mga !== mgaFilter) return false
      if (producerFilter !== ALL && policy.producer !== producerFilter) return false
      if (csrFilter !== ALL && policy.csr !== csrFilter) return false
      if (effectiveYearFilter !== ALL && policy.effectiveDate.slice(0, 4) !== effectiveYearFilter) return false
      if (expirationYearFilter !== ALL && policy.expirationDate.slice(0, 4) !== expirationYearFilter) return false
      if (!query) return true
      return (
        policy.clientName.toLowerCase().includes(query) ||
        policy.policyNumber.toLowerCase().includes(query) ||
        policy.policyType.toLowerCase().includes(query) ||
        policy.carrier.toLowerCase().includes(query) ||
        policy.mga.toLowerCase().includes(query) ||
        policy.producer.toLowerCase().includes(query) ||
        policy.csr.toLowerCase().includes(query)
      )
    })
  }, [
    policies,
    search,
    clientFilter,
    statusFilter,
    typeFilter,
    carrierFilter,
    mgaFilter,
    producerFilter,
    csrFilter,
    effectiveYearFilter,
    expirationYearFilter,
  ])

  const summary = useMemo(() => {
    const active = policies.filter((p) => p.status === 'active').length
    const renewalsDue = policies.filter(
      (p) => p.status === 'renewal_due' || (p.status === 'active' && isRenewalDueWithin90Days(p.expirationDate)),
    ).length
    return {
      total: policies.length,
      active,
      renewalsDue,
      totalPremium: policies.reduce((sum, p) => sum + p.premium, 0),
    }
  }, [policies])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of policies) {
      if (!p.clientId) continue
      map.set(p.clientId, p.clientName || p.clientId)
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [policies])

  const typeOptions = useMemo(
    () => [...new Set(policies.map((p) => p.policyType).filter((v) => v && v !== '—'))].sort(),
    [policies],
  )
  const carrierOptions = useMemo(
    () => [...new Set(policies.map((p) => p.carrier).filter((v) => v && v !== '—'))].sort(),
    [policies],
  )
  const mgaOptions = useMemo(
    () => [...new Set(policies.map((p) => p.mga).filter((v) => v && v !== '—'))].sort(),
    [policies],
  )
  const producerOptions = useMemo(
    () => [...new Set(policies.map((p) => p.producer).filter((v) => v && v !== '—'))].sort(),
    [policies],
  )
  const csrOptions = useMemo(
    () => [...new Set(policies.map((p) => p.csr).filter((v) => v && v !== '—'))].sort(),
    [policies],
  )
  const effectiveYearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const p of policies) {
      const y = p.effectiveDate?.slice(0, 4)
      if (y && /^\d{4}$/.test(y)) years.add(y)
    }
    return [...years].sort((a, b) => b.localeCompare(a))
  }, [policies])
  const expirationYearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const p of policies) {
      const y = p.expirationDate?.slice(0, 4)
      if (y && /^\d{4}$/.test(y)) years.add(y)
    }
    return [...years].sort((a, b) => b.localeCompare(a))
  }, [policies])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const selectClassName =
    'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <SearchInput
            value={search}
            onChange={(e) => {
              const value = e.currentTarget.value
              setParam('search', value.trim() ? value : '')
            }}
            onSearch={(e) => {
              const value = e.currentTarget.value
              setParam('search', value.trim() ? value : '')
            }}
            placeholder="Search by client, policy #, carrier, MGA, producer, CSR, or type..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        {canAdd && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Policy
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Policies" value={String(summary.total)} icon={FileText} tone="blue" />
        <Kpi label="Active Policies" value={String(summary.active)} icon={ShieldCheck} tone="emerald" />
        <Kpi label="Renewals Due in 90 Days" value={String(summary.renewalsDue)} icon={CalendarClock} tone="amber" />
        <Kpi label="Total Written Premium" value={formatCurrency(summary.totalPremium)} icon={DollarSign} tone="teal" />
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        <select value={clientFilter} onChange={(e) => setParam('client', e.target.value)} className={selectClassName}>
          <option value={ALL}>All clients</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setParam('status', e.target.value)} className={selectClassName}>
          <option value={ALL}>All statuses</option>
          {(Object.keys(statusLabels) as PolicyStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabels[s]}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setParam('type', e.target.value)} className={selectClassName}>
          <option value={ALL}>All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={carrierFilter} onChange={(e) => setParam('carrier', e.target.value)} className={selectClassName}>
          <option value={ALL}>All carriers</option>
          {carrierOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={mgaFilter} onChange={(e) => setParam('mga', e.target.value)} className={selectClassName}>
          <option value={ALL}>All MGAs</option>
          {mgaOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select value={producerFilter} onChange={(e) => setParam('producer', e.target.value)} className={selectClassName}>
          <option value={ALL}>All producers</option>
          {producerOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={csrFilter} onChange={(e) => setParam('csr', e.target.value)} className={selectClassName}>
          <option value={ALL}>All CSRs</option>
          {csrOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={effectiveYearFilter} onChange={(e) => setParam('effYear', e.target.value)} className={selectClassName}>
          <option value={ALL}>All effective years</option>
          {effectiveYearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={expirationYearFilter} onChange={(e) => setParam('expYear', e.target.value)} className={selectClassName}>
          <option value={ALL}>All expiration years</option>
          {expirationYearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {producerLocked && producerScopeLimitation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {producerScopeLimitation}
        </div>
      )}
      {fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load policies: {fetchError}
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {actionSuccess}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {['Client', 'Policy Number', 'Type', 'Carrier / MGA', 'Effective', 'Expiration', 'Producer', 'CSR', 'Premium', 'Status'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">Loading policies…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">No policies found</td></tr>
              ) : (
                paginated.map((policy) => (
                  <tr key={policy.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-sm">
                      {policy.clientId ? (
                        <Link
                          to={`/clients/${policy.clientId}`}
                          className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
                        >
                          {policy.clientName}
                        </Link>
                      ) : (
                        <span className="text-slate-900">{policy.clientName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Link to={`/policies/${policy.id}`} className="font-medium text-alza-blue-700 hover:text-alza-blue-800">
                        {policy.policyNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{policy.policyType}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <div>{policy.carrier}</div>
                      <div className="text-xs text-slate-500">{policy.mga}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(policy.effectiveDate)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{formatDate(policy.expirationDate)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{policy.producer}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{policy.csr}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">{formatCurrency(policy.premium)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[policy.status]}`}>
                        {statusLabels[policy.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-sm text-slate-500">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <AddPolicyModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async (policyId) => {
          setActionSuccess('Policy created.')
          await loadPolicies()
          navigate(`/policies/${policyId}`)
        }}
      />
    </div>
  )
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: typeof FileText
  tone: 'blue' | 'emerald' | 'amber' | 'teal'
}) {
  const tones = {
    blue: 'bg-alza-blue-50 text-alza-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    teal: 'bg-alza-teal-50 text-alza-teal-600',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}
