import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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

type PolicyStatus = 'active' | 'pending' | 'expired' | 'cancelled' | 'renewal_due'

type PolicyType =
  | 'Commercial General Liability'
  | 'Commercial Auto'
  | 'Workers Compensation'
  | 'Commercial Property'
  | 'Umbrella'
  | 'Professional Liability'
  | 'Business Owners Policy'
  | 'Inland Marine'

interface Policy {
  id: number
  clientName: string
  policyNumber: string
  policyType: PolicyType
  carrier: string
  mga: string
  effectiveDate: string
  expirationDate: string
  producer: string
  csr: string
  premium: number
  status: PolicyStatus
}

const policies: Policy[] = [
  {
    id: 1,
    clientName: 'ABC Construction LLC',
    policyNumber: 'CGL-2026-004821',
    policyType: 'Commercial General Liability',
    carrier: 'Hartford',
    mga: 'AmWINS Brokerage',
    effectiveDate: '2026-01-15',
    expirationDate: '2027-01-15',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    premium: 18500,
    status: 'active',
  },
  {
    id: 2,
    clientName: 'Sunrise Roofing Inc',
    policyNumber: 'WC-2026-009134',
    policyType: 'Workers Compensation',
    carrier: 'Travelers',
    mga: 'RT Specialty',
    effectiveDate: '2026-03-01',
    expirationDate: '2027-03-01',
    producer: 'Sarah Wilson',
    csr: 'David Ortiz',
    premium: 22400,
    status: 'active',
  },
  {
    id: 3,
    clientName: 'Metro Auto Group LLC',
    policyNumber: 'CA-2025-112907',
    policyType: 'Commercial Auto',
    carrier: 'Liberty Mutual',
    mga: 'CRC Group',
    effectiveDate: '2025-08-01',
    expirationDate: '2026-08-01',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    premium: 34200,
    status: 'renewal_due',
  },
  {
    id: 4,
    clientName: 'Coastal Marine Services',
    policyNumber: 'GL-2026-003512',
    policyType: 'Commercial General Liability',
    carrier: 'Chubb',
    mga: 'AmWINS Brokerage',
    effectiveDate: '2026-06-01',
    expirationDate: '2027-06-01',
    producer: 'Sarah Wilson',
    csr: 'Rachel Kim',
    premium: 12400,
    status: 'pending',
  },
  {
    id: 5,
    clientName: 'Sunrise Properties Inc',
    policyNumber: 'CP-2026-007845',
    policyType: 'Commercial Property',
    carrier: 'CNA',
    mga: 'Burns & Wilcox',
    effectiveDate: '2026-02-10',
    expirationDate: '2027-02-10',
    producer: 'James Carter',
    csr: 'David Ortiz',
    premium: 28900,
    status: 'active',
  },
  {
    id: 6,
    clientName: 'Westside Retail Group',
    policyNumber: 'BOP-2024-005621',
    policyType: 'Business Owners Policy',
    carrier: 'Nationwide',
    mga: 'RT Specialty',
    effectiveDate: '2024-11-01',
    expirationDate: '2025-11-01',
    producer: 'Sarah Wilson',
    csr: 'Rachel Kim',
    premium: 9800,
    status: 'expired',
  },
  {
    id: 7,
    clientName: 'Johnson Family Trust',
    policyNumber: 'UMB-2026-001203',
    policyType: 'Umbrella',
    carrier: 'Travelers',
    mga: 'AmWINS Brokerage',
    effectiveDate: '2026-04-15',
    expirationDate: '2027-04-15',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    premium: 7600,
    status: 'active',
  },
  {
    id: 8,
    clientName: 'Harbor Medical Group',
    policyNumber: 'PL-2025-008441',
    policyType: 'Professional Liability',
    carrier: 'Hiscox',
    mga: 'CRC Group',
    effectiveDate: '2025-09-01',
    expirationDate: '2026-09-01',
    producer: 'Sarah Wilson',
    csr: 'David Ortiz',
    premium: 15600,
    status: 'renewal_due',
  },
  {
    id: 9,
    clientName: 'Summit Tech Solutions',
    policyNumber: 'CY-2026-002118',
    policyType: 'Professional Liability',
    carrier: 'Beazley',
    mga: 'Burns & Wilcox',
    effectiveDate: '2026-05-20',
    expirationDate: '2027-05-20',
    producer: 'James Carter',
    csr: 'Rachel Kim',
    premium: 6450,
    status: 'pending',
  },
  {
    id: 10,
    clientName: 'Green Valley Farms',
    policyNumber: 'IM-2026-006732',
    policyType: 'Inland Marine',
    carrier: 'Zurich',
    mga: 'RT Specialty',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    premium: 11200,
    status: 'active',
  },
  {
    id: 11,
    clientName: 'Urban Fitness Studios',
    policyNumber: 'GL-2025-004998',
    policyType: 'Commercial General Liability',
    carrier: 'Markel',
    mga: 'AmWINS Brokerage',
    effectiveDate: '2025-07-15',
    expirationDate: '2026-07-15',
    producer: 'Sarah Wilson',
    csr: 'David Ortiz',
    premium: 4900,
    status: 'cancelled',
  },
  {
    id: 12,
    clientName: 'Peak Logistics Corp',
    policyNumber: 'CA-2026-010556',
    policyType: 'Commercial Auto',
    carrier: 'Progressive Commercial',
    mga: 'CRC Group',
    effectiveDate: '2026-06-10',
    expirationDate: '2026-09-10',
    producer: 'James Carter',
    csr: 'Rachel Kim',
    premium: 47800,
    status: 'renewal_due',
  },
  {
    id: 13,
    clientName: 'ABC Construction LLC',
    policyNumber: 'WC-2026-004822',
    policyType: 'Workers Compensation',
    carrier: 'Employers',
    mga: 'Burns & Wilcox',
    effectiveDate: '2026-01-15',
    expirationDate: '2027-01-15',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    premium: 24000,
    status: 'active',
  },
]

