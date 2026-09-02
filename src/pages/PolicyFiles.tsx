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
import { EditTermDetailsModal } from '../components/policies/EditTermDetailsModal'
import { PolicyTermActionsMenu } from '../components/policies/PolicyTermActionsMenu'
import { RewritePolicyModal } from '../components/policies/RewritePolicyModal'
import { AddTransactionModal } from '../components/transactions/AddTransactionModal'
import { SearchInput } from '../components/ui/SearchInput'
import { ExportMenu } from '../components/ui/ExportMenu'
import { SortableTh } from '../components/ui/SortableTh'
import { useAuth } from '../lib/auth'
import { fetchPolicyTermTxnRows } from '../lib/commission'
import { policyExportColumns } from '../lib/exportDefinitions'
import {
  includePolicyInCurrentPremiumTotals,
  listPolicyFileTerms,
  policyTermCreateAnchor,
  policyTermPath,
  rewrittenPredecessorIds,
  type PolicyTermCreateAnchor,
} from '../lib/policyPremium'
import { downloadTableExport } from '../lib/tableExport'
import {
  CREATED_AT_DESC,
  nextTableSort,
  sortRows,
  type TableSortState,
} from '../lib/tableSort'
import {
  canManagePolicies,
  canManageTransactions,
  canRepairHistoricalPolicyTerm,
  isProducerBookScoped,
  producerKeysMatch,
  resolveProducerBookName,
  roleInputFromProfile,
} from '../lib/permissions'
import { supabase } from '../lib/supabase'

type PolicyStatus = 'active' | 'pending' | 'expired' | 'cancelled' | 'renewal_due'

interface PolicyRow {
  id: string
  termId: string
  rowKey: string
  isCurrent: boolean
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
  /** On-screen premium for THIS term only. */
  premium: number
  /** Raw policies.premium (opening / stored reference). */
  filePremium: number
  agencyCommissionPercentage: number | null
  status: PolicyStatus
  createdAt: string
  transactionCount: number
  termAnchor: PolicyTermCreateAnchor
  rewrittenFromPolicyId: string | null
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
  const canAddTxn = canManageTransactions(roleInput)
  const canRepairTerm = canRepairHistoricalPolicyTerm(roleInput)
  const canRenewRewrite = canAdd && canAddTxn
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
  const [renewTarget, setRenewTarget] = useState<PolicyRow | null>(null)
  const [rewriteTarget, setRewriteTarget] = useState<PolicyRow | null>(null)
  const [txnTermTarget, setTxnTermTarget] = useState<PolicyRow | null>(null)
  const [editTermTarget, setEditTermTarget] = useState<PolicyRow | null>(null)
  const [page, setPage] = useState(1)
  const [policySort, setPolicySort] = useState<
    TableSortState<
      | 'clientName'
      | 'policyNumber'
      | 'policyType'
      | 'carrier'
      | 'effectiveDate'
      | 'expirationDate'
      | 'producer'
      | 'csr'
      | 'premium'
      | 'status'
      | 'createdAt'
    >
  >(CREATED_AT_DESC)

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
        agency_commission_percentage,
        status,
        created_at,
        rewritten_from_policy_id,
        clients!policies_client_id_fkey ( business_name )
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

    const mappedBase = (data ?? []).map((row) => {
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients
      return {
        id: String(row.id),
        termId: 'current',
        rowKey: `${row.id}:current`,
        isCurrent: true,
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
        premium: 0,
        filePremium: (() => {
          if (row.premium == null || row.premium === '') return 0
          const n = Number(row.premium)
          return Number.isFinite(n) ? n : 0
        })(),
        agencyCommissionPercentage: (() => {
          if (row.agency_commission_percentage == null || row.agency_commission_percentage === '') return null
          const n = Number(row.agency_commission_percentage)
          return Number.isFinite(n) ? n : null
        })(),
        status: normalizeStatus(row.status as string | null),
        createdAt: String(row.created_at ?? ''),
        rewrittenFromPolicyId: String(row.rewritten_from_policy_id ?? '').trim() || null,
        transactionCount: 0,
        termAnchor: {
          termId: 'current',
          isCurrent: true,
          policyNumber: String(row.policy_number ?? '').trim(),
          effectiveDate: String(row.effective_date ?? ''),
          expirationDate: String(row.expiration_date ?? ''),
          producer: String(row.producer ?? '').trim(),
          csr: String(row.csr ?? '').trim(),
          carrier: String(row.carrier ?? '').trim(),
          mga: String(row.mga ?? '').trim(),
          commissionType: null,
          agencyCommissionPercentage: null,
          agencyCommissionAmount: 0,
          brokerFee: 0,
          producerSplitPercentage: null,
        },
      }
    })

