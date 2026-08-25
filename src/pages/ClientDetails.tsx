import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  DollarSign,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  StickyNote,
  X,
} from 'lucide-react'
import { AddPolicyModal } from '../components/policies/AddPolicyModal'
import { DirectoryNameSelect } from '../components/directory/DirectoryNameSelect'
import { useAuth } from '../lib/auth'
import {
  financialsReturnFromLocation,
  transactionLinkState,
  withFinancialsReturn,
} from '../lib/financialsNav'
import {
  fetchCommissionTransactions,
  fetchPolicyTransactionSummaries,
  formatCurrency as formatMoney,
  formatTypeLabel,
} from '../lib/commission'
import { updateClient } from '../lib/directory'
import { resolveCurrentPolicyPremium, sumClientCurrentPremium } from '../lib/policyPremium'
import {
  canManageClients,
  canManagePolicies,
  isProducerBookScoped,
  producerKeysMatch,
  roleInputFromProfile,
} from '../lib/permissions'
import { supabase } from '../lib/supabase'

type ClientStatus = 'active' | 'pending' | 'inactive' | 'prospect'
type PolicyStatus = 'active' | 'pending' | 'expired' | 'cancelled' | 'renewal_due'

interface ClientPolicy {
  id: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  effectiveDate: string
  expirationDate: string
  /** Original policies.premium (opening / stored reference). */
  writtenPremium: number
  status: PolicyStatus
  transactionCount: number
  /** Current Policy Premium = policies.premium + SUM(txn amounts). */
  totalPremium: number
  latestTransactionDate: string | null
}

interface ClientFinancials {
  totalPremium: number
  agencyCommission: number
  producerCommission: number
  /** Agency commission on transactions still awaiting receipt confirmation. */
  outstandingAgencyCommission: number
}

interface ClientDetail {
  id: string
  clientNumber: string
  businessName: string
  dba: string
  fein: string
  contact: string
  phone: string
  email: string
  mailingAddress: string
  physicalAddress: string
  address: string
  producer: string
  csr: string
  status: ClientStatus
  notes: string
  policies: ClientPolicy[]
  financials: ClientFinancials
  recentTransactions: {
    id: string
    transactionNumber: string
    transactionDate: string
    type: string
    amount: number
    policyNumber: string
  }[]
}

interface ClientRow {
  id: string
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
  notes: string | null
}

interface PolicyRow {
  id: string
  policy_number: string | null
  policy_type: string | null
  carrier: string | null
  mga: string | null
  effective_date: string | null
  expiration_date: string | null
  premium: number | string | null
  status: string | null
}

const clientStatusLabels: Record<ClientStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
  prospect: 'Prospect',
}

const clientStatusStyles: Record<ClientStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  prospect: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
}

const policyStatusLabels: Record<PolicyStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  expired: 'Expired',
  cancelled: 'Cancelled',
  renewal_due: 'Renewal Due',
}

const policyStatusStyles: Record<PolicyStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  expired: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  cancelled: 'bg-red-50 text-red-700 ring-red-600/20',
  renewal_due: 'bg-orange-50 text-orange-700 ring-orange-600/20',
}

function normalizeClientStatus(status: string | null): ClientStatus {
  const value = (status ?? '').toLowerCase()
  if (value === 'active' || value === 'pending' || value === 'inactive' || value === 'prospect') {
    return value
  }
  return 'prospect'
}

function normalizePolicyStatus(status: string | null): PolicyStatus {
  const value = (status ?? '').toLowerCase()
  if (
    value === 'active' ||
    value === 'pending' ||
    value === 'expired' ||
    value === 'cancelled' ||
    value === 'renewal_due'
  ) {
    return value
  }
  return 'pending'
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function display(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : '—'
}

function formatCurrency(amount: number): string {
  return formatMoney(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === '—') return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-900">{value}</p>
    </div>
  )
}

