import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileText,
  MapPin,
  Plus,
  Search,
  Truck,
} from 'lucide-react'

type MGAStatus = 'active' | 'inactive' | 'pending'

interface MGA {
  id: number
  name: string
  contactPerson: string
  email: string
  phone: string
  states: string
  linesOfBusiness: string
  carriersRepresented: number
  activePolicies: number
  writtenPremium: number
  status: MGAStatus
}

const mgas: MGA[] = [
  {
    id: 1,
    name: 'AmWINS Brokerage',
    contactPerson: 'Jennifer Walsh',
    email: 'jwalsh@amwins.com',
    phone: '(555) 501-6101',
    states: 'TX, FL, AZ, CO, GA',
    linesOfBusiness: 'Commercial Package, GL, Property, Umbrella',
    carriersRepresented: 14,
    activePolicies: 28,
    writtenPremium: 486200,
    status: 'active',
  },
  {
    id: 2,
    name: 'RT Specialty',
    contactPerson: 'Mark Stevens',
    email: 'mstevens@rtspecialty.com',
    phone: '(555) 501-6102',
    states: 'TX, CA, NY, IL, PA',
    linesOfBusiness: 'Workers Comp, Commercial Auto, BOP',
    carriersRepresented: 11,
    activePolicies: 22,
    writtenPremium: 312400,
    status: 'active',
  },
  {
    id: 3,
    name: 'CRC Group',
    contactPerson: 'Lisa Hammond',
    email: 'lhammond@crcgroup.com',
    phone: '(555) 501-6103',
    states: 'TX, FL, LA, OK, NM',
    linesOfBusiness: 'Commercial Auto, Inland Marine, GL',
    carriersRepresented: 9,
    activePolicies: 18,
    writtenPremium: 278900,
    status: 'active',
  },
  {
    id: 4,
    name: 'Burns & Wilcox',
    contactPerson: 'Robert Chen',
    email: 'rchen@burnsandwilcox.com',
    phone: '(555) 501-6104',
    states: 'TX, CA, MI, OH, NC',
    linesOfBusiness: 'Professional Liability, Property, WC',
    carriersRepresented: 10,
    activePolicies: 16,
    writtenPremium: 245600,
    status: 'active',
  },
  {
    id: 5,
    name: 'Keystone Underwriting',
    contactPerson: 'Amanda Reyes',
    email: 'areyes@keystoneuw.com',
    phone: '(555) 501-6105',
    states: 'TX, FL, SC, TN, VA',
    linesOfBusiness: 'General Liability, Umbrella, Cyber',
    carriersRepresented: 6,
    activePolicies: 11,
    writtenPremium: 156800,
    status: 'active',
  },
  {
    id: 6,
    name: 'Southwest E&S Partners',
    contactPerson: 'David Ortiz',
    email: 'dortiz@swespartners.com',
    phone: '(555) 501-6106',
    states: 'TX, AZ, NV, CO',
    linesOfBusiness: 'E&S Property, GL, Contractors',
    carriersRepresented: 5,
    activePolicies: 9,
    writtenPremium: 124500,
    status: 'active',
  },
  {
    id: 7,
    name: 'Atlantic MGA Solutions',
    contactPerson: 'Patricia Moore',
    email: 'pmoore@atlanticmga.com',
    phone: '(555) 501-6107',
    states: 'FL, GA, SC, NC, VA',
    linesOfBusiness: 'Commercial Property, BOP, Flood',
    carriersRepresented: 4,
    activePolicies: 0,
    writtenPremium: 0,
    status: 'pending',
  },
  {
    id: 8,
    name: 'Midwest Program Administrators',
    contactPerson: 'James Carter',
    email: 'jcarter@midwestpa.com',
    phone: '(555) 501-6108',
    states: 'IL, IN, WI, MN, MO',
    linesOfBusiness: 'Workers Comp, Commercial Auto',
    carriersRepresented: 3,
    activePolicies: 6,
    writtenPremium: 89400,
    status: 'active',
  },
  {
    id: 9,
    name: 'Pacific Specialty Underwriters',
    contactPerson: 'Sarah Wilson',
    email: 'swilson@pacificsu.com',
    phone: '(555) 501-6109',
    states: 'CA, OR, WA, HI',
    linesOfBusiness: 'Professional Liability, D&O, Cyber',
    carriersRepresented: 0,
    activePolicies: 0,
    writtenPremium: 0,
    status: 'inactive',
  },
]

