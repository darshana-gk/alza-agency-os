import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Plus,
  Search,
  Truck,
  Wallet,
} from 'lucide-react'

type BillingType = 'direct_bill' | 'agency_bill' | 'both'
type AppointmentStatus = 'appointed' | 'pending' | 'not_appointed'
type CarrierStatus = 'active' | 'inactive'

interface Carrier {
  id: number
  name: string
  naic: string
  linesOfBusiness: string
  billingType: BillingType
  activePolicies: number
  writtenPremium: number
  commissionReceivable: number
  appointmentStatus: AppointmentStatus
  status: CarrierStatus
}

const carriers: Carrier[] = [
  {
    id: 1,
    name: 'Hartford',
    naic: '19682',
    linesOfBusiness: 'Commercial Package, Workers Comp, Umbrella',
    billingType: 'agency_bill',
    activePolicies: 18,
    writtenPremium: 284500,
    commissionReceivable: 34140,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 2,
    name: 'Travelers',
    naic: '25674',
    linesOfBusiness: 'Commercial Auto, Property, General Liability',
    billingType: 'both',
    activePolicies: 22,
    writtenPremium: 412800,
    commissionReceivable: 49536,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 3,
    name: 'Liberty Mutual',
    naic: '23035',
    linesOfBusiness: 'Commercial Auto, BOP, Inland Marine',
    billingType: 'direct_bill',
    activePolicies: 14,
    writtenPremium: 198600,
    commissionReceivable: 21846,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 4,
    name: 'Chubb',
    naic: '20303',
    linesOfBusiness: 'General Liability, Professional Liability, Property',
    billingType: 'agency_bill',
    activePolicies: 9,
    writtenPremium: 156200,
    commissionReceivable: 18744,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 5,
    name: 'CNA',
    naic: '20443',
    linesOfBusiness: 'Commercial Property, General Liability, Umbrella',
    billingType: 'agency_bill',
    activePolicies: 11,
    writtenPremium: 167400,
    commissionReceivable: 20088,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 6,
    name: 'Nationwide',
    naic: '23787',
    linesOfBusiness: 'BOP, Commercial Auto, Workers Comp',
    billingType: 'direct_bill',
    activePolicies: 8,
    writtenPremium: 94200,
    commissionReceivable: 10362,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 7,
    name: 'Hiscox',
    naic: '10200',
    linesOfBusiness: 'Professional Liability, Cyber, E&O',
    billingType: 'direct_bill',
    activePolicies: 6,
    writtenPremium: 78400,
    commissionReceivable: 8624,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 8,
    name: 'Zurich',
    naic: '16535',
    linesOfBusiness: 'Commercial Package, Inland Marine, Umbrella',
    billingType: 'agency_bill',
    activePolicies: 5,
    writtenPremium: 112000,
    commissionReceivable: 13440,
    appointmentStatus: 'pending',
    status: 'active',
  },
  {
    id: 9,
    name: 'Markel',
    naic: '38970',
    linesOfBusiness: 'General Liability, Professional Liability',
    billingType: 'both',
    activePolicies: 4,
    writtenPremium: 48600,
    commissionReceivable: 5832,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 10,
    name: 'Progressive Commercial',
    naic: '24260',
    linesOfBusiness: 'Commercial Auto, Trucking',
    billingType: 'direct_bill',
    activePolicies: 7,
    writtenPremium: 134200,
    commissionReceivable: 14762,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 11,
    name: 'Employers',
    naic: '26535',
    linesOfBusiness: 'Workers Compensation',
    billingType: 'agency_bill',
    activePolicies: 3,
    writtenPremium: 62000,
    commissionReceivable: 7440,
    appointmentStatus: 'appointed',
    status: 'active',
  },
  {
    id: 12,
    name: 'Beazley',
    naic: '37540',
    linesOfBusiness: 'Cyber, Professional Liability, D&O',
    billingType: 'direct_bill',
    activePolicies: 0,
    writtenPremium: 0,
    commissionReceivable: 0,
    appointmentStatus: 'not_appointed',
    status: 'inactive',
  },
]

const PAGE_SIZE = 5

const billingTypeLabels: Record<BillingType, string> = {
  direct_bill: 'Direct Bill',
  agency_bill: 'Agency Bill',
  both: 'Both',
}

