import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Plus,
  Search,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'

type ProducerStatus = 'active' | 'inactive'

interface Producer {
  id: number
  name: string
  email: string
  phone: string
  commissionSplit: string
  activeClients: number
  activePolicies: number
  writtenPremium: number
  commissionDue: number
  status: ProducerStatus
}

const producers: Producer[] = [
  {
    id: 1,
    name: 'Michael Johnson',
    email: 'mjohnson@alzaflow.com',
    phone: '(555) 301-4401',
    commissionSplit: '50%',
    activeClients: 4,
    activePolicies: 9,
    writtenPremium: 148900,
    commissionDue: 18612,
    status: 'active',
  },
  {
    id: 2,
    name: 'Sarah Wilson',
    email: 'swilson@alzaflow.com',
    phone: '(555) 301-4402',
    commissionSplit: '45%',
    activeClients: 5,
    activePolicies: 8,
    writtenPremium: 121800,
    commissionDue: 13702,
    status: 'active',
  },
  {
    id: 3,
    name: 'James Carter',
    email: 'jcarter@alzaflow.com',
    phone: '(555) 301-4403',
    commissionSplit: '40%',
    activeClients: 3,
    activePolicies: 5,
    writtenPremium: 68600,
    commissionDue: 8240,
    status: 'active',
  },
  {
    id: 4,
    name: 'Emily Rodriguez',
    email: 'erodriguez@alzaflow.com',
    phone: '(555) 301-4404',
    commissionSplit: '35%',
    activeClients: 2,
    activePolicies: 4,
    writtenPremium: 52400,
    commissionDue: 4585,
    status: 'active',
  },
  {
    id: 5,
    name: 'David Park',
    email: 'dpark@alzaflow.com',
    phone: '(555) 301-4405',
    commissionSplit: '30%',
    activeClients: 2,
    activePolicies: 3,
    writtenPremium: 38200,
    commissionDue: 2865,
    status: 'active',
  },
  {
    id: 6,
    name: 'Rachel Thompson',
    email: 'rthompson@alzaflow.com',
    phone: '(555) 301-4406',
    commissionSplit: '25%',
    activeClients: 1,
    activePolicies: 2,
    writtenPremium: 21400,
    commissionDue: 1284,
    status: 'active',
  },
  {
    id: 7,
    name: 'Marcus Bennett',
    email: 'mbennett@alzaflow.com',
    phone: '(555) 301-4407',
    commissionSplit: '20%',
    activeClients: 0,
    activePolicies: 0,
    writtenPremium: 0,
    commissionDue: 0,
    status: 'inactive',
  },
  {
    id: 8,
    name: 'Laura Mitchell',
    email: 'lmitchell@alzaflow.com',
    phone: '(555) 301-4408',
    commissionSplit: '15%',
    activeClients: 1,
    activePolicies: 1,
    writtenPremium: 9600,
    commissionDue: 432,
    status: 'active',
  },
  {
    id: 9,
    name: 'Anthony Reyes',
    email: 'areyes@alzaflow.com',
    phone: '(555) 301-4409',
    commissionSplit: '10%',
    activeClients: 0,
    activePolicies: 0,
    writtenPremium: 8500,
    commissionDue: 0,
    status: 'inactive',
  },
]

const PAGE_SIZE = 5

const statusLabels: Record<ProducerStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const statusStyles: Record<ProducerStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function matchesProducerSearch(producer: Producer, query: string): boolean {
  if (!query) return true

  return (
    producer.name.toLowerCase().includes(query) ||
    producer.email.toLowerCase().includes(query) ||
    producer.phone.includes(query) ||
    statusLabels[producer.status].toLowerCase().includes(query)
  )
}

export function Producers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    setPage(1)
  }, [search])

  const filteredProducers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return producers
    return producers.filter((producer) => matchesProducerSearch(producer, query))
  }, [search])

  const summary = useMemo(() => {
    const activeCount = producers.filter((p) => p.status === 'active').length
    const totalPremium = producers.reduce((sum, p) => sum + p.writtenPremium, 0)
    const totalCommissionDue = producers.reduce((sum, p) => sum + p.commissionDue, 0)

    return {
      total: producers.length,
      active: activeCount,
      totalPremium,
      totalCommissionDue,
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(filteredProducers.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedProducers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredProducers.slice(start, start + PAGE_SIZE)
  }, [filteredProducers, currentPage])

  const rangeStart =
    filteredProducers.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredProducers.length)

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

  function handleRowClick(producer: Producer) {
    setSelectedId(producer.id)
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.currentTarget.value)}
            onSearch={(e) => handleSearchChange(e.currentTarget.value)}
            placeholder="Search producers by name, email, phone, or status..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add Producer
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Producers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <UserCog className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Active Producers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.active}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Users className="h-5 w-5 text-emerald-600" />
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

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Producer Commission Due</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatCurrency(summary.totalCommissionDue)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
              <Wallet className="h-5 w-5 text-violet-600" />
            </div>
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
                  Producer Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Commission Split
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Active Clients
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Active Policies
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Written Premium
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Commission Due
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedProducers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <Search className="h-5 w-5 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">No producers found</p>
                      <p className="text-sm text-slate-500">
                        Try adjusting your search terms or add a new producer.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedProducers.map((producer) => (
                  <tr
                    key={producer.id}
                    onClick={() => handleRowClick(producer)}
                    className={`cursor-pointer transition-colors hover:bg-alza-blue-50/60 ${
                      selectedId === producer.id ? 'bg-alza-blue-50' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="text-sm font-medium text-slate-900">{producer.name}</p>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {producer.email}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {producer.phone}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-alza-blue-700">
                      {producer.commissionSplit}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {producer.activeClients}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {producer.activePolicies}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(producer.writtenPremium)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(producer.commissionDue)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[producer.status]}`}
                      >
                        {statusLabels[producer.status]}
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
            <span className="font-medium text-slate-900">{filteredProducers.length}</span>{' '}
            producers
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