const PAGE_SIZE = 5

const statusLabels: Record<MGAStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  pending: 'Pending',
}

const statusStyles: Record<MGAStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function matchesMGASearch(mga: MGA, query: string): boolean {
  if (!query) return true

  return (
    mga.name.toLowerCase().includes(query) ||
    mga.contactPerson.toLowerCase().includes(query) ||
    mga.email.toLowerCase().includes(query) ||
    mga.phone.includes(query) ||
    mga.states.toLowerCase().includes(query) ||
    mga.linesOfBusiness.toLowerCase().includes(query) ||
    String(mga.carriersRepresented).includes(query) ||
    statusLabels[mga.status].toLowerCase().includes(query)
  )
}

export function MGAs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    setPage(1)
  }, [search])

  const filteredMGAs = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return mgas
    return mgas.filter((mga) => matchesMGASearch(mga, query))
  }, [search])

  const summary = useMemo(() => {
    const activeCount = mgas.filter((m) => m.status === 'active').length
    const totalCarriers = mgas.reduce((sum, m) => sum + m.carriersRepresented, 0)
    const totalPolicies = mgas.reduce((sum, m) => sum + m.activePolicies, 0)
    const totalPremium = mgas.reduce((sum, m) => sum + m.writtenPremium, 0)

    return {
      total: mgas.length,
      active: activeCount,
      totalCarriers,
      totalPolicies,
      totalPremium,
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(filteredMGAs.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedMGAs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredMGAs.slice(start, start + PAGE_SIZE)
  }, [filteredMGAs, currentPage])

  const rangeStart =
    filteredMGAs.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredMGAs.length)

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

  function handleRowClick(mga: MGA) {
    setSelectedId(mga.id)
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
            placeholder="Search MGAs by name, contact, email, states, LOB, or status..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add MGA
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total MGAs</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <Building2 className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Active MGAs</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.active}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Building2 className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Carriers Represented</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalCarriers}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
              <Truck className="h-5 w-5 text-violet-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Active Policies</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalPolicies}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-teal-50">
              <FileText className="h-5 w-5 text-alza-teal-600" />
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
              <DollarSign className="h-5 w-5 text-orange-600" />
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
                  MGA Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Contact Person
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  States
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Lines of Business
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Carriers Represented
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Active Policies
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Written Premium
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedMGAs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <Search className="h-5 w-5 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">No MGAs found</p>
                      <p className="text-sm text-slate-500">
                        Try adjusting your search terms or add a new MGA.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedMGAs.map((mga) => (
                  <tr
                    key={mga.id}
                    onClick={() => handleRowClick(mga)}
                    className={`cursor-pointer transition-colors hover:bg-alza-blue-50/60 ${
                      selectedId === mga.id ? 'bg-alza-blue-50' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="text-sm font-medium text-slate-900">{mga.name}</p>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {mga.contactPerson}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {mga.email}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {mga.phone}
                    </td>

                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1 text-sm text-slate-700">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {mga.states}
                      </span>
                    </td>

                    <td className="max-w-xs px-4 py-4 text-sm text-slate-700">
                      {mga.linesOfBusiness}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {mga.carriersRepresented}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {mga.activePolicies}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(mga.writtenPremium)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[mga.status]}`}
                      >
                        {statusLabels[mga.status]}
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
            <span className="font-medium text-slate-900">{filteredMGAs.length}</span>{' '}
            MGAs
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