    const termTxnRes = await fetchPolicyTermTxnRows(mappedBase.map((p) => p.id))
    if (termTxnRes.error) {
      setPolicies([])
      setFetchError(termTxnRes.error.message)
      setLoading(false)
      return
    }

    const mapped = mappedBase.flatMap((policy) => {
      const terms = listPolicyFileTerms(termTxnRes.data[policy.id] ?? [], {
        policyNumber: policy.policyNumber,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        producer: policy.producer,
        csr: policy.csr,
        carrier: policy.carrier,
        mga: policy.mga,
        premium: policy.filePremium,
      })
      return terms.map((term) => ({
        ...policy,
        termId: term.termId,
        rowKey: `${policy.id}:${term.termId}`,
        isCurrent: term.isCurrent,
        policyNumber: term.policyNumber,
        carrier: term.carrier,
        mga: term.mga,
        producer: term.producer,
        csr: term.csr,
        effectiveDate: term.effectiveDate,
        expirationDate: term.expirationDate,
        premium: term.displayedPremium,
        status: term.isCurrent
          ? policy.status
          : policy.status === 'cancelled'
            ? 'cancelled'
            : 'expired',
        transactionCount: term.transactionIds.length,
        termAnchor: policyTermCreateAnchor(term),
      }))
    })

