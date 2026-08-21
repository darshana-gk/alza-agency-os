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
import { DirectoryNameSelect } from '../components/directory/DirectoryNameSelect'
import { ExportMenu } from '../components/ui/ExportMenu'
import { useAuth } from '../lib/auth'
import { formatCurrency } from '../lib/commission'
import { createClient } from '../lib/directory'
import { clientExportColumns } from '../lib/exportDefinitions'
import { downloadTableExport } from '../lib/tableExport'
import {
  canManageClients,
  isProducerBookScoped,
  producerKeysMatch,
  resolveProducerBookName,
  roleInputFromProfile,
} from '../lib/permissions'
import { supabase } from '../lib/supabase'

const ALL = 'all'

type ClientStatus = 'active' | 'pending' | 'inactive' | 'prospect'

interface Client {
  id: string
  clientNumber: string
  name: string
  dba: string
  contact: string
  phone: string
  email: string
  producer: string
  csr: string
  policies: number
  premium: string
  totalPremium: number
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
    clientNumber: row.client_number ?? '',
    name: row.business_name ?? '',
    dba: row.dba ?? '',
    contact: row.contact_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    producer: row.producer ?? '',
    csr: row.csr ?? '',
    status: normalizeStatus(row.status),
    policies: 0,
    premium: '$0.00',
    totalPremium: 0,
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
  const { profile } = useAuth()
  const roleInput = roleInputFromProfile(profile)
  const canMutate = canManageClients(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const statusFilter = searchParams.get('status') ?? ALL
  const producerFilter = searchParams.get('producer') ?? ALL
  const csrFilter = searchParams.get('csr') ?? ALL
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [producerScopeLimitation, setProducerScopeLimitation] = useState<string | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [form, setForm] = useState<AddClientForm>(emptyAddClientForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadClients = useCallback(async () => {
    setLoading(true)
    setFetchError(null)

    const [clientsRes, policiesRes, txRes] = await Promise.all([
      supabase.from('clients').select('*').order('business_name'),
      supabase.from('policies').select('id, client_id, archived_at').is('archived_at', null),
      supabase.from('transactions').select('client_id, amount').is('archived_at', null),
    ])

    if (clientsRes.error) {
      setFetchError(clientsRes.error.message)
      setClients([])
      cachedClients = []
      setLoading(false)
      return
    }

    if (policiesRes.error) {
      setFetchError(policiesRes.error.message)
      setClients([])
      cachedClients = []
      setLoading(false)
      return
    }

    if (txRes.error) {
      setFetchError(txRes.error.message)
      setClients([])
      cachedClients = []
      setLoading(false)
      return
    }

    const policyCountByClient = new Map<string, number>()
    for (const row of policiesRes.data ?? []) {
      const clientId = String(row.client_id ?? '')
      if (!clientId) continue
      policyCountByClient.set(clientId, (policyCountByClient.get(clientId) ?? 0) + 1)
    }

    const premiumByClient = new Map<string, number>()
    for (const row of txRes.data ?? []) {
      const clientId = String(row.client_id ?? '')
      if (!clientId) continue
      const amount =
        typeof row.amount === 'number'
          ? row.amount
          : Number(row.amount ?? 0)
      premiumByClient.set(
        clientId,
        (premiumByClient.get(clientId) ?? 0) + (Number.isFinite(amount) ? amount : 0),
      )
    }

    const mapped = ((clientsRes.data as SupabaseClientRow[] | null) ?? []).map((row) => {
      const base = mapRowToClient(row)
      const totalPremium = premiumByClient.get(base.id) ?? 0
      return {
        ...base,
        policies: policyCountByClient.get(base.id) ?? 0,
        premium: formatCurrency(totalPremium),
        totalPremium,
      }
    })

    if (isProducerBookScoped(roleInput)) {
      const names = [...new Set(mapped.map((c) => c.producer).filter(Boolean))]
      const scope = resolveProducerBookName(roleInput, profile?.fullName, names, {
        linkedProducerName: profile?.linkedProducerName,
      })
      setProducerScopeLimitation(scope.limitation)
      const scoped = scope.lockedName
        ? mapped.filter((c) => producerKeysMatch(c.producer, scope.lockedName))
        : []
      setClients(scoped)
      cachedClients = scoped
    } else {
      setProducerScopeLimitation(null)
      setClients(mapped)
      cachedClients = mapped
    }
    setLoading(false)
  }, [roleInput, profile?.fullName, profile?.linkedProducerName])

  useEffect(() => {
    loadClients()
  }, [loadClients])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, producerFilter, csrFilter])