const billingTypeStyles: Record<BillingType, string> = {
  direct_bill: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
  agency_bill: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  both: 'bg-alza-teal-50 text-alza-teal-700 ring-alza-teal-600/20',
}

const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  appointed: 'Appointed',
  pending: 'Pending',
  not_appointed: 'Not Appointed',
}

const appointmentStatusStyles: Record<AppointmentStatus, string> = {
  appointed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  not_appointed: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

const carrierStatusLabels: Record<CarrierStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const carrierStatusStyles: Record<CarrierStatus, string> = {
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

function matchesCarrierSearch(carrier: Carrier, query: string): boolean {
  if (!query) return true

  return (
    carrier.name.toLowerCase().includes(query) ||
    carrier.naic.includes(query) ||
    carrier.linesOfBusiness.toLowerCase().includes(query) ||
    billingTypeLabels[carrier.billingType].toLowerCase().includes(query) ||
    appointmentStatusLabels[carrier.appointmentStatus].toLowerCase().includes(query) ||
    carrierStatusLabels[carrier.status].toLowerCase().includes(query)
  )
}

export function Carriers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    setPage(1)
  }, [search])

  const filteredCarriers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return carriers
    return carriers.filter((carrier) => matchesCarrierSearch(carrier, query))
  }, [search])

  const summary = useMemo(() => {
    const activeCount = carriers.filter((c) => c.status === 'active').length
    const directBillCount = carriers.filter(
      (c) => c.billingType === 'direct_bill' || c.billingType === 'both',
    ).length
    const agencyBillCount = carriers.filter(
      (c) => c.billingType === 'agency_bill' || c.billingType === 'both',
    ).length
    const totalActivePolicies = carriers.reduce((sum, c) => sum + c.activePolicies, 0)

    return {
      total: carriers.length,
      active: activeCount,
      directBill: directBillCount,
      agencyBill: agencyBillCount,
      totalActivePolicies,
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(filteredCarriers.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedCarriers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredCarriers.slice(start, start + PAGE_SIZE)
  }, [filteredCarriers, currentPage])

  const rangeStart =
    filteredCarriers.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredCarriers.length)

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

  function handleRowClick(carrier: Carrier) {
    setSelectedId(carrier.id)
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
            placeholder="Search carriers by name, NAIC, LOB, billing, or status..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add Carrier
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Carriers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <Truck className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Active Carriers</p>
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
              <p className="text-sm font-medium text-slate-500">Direct Bill Carriers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.directBill}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <CreditCard className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Agency Bill Carriers</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.agencyBill}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
              <Wallet className="h-5 w-5 text-violet-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Active Policies</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalActivePolicies}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-teal-50">
              <FileText className="h-5 w-5 text-alza-teal-600" />
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
                  Carrier Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  NAIC Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Lines of Business
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Billing Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Active Policies
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Written Premium
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Commission Receivable
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Appointment Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedCarriers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <Search className="h-5 w-5 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">No carriers found</p>
                      <p className="text-sm text-slate-500">
                        Try adjusting your search terms or add a new carrier.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedCarriers.map((carrier) => (
                  <tr
                    key={carrier.id}
                    onClick={() => handleRowClick(carrier)}
                    className={`cursor-pointer transition-colors hover:bg-alza-blue-50/60 ${
                      selectedId === carrier.id ? 'bg-alza-blue-50' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-4">
                      <p className="text-sm font-medium text-slate-900">{carrier.name}</p>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-alza-blue-700">
                      {carrier.naic}
                    </td>

                    <td className="max-w-xs px-4 py-4 text-sm text-slate-700">
                      {carrier.linesOfBusiness}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${billingTypeStyles[carrier.billingType]}`}
                      >
                        {billingTypeLabels[carrier.billingType]}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {carrier.activePolicies}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(carrier.writtenPremium)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(carrier.commissionReceivable)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${appointmentStatusStyles[carrier.appointmentStatus]}`}
                      >
                        {appointmentStatusLabels[carrier.appointmentStatus]}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${carrierStatusStyles[carrier.status]}`}
                      >
                        {carrierStatusLabels[carrier.status]}
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
            <span className="font-medium text-slate-900">{filteredCarriers.length}</span>{' '}
            carriers
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