function mapPolicy(row: PolicyRow): ClientPolicy {
  return {
    id: row.id,
    policyNumber: display(row.policy_number),
    policyType: display(row.policy_type),
    carrier: display(row.carrier),
    mga: display(row.mga),
    effectiveDate: row.effective_date?.trim() || '',
    expirationDate: row.expiration_date?.trim() || '',
    writtenPremium: toNumber(row.premium),
    status: normalizePolicyStatus(row.status),
    transactionCount: 0,
    totalPremium: 0,
    latestTransactionDate: null,
  }
}

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export function ClientDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const financialsReturnTo = financialsReturnFromLocation(location)
  const { profile } = useAuth()
  const roleInput = roleInputFromProfile(profile)
  const canEdit = canManageClients(roleInput)
  const canAddPolicy = canManagePolicies(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [addPolicyOpen, setAddPolicyOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    businessName: '',
    dba: '',
    fein: '',
    contactName: '',
    email: '',
    phone: '',
    mailingAddress: '',
    physicalAddress: '',
    producer: '',
    csr: '',
    status: 'active' as ClientStatus,
    notes: '',
  })

  const loadClient = useCallback(async () => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setNotFound(false)

    const { data: clientRow, error: clientError } = await supabase
      .from('clients')
      .select(
        `
        id,
        client_number,
        business_name,
        dba,
        fein,
        contact_name,
        email,
        phone,
        mailing_address,
        physical_address,
        producer,
        csr,
        status,
        notes
      `,
      )
      .eq('id', id)
      .maybeSingle()

    if (clientError) {
      setClient(null)
      setError(clientError.message)
      setLoading(false)
      return
    }

    if (!clientRow) {
      setClient(null)
      setNotFound(true)
      setLoading(false)
      return
    }

    const { data: policyRows, error: policyError } = await supabase
      .from('policies')
      .select(
        `
        id,
        policy_number,
        policy_type,
        carrier,
        mga,
        effective_date,
        expiration_date,
        premium,
        status
      `,
      )
      .eq('client_id', id)
      .is('archived_at', null)
      .order('effective_date', { ascending: false })

    if (policyError) {
      setClient(null)
      setError(policyError.message)
      setLoading(false)
      return
    }

    const policiesBase = ((policyRows ?? []) as PolicyRow[]).map(mapPolicy)
    const [summaryRes, txRes] = await Promise.all([
      fetchPolicyTransactionSummaries(policiesBase.map((p) => p.id)),
      fetchCommissionTransactions(),
    ])
    if (summaryRes.error) {
      setClient(null)
      setError(summaryRes.error.message)
      setLoading(false)
      return
    }
    if (txRes.error) {
      setClient(null)
      setError(txRes.error.message)
      setLoading(false)
      return
    }

    const policies = policiesBase.map((policy) => {
      const summary = summaryRes.data[policy.id]
      return {
        ...policy,
        transactionCount: summary?.transactionCount ?? 0,
        totalPremium: resolveCurrentPolicyPremium({
          policyPremium: policy.writtenPremium,
          transactionPremiumSum: summary?.totalPremium ?? 0,
        }),
        latestTransactionDate: summary?.latestTransactionDate ?? null,
      }
    })

    const clientTxns = txRes.data.filter((tx) => tx.clientId === id && !tx.archived)
    // Same SoT as Clients browse: SUM(resolveCurrentPolicyPremium) across policies.
    const totalPremium = sumClientCurrentPremium(
      policies.map((p) => ({
        policyPremium: p.writtenPremium,
        transactionPremiumSum: summaryRes.data[p.id]?.totalPremium ?? 0,
      })),
    )
    const agencyCommission = clientTxns.reduce((sum, tx) => sum + tx.agencyCommissionAmount, 0)
    const producerCommission = clientTxns.reduce((sum, tx) => sum + tx.producerCommissionAmount, 0)
    const outstandingAgencyCommission = clientTxns
      .filter((tx) => !tx.agencyCommissionConfirmed)
      .reduce((sum, tx) => sum + tx.agencyCommissionAmount, 0)

    const recentTransactions = [...clientTxns]
      .sort((a, b) => String(b.transactionDate).localeCompare(String(a.transactionDate)))
      .slice(0, 8)
      .map((tx) => ({
        id: tx.id,
        transactionNumber: tx.transactionNumber || '—',
        transactionDate: tx.transactionDate,
        type: tx.type,
        amount: tx.amount,
        policyNumber: tx.policyNumber || '—',
      }))

    const row = clientRow as ClientRow
    const clientProducer = display(row.producer)

    if (producerLocked) {
      if (!producerKeysMatch(clientProducer, profile?.fullName)) {
        setClient(null)
        setNotFound(true)
        setError('You do not have permission to access this client record.')
        setLoading(false)
        return
      }
    }

    setClient({
      id: String(row.id),
      clientNumber: display(row.client_number),
      businessName: display(row.business_name),
      dba: display(row.dba),
      fein: display(row.fein),
      contact: display(row.contact_name),
      phone: display(row.phone),
      email: display(row.email),
      mailingAddress: display(row.mailing_address),
      physicalAddress: display(row.physical_address),
      address: display(row.physical_address || row.mailing_address),
      producer: clientProducer,
      csr: display(row.csr),
      status: normalizeClientStatus(row.status),
      notes: display(row.notes),
      policies,
      financials: {
        totalPremium,
        agencyCommission,
        producerCommission,
        outstandingAgencyCommission,
      },
      recentTransactions,
    })
    setLoading(false)
  }, [id, producerLocked, profile?.fullName])

  useEffect(() => {
    void loadClient()
  }, [loadClient])

  function openEdit() {
    if (!client || !canEdit) return
    setEditForm({
      businessName: client.businessName === '—' ? '' : client.businessName,
      dba: client.dba === '—' ? '' : client.dba,
      fein: client.fein === '—' ? '' : client.fein,
      contactName: client.contact === '—' ? '' : client.contact,
      email: client.email === '—' ? '' : client.email,
      phone: client.phone === '—' ? '' : client.phone,
      mailingAddress: client.mailingAddress === '—' ? '' : client.mailingAddress,
      physicalAddress: client.physicalAddress === '—' ? '' : client.physicalAddress,
      producer: client.producer === '—' ? '' : client.producer,
      csr: client.csr === '—' ? '' : client.csr,
      status: client.status,
      notes: client.notes === '—' ? '' : client.notes,
    })
    setFormError(null)
    setEditOpen(true)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!client || !canEdit || saving) return
    setSaving(true)
    setFormError(null)
    const result = await updateClient({
      id: client.id,
      businessName: editForm.businessName,
      dba: editForm.dba,
      fein: editForm.fein,
      contactName: editForm.contactName,
      email: editForm.email,
      phone: editForm.phone,
      mailingAddress: editForm.mailingAddress,
      physicalAddress: editForm.physicalAddress,
      producer: editForm.producer,
      csr: editForm.csr,
      status: editForm.status,
      notes: editForm.notes,
    })
    setSaving(false)
    if (result.error) {
      setFormError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setEditOpen(false)
    setActionSuccess('Client updated.')
    await loadClient()
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <p className="text-sm text-slate-500">Loading client…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <Building2 className="mx-auto h-12 w-12 text-slate-300" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Unable to load client</h2>
        <p className="mt-2 text-sm text-slate-500">{error}</p>
        <Link
          to="/clients"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-alza-blue-600 hover:text-alza-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Link>
      </div>
    )
  }

  if (notFound || !client) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <Building2 className="mx-auto h-12 w-12 text-slate-300" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Client not found</h2>
        <p className="mt-2 text-sm text-slate-500">The requested client record does not exist.</p>
        <Link
          to="/clients"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-alza-blue-600 hover:text-alza-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {financialsReturnTo ? (
          <Link
            to={financialsReturnTo}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-alza-blue-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Financials
          </Link>
        ) : (
          <Link
            to="/clients"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-alza-blue-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Clients
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{client.businessName}</h1>
          <p className="text-sm text-slate-500">
            Client 360° View · {client.clientNumber}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" />
              Edit Client
            </button>
          )}
          <span
            className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${clientStatusStyles[client.status]}`}
          >
            {clientStatusLabels[client.status]}
          </span>
        </div>
      </div>

      {actionSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {actionSuccess}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
            <Building2 className="h-5 w-5 text-alza-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Client Information</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Business Name" value={client.businessName} />
          <InfoField label="DBA" value={client.dba} />
          <InfoField label="FEIN" value={client.fein} />
          <InfoField label="Contact" value={client.contact} />
          <InfoField label="Phone" value={client.phone} />
          <InfoField label="Email" value={client.email} />
          <InfoField label="Address" value={client.address} />
          <InfoField label="Producer" value={client.producer} />
          <InfoField label="CSR" value={client.csr} />
          <InfoField label="Status" value={clientStatusLabels[client.status]} />
          <InfoField label="Notes" value={client.notes} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Total Premium',
            value: formatCurrency(client.financials.totalPremium),
            icon: DollarSign,
            bg: 'bg-alza-teal-50',
            color: 'text-alza-teal-600',
          },
          {
            label: 'Agency Commission',
            value: formatCurrency(client.financials.agencyCommission),
            icon: DollarSign,
            bg: 'bg-violet-50',
            color: 'text-violet-600',
          },
          {
            label: 'Producer Commission',
            value: formatCurrency(client.financials.producerCommission),
            icon: DollarSign,
            bg: 'bg-emerald-50',
            color: 'text-emerald-600',
          },
          {
            label: 'Outstanding Agency Commission',
            value: formatCurrency(client.financials.outstandingAgencyCommission),
            icon: DollarSign,
            bg: 'bg-orange-50',
            color: 'text-orange-600',
          },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{card.label}</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{card.value}</p>
              </div>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-alza-blue-50">
                <FileText className="h-4 w-4 text-alza-blue-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Policy Summary</h2>
            </div>
            {canAddPolicy && (
              <button
                type="button"
                onClick={() => setAddPolicyOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Add Policy
              </button>
            )}
          </div>
        </div>
        {actionSuccess && (
          <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-2 text-sm text-emerald-700">
            {actionSuccess}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {[
                  'Policy Number',
                  'Policy Type',
                  'Carrier / MGA',
                  'Effective Date',
                  'Expiration Date',
                  'Current Policy Premium',
                  'Status',
                  'Transactions',
                ].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {client.policies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No policies found for this client
                  </td>
                </tr>
              ) : (
                client.policies.map((policy) => (
                  <tr key={policy.id} className="hover:bg-alza-blue-50/40">
                    <td className="whitespace-nowrap px-4 py-4 text-sm font-medium">
                      <Link
                        to={`/policies/${policy.id}`}
                        state={withFinancialsReturn(financialsReturnTo)}
                        className="font-semibold text-alza-blue-700 underline-offset-2 hover:underline"
                      >
                        {policy.policyNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">{policy.policyType}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <p>{policy.carrier}</p>
                      <p className="text-xs text-slate-500">{policy.mga}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {formatDate(policy.effectiveDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      {formatDate(policy.expirationDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                      {formatCurrency(policy.totalPremium)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${policyStatusStyles[policy.status]}`}
                      >
                        {policyStatusLabels[policy.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                      <p className="font-semibold tabular-nums text-slate-900">{policy.transactionCount}</p>
                      {policy.transactionCount > 0 && (
                        <p className="text-xs text-slate-500">
                          Vol {formatCurrency(policy.totalPremium)}
                          {policy.latestTransactionDate
                            ? ` · ${formatDate(policy.latestTransactionDate)}`
                            : ''}
                        </p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddPolicyModal
        open={addPolicyOpen}
        onClose={() => setAddPolicyOpen(false)}
        lockedClientId={client.id}
        lockedClientLabel={client.businessName}
        onCreated={async (policyId) => {
          setActionSuccess('Policy created.')
          await loadClient()
          navigate(`/policies/${policyId}`, {
            state: withFinancialsReturn(financialsReturnTo),
          })
        }}
      />

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => !saving && setEditOpen(false)}
          />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Edit Client</h3>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4 px-5 py-4">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Business name *
                </label>
                <input
                  required
                  className={inputClassName}
                  value={editForm.businessName}
                  onChange={(e) => setEditForm((f) => ({ ...f, businessName: e.target.value }))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">DBA</label>
                  <input
                    className={inputClassName}
                    value={editForm.dba}
                    onChange={(e) => setEditForm((f) => ({ ...f, dba: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">FEIN</label>
                  <input
                    className={inputClassName}
                    value={editForm.fein}
                    onChange={(e) => setEditForm((f) => ({ ...f, fein: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                    Contact name
                  </label>
                  <input
                    className={inputClassName}
                    value={editForm.contactName}
                    onChange={(e) => setEditForm((f) => ({ ...f, contactName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Status</label>
                  <select
                    className={selectClassName}
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, status: e.target.value as ClientStatus }))
                    }
                  >
                    {(Object.keys(clientStatusLabels) as ClientStatus[]).map((status) => (
                      <option key={status} value={status}>
                        {clientStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Email</label>
                  <input
                    type="email"
                    className={inputClassName}
                    value={editForm.email}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Phone</label>
                  <input
                    className={inputClassName}
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Mailing address
                </label>
                <textarea
                  rows={2}
                  className={textareaClassName}
                  value={editForm.mailingAddress}
                  onChange={(e) => setEditForm((f) => ({ ...f, mailingAddress: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                  Physical address
                </label>
                <textarea
                  rows={2}
                  className={textareaClassName}
                  value={editForm.physicalAddress}
                  onChange={(e) => setEditForm((f) => ({ ...f, physicalAddress: e.target.value }))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
                    Producer
                  </label>
                  <DirectoryNameSelect
                    kind="producer"
                    value={editForm.producer}
                    onChange={(v) => setEditForm((f) => ({ ...f, producer: v }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">CSR</label>
                  <DirectoryNameSelect
                    kind="csr"
                    value={editForm.csr}
                    onChange={(v) => setEditForm((f) => ({ ...f, csr: v }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Notes</label>
                <textarea
                  rows={3}
                  className={textareaClassName}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg gradient-alza px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-alza-teal-50">
                <MessageSquare className="h-4 w-4 text-alza-teal-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Recent Transactions</h2>
            </div>
          </div>
          {client.recentTransactions.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No transactions recorded for this client yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {client.recentTransactions.map((tx) => (
                <li key={tx.id}>
                  <Link
                    to={`/transactions/${tx.id}`}
                    state={transactionLinkState({
                      returnTo: `/clients/${client.id}`,
                      returnLabel: 'Client',
                      financialsReturnTo,
                    })}
                    className="flex items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-alza-blue-700 hover:underline">
                        {tx.transactionNumber}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {formatTypeLabel(tx.type)} · {tx.policyNumber} · {formatDate(tx.transactionDate)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {formatCurrency(tx.amount)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-alza-blue-50">
                <StickyNote className="h-4 w-4 text-alza-blue-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
            </div>
          </div>
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            No documents uploaded for this client yet.
          </div>
        </div>
      </div>
    </div>
  )
}