  const producerOptions = useMemo(
    () => [...new Set(clients.map((c) => c.producer).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [clients],
  )

  const csrOptions = useMemo(
    () => [...new Set(clients.map((c) => c.csr).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [clients],
  )

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    return clients.filter((client) => {
      if (statusFilter !== ALL && client.status !== statusFilter) return false
      if (producerFilter !== ALL && client.producer !== producerFilter) return false
      if (csrFilter !== ALL && client.csr !== csrFilter) return false
      if (!query) return true
      return clientMatchesQuery(client, query)
    })
  }, [search, clients, statusFilter, producerFilter, csrFilter])

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredClients.slice(start, start + PAGE_SIZE)
  }, [filteredClients, currentPage])

  const rangeStart =
    filteredClients.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredClients.length)

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
    setPage(1)
  }

  function handleSearchChange(value: string) {
    setParam('search', value.trim() ? value : '')
  }

  function handleRowClick(client: Client) {
    navigate(`/clients/${client.id}`)
  }

  function openAddModal() {
    if (!canMutate) return
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
    if (!canMutate) return

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
      clientNumber,
      businessName: form.business_name,
      dba: form.dba,
      fein: form.fein,
      contactName: form.contact_name,
      email: form.email,
      phone: form.phone,
      mailingAddress: form.mailing_address,
      physicalAddress: form.physical_address,
      producer: form.producer,
      csr: form.csr,
      status: form.status,
      renewalMonth: form.renewal_month ? Number(form.renewal_month) : null,
      renewalDay: form.renewal_day ? Number(form.renewal_day) : null,
      notes: form.notes,
    }

    const result = await createClient(payload)

    if (result.error) {
      setSaveError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
          <select
            value={statusFilter}
            onChange={(e) => setParam('status', e.target.value)}
            className={`${selectClassName} sm:w-40`}
          >
            <option value={ALL}>All statuses</option>
            {(Object.keys(statusLabels) as ClientStatus[]).map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
          <select
            value={producerFilter}
            onChange={(e) => setParam('producer', e.target.value)}
            disabled={producerLocked}
            className={`${selectClassName} sm:w-44`}
          >
            <option value={ALL}>All producers</option>
            {producerOptions.map((producer) => (
              <option key={producer} value={producer}>
                {producer}
              </option>
            ))}
          </select>
          <select
            value={csrFilter}
            onChange={(e) => setParam('csr', e.target.value)}
            className={`${selectClassName} sm:w-40`}
          >
            <option value={ALL}>All CSRs</option>
            {csrOptions.map((csr) => (
              <option key={csr} value={csr}>
                {csr}
              </option>
            ))}
          </select>
          <ExportMenu
            rowCount={filteredClients.length}
            disabled={loading}
            onExport={(format) =>
              downloadTableExport({
                format,
                sheetName: 'Clients',
                columns: clientExportColumns,
                rows: filteredClients,
                filenameBase: 'Clients',
                label: 'clients',
              })
            }
          />
        </div>

        {canMutate && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Client
          </button>
        )}
      </div>

      {producerLocked && producerScopeLimitation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {producerScopeLimitation}
        </div>
      )}

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
                  Total Premium
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
                      <DirectoryNameSelect
                        id="producer"
                        kind="producer"
                        value={form.producer}
                        onChange={(value) => updateFormField('producer', value)}
                      />
                    </div>

                    <div>
                      <label htmlFor="csr" className="mb-1.5 block text-xs font-medium text-slate-500">
                        CSR
                      </label>
                      <DirectoryNameSelect
                        id="csr"
                        kind="csr"
                        value={form.csr}
                        onChange={(value) => updateFormField('csr', value)}
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