    if (isProducerBookScoped(roleInput)) {
      const names = [...new Set(mapped.map((p) => p.producer).filter((p) => p && p !== '—'))]
      const scope = resolveProducerBookName(roleInput, profile?.fullName, names, {
        linkedProducerName: profile?.linkedProducerName,
      })
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
  }, [roleInput, profile?.fullName, profile?.linkedProducerName])

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
    policySort,
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
    const replacedIds = rewrittenPredecessorIds(policies)
    const currentTerms = policies.filter(
      (p) => p.isCurrent && includePolicyInCurrentPremiumTotals(p.id, replacedIds),
    )
    const active = currentTerms.filter((p) => p.status === 'active').length
    const renewalsDue = currentTerms.filter(
      (p) => p.status === 'renewal_due' || (p.status === 'active' && isRenewalDueWithin90Days(p.expirationDate)),
    ).length
    return {
      total: policies.length,
      active,
      renewalsDue,
      totalPremium: currentTerms.reduce((sum, p) => sum + p.premium, 0),
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

  const sorted = useMemo(
    () =>
      sortRows(
        filtered,
        policySort,
        {
          clientName: (p) => p.clientName,
          policyNumber: (p) => p.policyNumber,
          policyType: (p) => p.policyType,
          carrier: (p) => p.carrier,
          effectiveDate: (p) => p.effectiveDate,
          expirationDate: (p) => p.expirationDate,
          producer: (p) => p.producer,
          csr: (p) => p.csr,
          premium: (p) => p.premium,
          status: (p) => p.status,
          createdAt: (p) => p.createdAt,
        },
        {
          effectiveDate: 'date',
          expirationDate: 'date',
          premium: 'number',
          createdAt: 'date',
        },
      ),
    [filtered, policySort],
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

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

        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu
            rowCount={filtered.length}
            disabled={loading}
            onExport={(format) =>
              downloadTableExport({
                format,
                sheetName: 'Policies',
                columns: policyExportColumns,
                rows: filtered,
                filenameBase: 'Policies',
                label: 'policies',
              })
            }
          />
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Policy Terms" value={String(summary.total)} icon={FileText} tone="blue" />
        <Kpi label="Active Current Terms" value={String(summary.active)} icon={ShieldCheck} tone="emerald" />
        <Kpi label="Renewals Due in 90 Days" value={String(summary.renewalsDue)} icon={CalendarClock} tone="amber" />
        <Kpi label="Current Policy Premium" value={formatCurrency(summary.totalPremium)} icon={DollarSign} tone="teal" />
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
                {[
                  ['clientName', 'Client'],
                  ['policyNumber', 'Policy Number'],
                  ['policyType', 'Type'],
                  ['carrier', 'Carrier / MGA'],
                  ['effectiveDate', 'Effective'],
                  ['expirationDate', 'Expiration'],
                  ['producer', 'Producer'],
                  ['csr', 'CSR'],
                  ['premium', 'Current Policy Premium'],
                  ['status', 'Status'],
                ].map(([key, col]) => (
                  <SortableTh
                    key={key}
                    className="px-4"
                    align={key === 'premium' ? 'right' : 'left'}
                    active={policySort.key === key}
                    direction={policySort.direction}
                    onSort={() =>
                      setPolicySort((s) =>
                        nextTableSort(
                          s,
                          key as typeof policySort.key,
                        ),
                      )
                    }
                  >
                    {col}
                  </SortableTh>
                ))}
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Transactions
                </th>
                <th className="w-px px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-500">Loading policies…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-500">No policies found</td></tr>
              ) : (
                paginated.map((policy) => (
                  <tr key={policy.rowKey} className="hover:bg-slate-50/70">
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
                      <Link to={policyTermPath(policy.id, policy.termId)} className="font-medium text-alza-blue-700 hover:text-alza-blue-800">
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
                    <td className="px-4 py-3 text-sm tabular-nums text-slate-700">{policy.transactionCount}</td>
                    <td className="w-px px-2 py-3">
                      <PolicyTermActionsMenu
                        policyNumber={policy.policyNumber}
                        canView
                        canAddTransaction={canAddTxn}
                        canEditTermDetails={canRepairTerm && !policy.isCurrent}
                        canRenew={canAddTxn && policy.isCurrent}
                        canRewrite={canRenewRewrite && policy.isCurrent}
                        onView={() => navigate(policyTermPath(policy.id, policy.termId))}
                        onAddTransaction={() => setTxnTermTarget(policy)}
                        onEditTermDetails={() => setEditTermTarget(policy)}
                        onRenew={() => setRenewTarget(policy)}
                        onRewrite={() => setRewriteTarget(policy)}
                      />
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
      <AddTransactionModal
        open={Boolean(txnTermTarget)}
        onClose={() => setTxnTermTarget(null)}
        lockedClientId={txnTermTarget?.clientId || undefined}
        lockedClientLabel={txnTermTarget?.clientName}
        lockedPolicyId={txnTermTarget?.id}
        lockedPolicyLabel={txnTermTarget?.policyNumber}
        termAnchor={txnTermTarget?.termAnchor ?? null}
        onCreated={async () => {
          setTxnTermTarget(null)
          setActionSuccess('Transaction created.')
          await loadPolicies()
        }}
      />
      <EditTermDetailsModal
        open={Boolean(editTermTarget)}
        onClose={() => setEditTermTarget(null)}
        policyId={editTermTarget?.id ?? ''}
        termId={editTermTarget?.termId ?? ''}
        initialPolicyNumber={editTermTarget?.policyNumber}
        initialEffectiveDate={editTermTarget?.effectiveDate}
        initialExpirationDate={editTermTarget?.expirationDate}
        onSaved={async (updatedCount) => {
          setEditTermTarget(null)
          setActionSuccess(
            updatedCount > 0
              ? `Term details saved. Updated ${updatedCount} transaction snapshot${updatedCount === 1 ? '' : 's'} on this term only.`
              : 'Term details already matched these snapshots. Nothing was overwritten.',
          )
          await loadPolicies()
        }}
      />
      <AddTransactionModal
        open={Boolean(renewTarget)}
        mode="renew"
        onClose={() => setRenewTarget(null)}
        lockedClientId={renewTarget?.clientId || undefined}
        lockedClientLabel={renewTarget?.clientName}
        lockedPolicyId={renewTarget?.id}
        lockedPolicyLabel={renewTarget?.policyNumber}
        onCreated={async () => {
          const policyId = renewTarget?.id
          setRenewTarget(null)
          setActionSuccess('Renewal saved. The new term is now a separate policy-term entry.')
          await loadPolicies()
          if (policyId) navigate(`/policies/${policyId}`)
        }}
      />
      <RewritePolicyModal
        open={Boolean(rewriteTarget)}
        sourcePolicyId={rewriteTarget?.id ?? ''}
        onClose={() => setRewriteTarget(null)}
        onCreated={(policyId) => {
          setRewriteTarget(null)
          setActionSuccess('Rewritten policy created.')
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
