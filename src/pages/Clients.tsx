import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type ClientStatus = 'active' | 'pending' | 'inactive' | 'prospect'

interface Client {
  id: string
  name: string
  contact: string
  phone: string
  email: string
  producer: string
  csr: string
  policies: number
  premium: string
  status: ClientStatus
}

interface SupabaseClientRow {
  id: string | number
  client_number: string | null
  business_name: string | null
  dba: string | null
  fein: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  mailing_address: string | null
  physical_address: string | null
  producer: string | null
  csr: string | null
  status: string | null
  renewal_month: number | null
  renewal_day: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface AddClientForm {
  business_name: string
  dba: string
  fein: string
  contact_name: string
  email: string
  phone: string
  mailing_address: string
  physical_address: string
  producer: string
  csr: string
  status: ClientStatus
  renewal_month: string
  renewal_day: string
  notes: string
}

let cachedClients: Client[] = []

const PAGE_SIZE = 5

const emptyAddClientForm: AddClientForm = {
  business_name: '',
  dba: '',
  fein: '',
  contact_name: '',
  email: '',
  phone: '',
  mailing_address: '',
  physical_address: '',
  producer: '',
  csr: '',
  status: 'prospect',
  renewal_month: '',
  renewal_day: '',
  notes: '',
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const RENEWAL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

const sectionHeadingClassName = 'text-sm font-semibold text-slate-900'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

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

function normalizeStatus(status: string | null): ClientStatus {
  const value = status?.toLowerCase()
  if (value === 'active' || value === 'pending' || value === 'inactive' || value === 'prospect') {
    return value
  }
  return 'prospect'
}

function mapRowToClient(row: SupabaseClientRow): Client {
  return {
    id: String(row.id),
    name: row.business_name ?? '',
    contact: row.contact_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    producer: row.producer ?? '',
    csr: row.csr ?? '',
    status: normalizeStatus(row.status),
    policies: 0,
    premium: '$0',
  }
}

function clientMatchesQuery(client: Client, query: string): boolean {
  return (
    client.name.toLowerCase().includes(query) ||
    client.contact.toLowerCase().includes(query) ||
    client.email.toLowerCase().includes(query) ||
    client.phone.includes(query) ||
    client.producer.toLowerCase().includes(query) ||
    client.csr.toLowerCase().includes(query) ||
    statusLabels[client.status].toLowerCase().includes(query)
  )
}

async function generateNextClientNumber(): Promise<string> {
  const { data, error } = await supabase.from('clients').select('client_number')

  if (error) throw error

  let max = 0
  for (const row of data ?? []) {
    const match = row.client_number?.match(/^ALZA-(\d+)$/)
    if (match) max = Math.max(max, parseInt(match[1], 10))
  }

  return `ALZA-${String(max + 1).padStart(6, '0')}`
}

export function hasMatchingClient(searchTerm: string): boolean {
  const query = searchTerm.trim().toLowerCase()
  if (!query) return false

  return cachedClients.some((client) => clientMatchesQuery(client, query))
}

export function Clients() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [form, setForm] = useState<AddClientForm>(emptyAddClientForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadClients = useCallback(async () => {
    setLoading(true)
    setFetchError(null)

    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('business_name')

    if (error) {
      setFetchError(error.message)
      setClients([])
      cachedClients = []
    } else {
      const mapped = (data as SupabaseClientRow[] ?? []).map(mapRowToClient)
      setClients(mapped)
      cachedClients = mapped
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    loadClients()
  }, [loadClients])

  useEffect(() => {
    setPage(1)
  }, [search])

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return clients

    return clients.filter((client) => clientMatchesQuery(client, query))
  }, [search, clients])

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

  function handleRowClick(client: Client) {
    navigate(`/clients/${client.id}`)
  }

  function openAddModal() {
    setSaveError(null)
    setIsAddModalOpen(true)
  }

  function closeAddModal() {
    setIsAddModalOpen(false)
    setForm(emptyAddClientForm)
    setSaveError(null)
  }

  function updateFormField<K extends keyof AddClientForm>(key: K, value: AddClientForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSaveClient(e: FormEvent) {
    e.preventDefault()

    if (!form.business_name.trim()) {
      setSaveError('Business Name is required.')
      return
    }

    setSaving(true)
    setSaveError(null)

    let clientNumber: string
    try {
      clientNumber = await generateNextClientNumber()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to generate client number.')
      setSaving(false)
      return
    }

    const payload = {
      client_number: clientNumber,
      business_name: form.business_name.trim(),
      dba: form.dba.trim() || null,
      fein: form.fein.trim() || null,
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      mailing_address: form.mailing_address.trim() || null,
      physical_address: form.physical_address.trim() || null,
      producer: form.producer.trim() || null,
      csr: form.csr.trim() || null,
      status: form.status,
      renewal_month: form.renewal_month ? Number(form.renewal_month) : null,
      renewal_day: form.renewal_day ? Number(form.renewal_day) : null,
      notes: form.notes.trim() || null,
    }

    const { error } = await supabase.from('clients').insert(payload)

    if (error) {
      setSaveError(error.message)
      setSaving(false)
      return
    }

    setSaving(false)
    closeAddModal()
    setPage(1)
    await loadClients()
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
            onChange={(e) => handleSearchChange(e.currentTarget.value)}
            placeholder="Search clients by name, contact, producer, or status..."
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
        >
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

      {fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load clients: {fetchError}
        </div>
      )}

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
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <p className="text-sm text-slate-600">Loading clients...</p>
                  </td>
                </tr>
              ) : paginatedClients.length === 0 ? (
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
                    className="cursor-pointer transition-colors hover:bg-alza-blue-50/60"
                  >
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900">{client.name}</p>
                      <p className="text-xs text-slate-500">ID #{client.id.padStart(4, '0')}</p>
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

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={closeAddModal}
            aria-hidden="true"
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <form onSubmit={handleSaveClient}>
              <div className="border-b border-slate-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Add Client</h2>
              </div>

              <div className="space-y-6 px-6 py-4">
                {saveError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {saveError}
                  </div>
                )}

                <div className="space-y-4">
                  <h3 className={sectionHeadingClassName}>Business Information</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="business_name" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Business Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="business_name"
                        type="text"
                        required
                        value={form.business_name}
                        onChange={(e) => updateFormField('business_name', e.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="dba" className="mb-1.5 block text-xs font-medium text-slate-500">
                        DBA
                      </label>
                      <input
                        id="dba"
                        type="text"
                        value={form.dba}
                        onChange={(e) => updateFormField('dba', e.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="fein" className="mb-1.5 block text-xs font-medium text-slate-500">
                        FEIN
                      </label>
                      <input
                        id="fein"
                        type="text"
                        value={form.fein}
                        onChange={(e) => updateFormField('fein', e.target.value)}
                        className={inputClassName}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className={sectionHeadingClassName}>Contact Information</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact_name" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Contact Name
                      </label>
                      <input
                        id="contact_name"
                        type="text"
                        value={form.contact_name}
                        onChange={(e) => updateFormField('contact_name', e.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Email
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => updateFormField('email', e.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="phone" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Phone
                      </label>
                      <input
                        id="phone"
                        type="text"
                        value={form.phone}
                        onChange={(e) => updateFormField('phone', e.target.value)}
                        className={inputClassName}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className={sectionHeadingClassName}>Agency Information</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="producer" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Producer
                      </label>
                      <input
                        id="producer"
                        type="text"
                        value={form.producer}
                        onChange={(e) => updateFormField('producer', e.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="csr" className="mb-1.5 block text-xs font-medium text-slate-500">
                        CSR
                      </label>
                      <input
                        id="csr"
                        type="text"
                        value={form.csr}
                        onChange={(e) => updateFormField('csr', e.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="status" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Status
                      </label>
                      <select
                        id="status"
                        value={form.status}
                        onChange={(e) => updateFormField('status', e.target.value as ClientStatus)}
                        className={selectClassName}
                      >
                        {(Object.keys(statusLabels) as ClientStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className={sectionHeadingClassName}>Renewal Information</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="renewal_month" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Renewal Month
                      </label>
                      <select
                        id="renewal_month"
                        value={form.renewal_month}
                        onChange={(e) => updateFormField('renewal_month', e.target.value)}
                        className={selectClassName}
                      >
                        <option value="">Select month</option>
                        {MONTHS.map((month, index) => (
                          <option key={month} value={String(index + 1)}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="renewal_day" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Renewal Day
                      </label>
                      <select
                        id="renewal_day"
                        value={form.renewal_day}
                        onChange={(e) => updateFormField('renewal_day', e.target.value)}
                        className={selectClassName}
                      >
                        <option value="">Select day</option>
                        {RENEWAL_DAYS.map((day) => (
                          <option key={day} value={String(day)}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className={sectionHeadingClassName}>Addresses</h3>
                  <div className="grid gap-4">
                    <div>
                      <label htmlFor="mailing_address" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Mailing Address
                      </label>
                      <textarea
                        id="mailing_address"
                        rows={2}
                        value={form.mailing_address}
                        onChange={(e) => updateFormField('mailing_address', e.target.value)}
                        className={textareaClassName}
                      />
                    </div>

                    <div>
                      <label htmlFor="physical_address" className="mb-1.5 block text-xs font-medium text-slate-500">
                        Physical Address
                      </label>
                      <textarea
                        id="physical_address"
                        rows={2}
                        value={form.physical_address}
                        onChange={(e) => updateFormField('physical_address', e.target.value)}
                        className={textareaClassName}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className={sectionHeadingClassName}>Additional Information</h3>
                  <div>
                    <label htmlFor="notes" className="mb-1.5 block text-xs font-medium text-slate-500">
                      Notes
                    </label>
                    <textarea
                      id="notes"
                      rows={3}
                      value={form.notes}
                      onChange={(e) => updateFormField('notes', e.target.value)}
                      className={textareaClassName}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
