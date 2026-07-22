import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Users,
} from 'lucide-react'

type ClientStatus = 'active' | 'pending' | 'inactive' | 'prospect'

interface Client {
  id: number
  name: string
  contact: string
  phone: string
  email: string
  producer: string
  policies: number
  premium: string
  status: ClientStatus
}

const clients: Client[] = [
  {
    id: 1,
    name: 'ABC Construction LLC',
    contact: 'John Miller',
    phone: '(555) 123-4567',
    email: 'john@abcconstruction.com',
    producer: 'Michael Johnson',
    policies: 3,
    premium: '$42,500',
    status: 'active',
  },
  {
    id: 2,
    name: 'Sunrise Roofing Inc',
    contact: 'David Smith',
    phone: '(555) 234-5678',
    email: 'info@sunriseroofing.com',
    producer: 'Sarah Wilson',
    policies: 2,
    premium: '$18,900',
    status: 'active',
  },
  {
    id: 3,
    name: 'Metro Auto Group LLC',
    contact: 'Lisa Chen',
    phone: '(555) 345-6789',
    email: 'lisa@metroauto.com',
    producer: 'Michael Johnson',
    policies: 5,
    premium: '$67,200',
    status: 'active',
  },
  {
    id: 4,
    name: 'Coastal Marine Services',
    contact: 'Robert Hayes',
    phone: '(555) 456-7890',
    email: 'rhayes@coastmarine.com',
    producer: 'Sarah Wilson',
    policies: 1,
    premium: '$12,400',
    status: 'pending',
  },
  {
    id: 5,
    name: 'Sunrise Properties Inc',
    contact: 'Amanda Torres',
    phone: '(555) 567-8901',
    email: 'amanda@sunriseprops.com',
    producer: 'James Carter',
    policies: 4,
    premium: '$31,750',
    status: 'active',
  },
  {
    id: 6,
    name: 'Westside Retail Group',
    contact: 'Kevin Brooks',
    phone: '(555) 678-9012',
    email: 'kbrooks@westsideretail.com',
    producer: 'Sarah Wilson',
    policies: 2,
    premium: '$9,800',
    status: 'inactive',
  },
  {
    id: 7,
    name: 'Johnson Family Trust',
    contact: 'Patricia Johnson',
    phone: '(555) 789-0123',
    email: 'pjohnson@jfamilytrust.com',
    producer: 'Michael Johnson',
    policies: 6,
    premium: '$54,300',
    status: 'active',
  },
  {
    id: 8,
    name: 'Peak Logistics Corp',
    contact: 'Daniel Wright',
    phone: '(555) 890-1234',
    email: 'dwright@peaklogistics.com',
    producer: 'James Carter',
    policies: 0,
    premium: '$0',
    status: 'prospect',
  },
  {
    id: 9,
    name: 'Harbor Medical Group',
    contact: 'Dr. Emily Park',
    phone: '(555) 901-2345',
    email: 'epark@harbormedical.com',
    producer: 'Sarah Wilson',
    policies: 3,
    premium: '$28,600',
    status: 'active',
  },
  {
    id: 10,
    name: 'Summit Tech Solutions',
    contact: 'Marcus Lee',
    phone: '(555) 012-3456',
    email: 'marcus@summittech.io',
    producer: 'James Carter',
    policies: 1,
    premium: '$6,450',
    status: 'pending',
  },
  {
    id: 11,
    name: 'Green Valley Farms',
    contact: 'Thomas Green',
    phone: '(555) 111-2222',
    email: 'tgreen@greenvalleyfarms.com',
    producer: 'Michael Johnson',
    policies: 2,
    premium: '$15,200',
    status: 'active',
  },
  {
    id: 12,
    name: 'Urban Fitness Studios',
    contact: 'Nina Alvarez',
    phone: '(555) 222-3333',
    email: 'nina@urbanfitness.com',
    producer: 'Sarah Wilson',
    policies: 1,
    premium: '$4,900',
    status: 'prospect',
  },
]

const PAGE_SIZE = 5

const statusStyles: Record<ClientStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  prospect: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
}

const statusLabels: Record<ClientStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
  prospect: 'Prospect',
}

export function Clients() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return clients

    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(query) ||
        client.contact.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query) ||
        client.phone.includes(query) ||
        client.producer.toLowerCase().includes(query) ||
        statusLabels[client.status].toLowerCase().includes(query),
    )
  }, [search])

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredClients.slice(start, start + PAGE_SIZE)
  }, [filteredClients, currentPage])

  const rangeStart =
    filteredClients.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredClients.length)

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  function handleRowClick(client: Client) {
    setSelectedId(client.id)
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search clients by name, contact, producer, or status..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add Client
        </button>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-alza-blue-50">
            <Users className="h-4 w-4 text-alza-blue-600" />
          </div>
          <span>
            <span className="font-semibold text-slate-900">{filteredClients.length}</span>{' '}
            {filteredClients.length === 1 ? 'client' : 'clients'}
            {search.trim() ? ' found' : ' total'}
          </span>
        </div>

        <div className="hidden h-4 w-px bg-slate-200 sm:block" />

        <div className="flex flex-wrap gap-2">
          {(Object.keys(statusLabels) as ClientStatus[]).map((status) => {
            const count = filteredClients.filter((c) => c.status === status).length
            return (
              <span
                key={status}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[status]}`}
              >
                {statusLabels[status]}: {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Client
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Producer
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Policies
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Annual Premium
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedClients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                        <Search className="h-5 w-5 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">No clients found</p>
                      <p className="text-sm text-slate-500">
                        Try adjusting your search terms or add a new client.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedClients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => handleRowClick(client)}
                    className={`cursor-pointer transition-colors hover:bg-alza-blue-50/60 ${
                      selectedId === client.id ? 'bg-alza-blue-50' : ''
                    }`}
                  >
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900">{client.name}</p>
                      <p className="text-xs text-slate-500">ID #{client.id.toString().padStart(4, '0')}</p>
                    </td>

                    <td className="px-6 py-4">
                      <p className="text-sm text-slate-900">{client.contact}</p>
                      <p className="text-sm text-slate-500">{client.email}</p>
                      <p className="text-sm text-slate-500">{client.phone}</p>
                    </td>

                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[client.status]}`}
                      >
                        {statusLabels[client.status]}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-700">{client.producer}</td>

                    <td className="px-6 py-4 text-sm text-slate-700">{client.policies}</td>

                    <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                      {client.premium}
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
            <span className="font-medium text-slate-900">{filteredClients.length}</span>{' '}
            clients
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