const PAGE_SIZE = 5
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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isRenewalDueWithin90Days(expirationDate: string): boolean {
  const today = new Date('2026-07-22T00:00:00')
  const expiration = new Date(`${expirationDate}T00:00:00`)
  const diffMs = expiration.getTime() - today.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 90
}

function matchesPolicySearch(policy: Policy, query: string): boolean {
  if (!query) return true

  const searchableFields = [
    policy.clientName,
    policy.policyNumber,
    policy.policyType,
    policy.carrier,
    policy.mga,
    policy.producer,
    policy.csr,
    statusLabels[policy.status],
  ]

  return searchableFields.some((field) =>
    field.toLowerCase().includes(query),
  )
}

const policyTypes = [...new Set(policies.map((p) => p.policyType))].sort()
const carriers = [...new Set(policies.map((p) => p.carrier))].sort()
const producers = [...new Set(policies.map((p) => p.producer))].sort()

export function PolicyFiles() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const [statusFilter, setStatusFilter] = useState<string>(ALL)
  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [carrierFilter, setCarrierFilter] = useState<string>(ALL)
  const [producerFilter, setProducerFilter] = useState<string>(ALL)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    setPage(1)
  }, [search])

  const searchQuery = search.trim().toLowerCase()

  const searchFilteredPolicies = useMemo(() => {
    if (!searchQuery) return policies
    return policies.filter((policy) => matchesPolicySearch(policy, searchQuery))
  }, [searchQuery])

  const filteredPolicies = useMemo(() => {
    return searchFilteredPolicies.filter((policy) => {
      const matchesStatus =
        statusFilter === ALL || policy.status === statusFilter

      const matchesType =
        typeFilter === ALL || policy.policyType === typeFilter

      const matchesCarrier =
        carrierFilter === ALL || policy.carrier === carrierFilter

      const matchesProducer =
        producerFilter === ALL || policy.producer === producerFilter

      return matchesStatus && matchesType && matchesCarrier && matchesProducer
    })
  }, [searchFilteredPolicies, statusFilter, typeFilter, carrierFilter, producerFilter])

  const summary = useMemo(() => {
    const activeCount = policies.filter((p) => p.status === 'active').length
    const renewalsDue = policies.filter(
      (p) =>
        p.status === 'renewal_due' ||
        (p.status === 'active' && isRenewalDueWithin90Days(p.expirationDate)),
    ).length
    const totalPremium = policies.reduce((sum, p) => sum + p.premium, 0)

    return {
      total: policies.length,
      active: activeCount,
      renewalsDue,
      totalPremium,
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(filteredPolicies.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedPolicies = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredPolicies.slice(start, start + PAGE_SIZE)
  }, [filteredPolicies, currentPage])

  const rangeStart =
    filteredPolicies.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredPolicies.length)

  function handleSearchChange(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)

        if (value.trim()) {
          next.set('search', value)
        } else {
          next.delete('search')
        }

        return next
      },
      { replace: true },
    )
    setPage(1)
  }

  function handleFilterChange(
    setter: (value: string) => void,
    value: string,
  ) {
    setter(value)
    setPage(1)
  }

  function handleRowClick(policy: Policy) {
    setSelectedId(policy.id)
  }

  const selectClassName =
    'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.currentTarget.value)}
            onSearch={(e) => handleSearchChange(e.currentTarget.value)}
            placeholder="Search by client, policy #, carrier, MGA, producer, CSR, or type..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add Policy
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Policies</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <FileText className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Active Policies</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.active}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Renewals Due in 90 Days</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.renewalsDue}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
              <CalendarClock className="h-5 w-5 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Written Premium</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatCurrency(summary.totalPremium)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-teal-50">
              <DollarSign className="h-5 w-5 text-alza-teal-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="status-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              Policy Status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => handleFilterChange(setStatusFilter, e.target.value)}
              className={`${selectClassName} w-full`}
            >
              <option value={ALL}>All Statuses</option>
              {(Object.keys(statusLabels) as PolicyStatus[]).map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="type-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              Policy Type
            </label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => handleFilterChange(setTypeFilter, e.target.value)}
              className={`${selectClassName} w-full`}
            >
              <option value={ALL}>All Types</option>
              {policyTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="carrier-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              Carrier
            </label>
            <select
              id="carrier-filter"
              value={carrierFilter}
              onChange={(e) => handleFilterChange(setCarrierFilter, e.target.value)}
              className={`${selectClassName} w-full`}
            >
              <option value={ALL}>All Carriers</option>
              {carriers.map((carrier) => (
                <option key={carrier} value={carrier}>
                  {carrier}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="producer-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              Producer
            </label>
            <select
              id="producer-filter"
              value={producerFilter}
              onChange={(e) => handleFilterChange(setProducerFilter, e.target.value)}
              className={`${selectClassName} w-full`}
            >
              <option value={ALL}>All Producers</option>
              {producers.map((producer) => (
                <option key={producer} value={producer}>
                  {producer}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Policy Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Policy Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Carrier / MGA
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Effective Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Expiration Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Producer
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  CSR
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Premium
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedPolicies.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <SearchIcon className="h-5 w-5 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">No policies found</p>
                      <p className="text-sm text-slate-500">
                        Try adjusting your search or filters, or add a new policy.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedPolicies.map((policy) => (
                  <tr
                    key={policy.id}
                    onClick={() => handleRowClick(policy)}
                    className={`cursor-pointer transition-colors hover:bg-alza-blue-50/60 ${
                      selectedId === policy.id ? 'bg-alza-blue-50' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="text-sm font-medium text-slate-900">{policy.clientName}</p>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="text-sm font-medium text-alza-blue-700">{policy.policyNumber}</p>
                    </td>

                    <td className="px-4 py-4">
                      <p className="text-sm text-slate-700">{policy.policyType}</p>
                    </td>

                    <td className="px-4 py-4">
                      <p className="text-sm text-slate-900">{policy.carrier}</p>
                      <p className="text-xs text-slate-500">{policy.mga}</p>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {formatDate(policy.effectiveDate)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {formatDate(policy.expirationDate)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {policy.producer}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {policy.csr}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(policy.premium)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[policy.status]}`}
                      >
                        {statusLabels[policy.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Showing{' '}
            <span className="font-medium text-slate-900">
              {rangeStart}–{rangeEnd}
            </span>{' '}
            of{' '}
            <span className="font-medium text-slate-900">{filteredPolicies.length}</span>{' '}
            policies
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setPage(pageNum)}
                  className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition-colors ${
                    pageNum === currentPage
                      ? 'gradient-alza text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {pageNum}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
