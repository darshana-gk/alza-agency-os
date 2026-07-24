import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Headphones,
  Plus,
  Search,
  Users,
} from 'lucide-react'

type CSRStatus = 'active' | 'inactive'

interface CSR {
  id: number
  name: string
  email: string
  phone: string
  assignedClients: number
  assignedPolicies: number
  renewalsDue: number
  openTasks: number
  status: CSRStatus
}

const csrs: CSR[] = [
  {
    id: 1,
    name: 'Emily Nguyen',
    email: 'enguyen@alzaflow.com',
    phone: '(555) 401-5501',
    assignedClients: 5,
    assignedPolicies: 12,
    renewalsDue: 4,
    openTasks: 3,
    status: 'active',
  },
  {
    id: 2,
    name: 'David Ortiz',
    email: 'dortiz@alzaflow.com',
    phone: '(555) 401-5502',
    assignedClients: 4,
    assignedPolicies: 9,
    renewalsDue: 2,
    openTasks: 5,
    status: 'active',
  },
  {
    id: 3,
    name: 'Rachel Kim',
    email: 'rkim@alzaflow.com',
    phone: '(555) 401-5503',
    assignedClients: 4,
    assignedPolicies: 8,
    renewalsDue: 3,
    openTasks: 2,
    status: 'active',
  },
  {
    id: 4,
    name: 'Jessica Morales',
    email: 'jmorales@alzaflow.com',
    phone: '(555) 401-5504',
    assignedClients: 3,
    assignedPolicies: 7,
    renewalsDue: 1,
    openTasks: 4,
    status: 'active',
  },
  {
    id: 5,
    name: 'Brian Foster',
    email: 'bfoster@alzaflow.com',
    phone: '(555) 401-5505',
    assignedClients: 3,
    assignedPolicies: 6,
    renewalsDue: 2,
    openTasks: 1,
    status: 'active',
  },
  {
    id: 6,
    name: 'Angela Brooks',
    email: 'abrooks@alzaflow.com',
    phone: '(555) 401-5506',
    assignedClients: 2,
    assignedPolicies: 4,
    renewalsDue: 0,
    openTasks: 2,
    status: 'active',
  },
  {
    id: 7,
    name: 'Chris Dalton',
    email: 'cdalton@alzaflow.com',
    phone: '(555) 401-5507',
    assignedClients: 2,
    assignedPolicies: 3,
    renewalsDue: 1,
    openTasks: 0,
    status: 'active',
  },
  {
    id: 8,
    name: 'Monica Patel',
    email: 'mpatel@alzaflow.com',
    phone: '(555) 401-5508',
    assignedClients: 0,
    assignedPolicies: 0,
    renewalsDue: 0,
    openTasks: 0,
    status: 'inactive',
  },
  {
    id: 9,
    name: 'Tyler Hughes',
    email: 'thughes@alzaflow.com',
    phone: '(555) 401-5509',
    assignedClients: 1,
    assignedPolicies: 1,
    renewalsDue: 0,
    openTasks: 1,
    status: 'inactive',
  },
]

const PAGE_SIZE = 5

const statusLabels: Record<CSRStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const statusStyles: Record<CSRStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

function matchesCSRSearch(csr: CSR, query: string): boolean {
  if (!query) return true

  return (
    csr.name.toLowerCase().includes(query) ||
    csr.email.toLowerCase().includes(query) ||
    csr.phone.includes(query) ||
    statusLabels[csr.status].toLowerCase().includes(query)
  )
}

export function CSRs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    setPage(1)
  }, [search])

  const filteredCSRs = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return csrs
    return csrs.filter((csr) => matchesCSRSearch(csr, query))
  }, [search])

  const summary = useMemo(() => {
    const activeCount = csrs.filter((c) => c.status === 'active').length
    const totalClients = csrs.reduce((sum, c) => sum + c.assignedClients, 0)
    const totalPolicies = csrs.reduce((sum, c) => sum + c.assignedPolicies, 0)
    const totalRenewalsDue = csrs.reduce((sum, c) => sum + c.renewalsDue, 0)

    return {
      total: csrs.length,
      active: activeCount,
      totalClients,
      totalPolicies,
      totalRenewalsDue,
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(filteredCSRs.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedCSRs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredCSRs.slice(start, start + PAGE_SIZE)
  }, [filteredCSRs, currentPage])

  const rangeStart =
    filteredCSRs.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredCSRs.length)

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

  function handleRowClick(csr: CSR) {
    setSelectedId(csr.id)
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
            placeholder="Search CSRs by name, email, phone, or status..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add CSR
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total CSRs</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <Headphones className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Active CSRs</p>
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
              <p className="text-sm font-medium text-slate-500">Total Assigned Clients</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalClients}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-teal-50">
              <Users className="h-5 w-5 text-alza-teal-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Assigned Policies</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalPolicies}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
              <FileText className="h-5 w-5 text-violet-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Renewals Due in 90 Days</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalRenewalsDue}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
              <CalendarClock className="h-5 w-5 text-orange-600" />
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
                  CSR Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Assigned Clients
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Assigned Policies
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Renewals Due
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Open Tasks
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedCSRs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <Search className="h-5 w-5 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">No CSRs found</p>
                      <p className="text-sm text-slate-500">
                        Try adjusting your search terms or add a new CSR.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedCSRs.map((csr) => (
                  <tr
                    key={csr.id}
                    onClick={() => handleRowClick(csr)}
                    className={`cursor-pointer transition-colors hover:bg-alza-blue-50/60 ${
                      selectedId === csr.id ? 'bg-alza-blue-50' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="text-sm font-medium text-slate-900">{csr.name}</p>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {csr.email}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {csr.phone}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {csr.assignedClients}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {csr.assignedPolicies}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {csr.renewalsDue}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span className="inline-flex items-center gap-1 text-sm text-slate-700">
                        <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
                        {csr.openTasks}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[csr.status]}`}
                      >
                        {statusLabels[csr.status]}
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
            <span className="font-medium text-slate-900">{filteredCSRs.length}</span>{' '}
            CSRs
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
