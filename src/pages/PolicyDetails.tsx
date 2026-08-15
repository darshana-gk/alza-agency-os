import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, Building2, FileText, Pencil, Plus, Shield, X } from 'lucide-react'
import { DirectoryNameSelect } from '../components/directory/DirectoryNameSelect'
import { AddTransactionModal } from '../components/transactions/AddTransactionModal'
import { useAuth } from '../lib/auth'
import {
  financialsReturnFromLocation,
  transactionLinkState,
  withFinancialsReturn,
} from '../lib/financialsNav'
import {
  derivePolicyCommission,
  POLICY_STATUSES,
  policyHasLockedFinancialHistory,
  updatePolicy,
  type PolicyStatusValue,
} from '../lib/directory'
import {
  canManagePolicies,
  canManageTransactions,
  isProducerBookScoped,
  producerKeysMatch,
  roleInputFromProfile,
} from '../lib/permissions'
import {
  fetchCommissionTransactionsByPolicy,
  formatCommissionTypeLabel,
  formatCurrency,
  formatDate,
  formatLabel,
  formatPercent,
  formatTypeLabel,
  normalizeCommissionType,
  paymentStatusStyles,
  reviewStatusStyles,
  typeStyles,
  type CommissionTransaction,
  type CommissionType,
} from '../lib/commission'
import { supabase } from '../lib/supabase'

type PolicyStatus = PolicyStatusValue

interface PolicyDetail {
  id: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  effectiveDate: string
  expirationDate: string
  premium: number
  status: PolicyStatus
  clientId: string
  clientName: string
  clientNumber: string
  producer: string
  csr: string
  notes: string
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  commissionPool: number
  producerSplitPercentage: number
  producerCommissionAmount: number
  agencyNetCommission: number
  overrideSplit: boolean
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

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function display(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : '—'
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
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

function formatDateSafe(dateStr: string): string {
  if (!dateStr || dateStr === '—') return '—'
  return formatDate(dateStr)
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-900">{value}</p>
    </div>
  )
}

export function PolicyDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const financialsReturnTo = financialsReturnFromLocation(location)
  const { profile } = useAuth()
  const roleInput = roleInputFromProfile(profile)
  const canEdit = canManagePolicies(roleInput)
  const canAddTxn = canManageTransactions(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const [policy, setPolicy] = useState<PolicyDetail | null>(null)
  const [transactions, setTransactions] = useState<CommissionTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [addTxnOpen, setAddTxnOpen] = useState(false)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [financialsLocked, setFinancialsLocked] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    policyNumber: '',
    policyType: '',
    carrier: '',
    mga: '',
    producer: '',
    csr: '',
    effectiveDate: '',
    expirationDate: '',
    status: 'pending' as PolicyStatus,
    notes: '',
    premium: '',
    commissionType: 'percentage' as CommissionType,
    agencyCommissionPercentage: '',
    agencyCommissionAmount: '',
    brokerFee: '0',
    producerSplitPercentage: '',
    overrideSplit: false,
  })

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setNotFound(false)

    const { data: policyRow, error: policyError } = await supabase
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
        status,
        notes,
        commission_type,
        agency_commission_percentage,
        agency_commission_amount,
        broker_fee,
        producer_split_percentage,
        producer_commission_amount,
        agency_net_commission,
        override_split,
        clients ( business_name, client_number )
      `,
      )
      .eq('id', id)
      .maybeSingle()

    if (policyError) {
      setPolicy(null)
      setTransactions([])
      setError(policyError.message)
      setLoading(false)
      return
    }

    if (!policyRow) {
      setPolicy(null)
      setTransactions([])
      setNotFound(true)
      setLoading(false)
      return
    }

    const client = firstEmbed(
      policyRow.clients as
        | { business_name: string | null; client_number: string | null }
        | { business_name: string | null; client_number: string | null }[]
        | null,
    )
    const agencyAmount = toNumber(policyRow.agency_commission_amount as number | string | null)
    const brokerFee = toNumber(policyRow.broker_fee as number | string | null)
    const pctRaw = policyRow.agency_commission_percentage as number | string | null
    const mapped: PolicyDetail = {
      id: policyRow.id as string,
      policyNumber: display(policyRow.policy_number as string | null),
      policyType: display(policyRow.policy_type as string | null),
      carrier: display(policyRow.carrier as string | null),
      mga: display(policyRow.mga as string | null),
      effectiveDate: String(policyRow.effective_date ?? '').trim(),
      expirationDate: String(policyRow.expiration_date ?? '').trim(),
      premium: toNumber(policyRow.premium as number | string | null),
      status: normalizePolicyStatus(policyRow.status as string | null),
      clientId: (policyRow.client_id as string | null) ?? '',
      clientName: display(client?.business_name),
      clientNumber: display(client?.client_number),
      producer: display(policyRow.producer as string | null),
      csr: display(policyRow.csr as string | null),
      notes: String(policyRow.notes ?? '').trim(),
      commissionType: normalizeCommissionType(policyRow.commission_type as string | null),
      agencyCommissionPercentage:
        pctRaw === null || pctRaw === undefined || pctRaw === ''
          ? null
          : toNumber(pctRaw),
      agencyCommissionAmount: agencyAmount,
      brokerFee,
      commissionPool: agencyAmount + brokerFee,
      producerSplitPercentage: toNumber(policyRow.producer_split_percentage as number | string | null),
      producerCommissionAmount: toNumber(policyRow.producer_commission_amount as number | string | null),
      agencyNetCommission: toNumber(policyRow.agency_net_commission as number | string | null),
      overrideSplit: Boolean(policyRow.override_split),
    }

    if (producerLocked && !producerKeysMatch(mapped.producer, profile?.fullName)) {
      setPolicy(null)
      setNotFound(true)
      setError('You do not have permission to access this policy record.')
      setLoading(false)
      return
    }

    setPolicy(mapped)

    const lock = await policyHasLockedFinancialHistory(id)
    setFinancialsLocked(Boolean(lock.locked))

    const { data: txData, error: txError } = await fetchCommissionTransactionsByPolicy(id)
    if (txError) {
      setTransactions([])
      setError(txError.message)
      setLoading(false)
      return
    }

    setTransactions(txData)
    setLoading(false)
  }, [id, producerLocked, profile?.fullName])

  useEffect(() => {
    void load()
  }, [load])

  const transactionsHref = useMemo(() => {
    if (!policy) return '/transactions'
    const params = new URLSearchParams()
    if (policy.clientId) params.set('client', policy.clientId)
    params.set('policy', policy.id)
    return `/transactions?${params.toString()}`
  }, [policy])

  const editDerived = useMemo(() => {
    const premium = Number(form.premium)
    const splitPct = Number(form.producerSplitPercentage)
    const brokerFee = Number(form.brokerFee)
    const commissionType = normalizeCommissionType(form.commissionType)
    if (!Number.isFinite(premium) || premium < 0 || !Number.isFinite(splitPct) || splitPct < 0) return null
    if (!Number.isFinite(brokerFee)) return null
    if (commissionType === 'percentage') {
      const agencyPct = Number(form.agencyCommissionPercentage)
      if (!Number.isFinite(agencyPct) || agencyPct < 0) return null
      return derivePolicyCommission(premium, agencyPct, splitPct, brokerFee, 'percentage', null)
    }
    const flat = Number(form.agencyCommissionAmount)
    if (!Number.isFinite(flat)) return null
    return derivePolicyCommission(premium, null, splitPct, brokerFee, 'flat', flat)
  }, [
    form.premium,
    form.commissionType,
    form.agencyCommissionPercentage,
    form.agencyCommissionAmount,
    form.brokerFee,
    form.producerSplitPercentage,
  ])

  function openEdit() {
    if (!policy || !canEdit) return
    setForm({
      policyNumber: policy.policyNumber === '—' ? '' : policy.policyNumber,
      policyType: policy.policyType === '—' ? '' : policy.policyType,
      carrier: policy.carrier === '—' ? '' : policy.carrier,
      mga: policy.mga === '—' ? '' : policy.mga,
      producer: policy.producer === '—' ? '' : policy.producer,
      csr: policy.csr === '—' ? '' : policy.csr,
      effectiveDate: policy.effectiveDate,
      expirationDate: policy.expirationDate,
      status: policy.status,
      notes: policy.notes,
      premium: String(policy.premium),
      commissionType: policy.commissionType,
      agencyCommissionPercentage:
        policy.agencyCommissionPercentage === null ? '' : String(policy.agencyCommissionPercentage),
      agencyCommissionAmount: String(policy.agencyCommissionAmount),
      brokerFee: String(policy.brokerFee),
      producerSplitPercentage: String(policy.producerSplitPercentage),
      overrideSplit: policy.overrideSplit,
    })
    setFormError(null)
    setEditOpen(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!policy || !canEdit || saving) return
    setSaving(true)
    setFormError(null)
    const commissionType = normalizeCommissionType(form.commissionType)
    const result = await updatePolicy({
      policyId: policy.id,
      policyNumber: form.policyNumber,
      policyType: form.policyType,
      carrier: form.carrier,
      mga: form.mga,
      producer: form.producer,
      csr: form.csr,
      effectiveDate: form.effectiveDate,
      expirationDate: form.expirationDate,
      status: form.status,
      notes: form.notes,
      unlockFinancials: !financialsLocked,
      premium: Number(form.premium),
      commissionType,
      agencyCommissionPercentage:
        commissionType === 'percentage' ? Number(form.agencyCommissionPercentage) : null,
      agencyCommissionAmount:
        commissionType === 'flat' ? Number(form.agencyCommissionAmount) : null,
      brokerFee: Number(form.brokerFee),
      producerSplitPercentage: Number(form.producerSplitPercentage),
      overrideSplit: form.overrideSplit,
    })
    setSaving(false)
    if (result.error) {
      setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
      return
    }
    setEditOpen(false)
    await load()
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <p className="text-sm text-slate-500">Loading policy…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <FileText className="mx-auto h-12 w-12 text-slate-300" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Unable to load policy</h2>
        <p className="mt-2 text-sm text-slate-500">{error}</p>
        <Link to="/policy-files" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-alza-blue-600 hover:text-alza-blue-700">
          <ArrowLeft className="h-4 w-4" />
          Back to Policy Files
        </Link>
      </div>
    )
  }

  if (notFound || !policy) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <FileText className="mx-auto h-12 w-12 text-slate-300" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Policy not found</h2>
        <p className="mt-2 text-sm text-slate-500">The requested policy record does not exist.</p>
        <Link to="/policy-files" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-alza-blue-600 hover:text-alza-blue-700">
          <ArrowLeft className="h-4 w-4" />
          Back to Policy Files
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
        ) : null}
        {policy.clientId ? (
          <Link
            to={`/clients/${policy.clientId}`}
            state={withFinancialsReturn(financialsReturnTo)}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-alza-blue-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Client
          </Link>
        ) : null}
        <Link
          to="/policy-files"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-alza-blue-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Policy Files
        </Link>
        {canAddTxn && (
          <button
            type="button"
            onClick={() => setAddTxnOpen(true)}
            className="inline-flex items-center gap-2 text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
          >
            <Plus className="h-4 w-4" />
            Add Transaction
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate(transactionsHref)}
          className="inline-flex items-center gap-2 text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
        >
          <ArrowLeftRight className="h-4 w-4" />
          View Transactions
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{policy.policyNumber}</h1>
          <p className="text-sm text-slate-500">
            {policy.policyType} · {policy.clientName}
            {policy.clientNumber !== '—' ? ` · ${policy.clientNumber}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${policyStatusStyles[policy.status]}`}>
            {policyStatusLabels[policy.status]}
          </span>
          {canEdit && (
            <button type="button" onClick={openEdit} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Pencil className="h-4 w-4" />
              Edit Policy
            </button>
          )}
          {canAddTxn && (
            <button
              type="button"
              onClick={() => setAddTxnOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Add Transaction
            </button>
          )}
          <button type="button" onClick={() => navigate(transactionsHref)} className="inline-flex items-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90">
            <ArrowLeftRight className="h-4 w-4" />
            View Transactions
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
            <Shield className="h-5 w-5 text-alza-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Policy Information</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Policy Number" value={policy.policyNumber} />
          <InfoField label="Client" value={policy.clientName} />
          <InfoField label="Policy Type" value={policy.policyType} />
          <InfoField label="Carrier" value={policy.carrier} />
          <InfoField label="MGA" value={policy.mga} />
          <InfoField label="Effective Date" value={formatDateSafe(policy.effectiveDate)} />
          <InfoField label="Expiration Date" value={formatDateSafe(policy.expirationDate)} />
          <InfoField label="Status" value={policyStatusLabels[policy.status]} />
          <InfoField label="Producer" value={policy.producer} />
          <InfoField label="CSR" value={policy.csr} />
          <InfoField label="Premium" value={formatCurrency(policy.premium)} />
          <InfoField label="Client #" value={policy.clientNumber} />
        </div>
        {policy.notes && (
          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{policy.notes}</p>
          </div>
        )}
        {policy.clientId && (
          <div className="mt-5">
            <Link
              to={`/clients/${policy.clientId}`}
              state={withFinancialsReturn(financialsReturnTo)}
              className="inline-flex items-center gap-2 text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
            >
              <Building2 className="h-4 w-4" />
              Open client record
            </Link>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold text-slate-900">Commission Setup</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Commission Basis" value={formatCommissionTypeLabel(policy.commissionType)} />
          {policy.commissionType === 'percentage' && (
            <InfoField label="Agency Commission %" value={formatPercent(policy.agencyCommissionPercentage)} />
          )}
          <InfoField label="Agency Commission Amount" value={formatCurrency(policy.agencyCommissionAmount)} />
          <InfoField label="Broker Fee" value={formatCurrency(policy.brokerFee)} />
          <InfoField label="Commission Pool" value={formatCurrency(policy.commissionPool)} />
          <InfoField label="Producer" value={policy.producer} />
          <InfoField label="Producer Split %" value={formatPercent(policy.producerSplitPercentage)} />
          <InfoField label="Producer Commission" value={formatCurrency(policy.producerCommissionAmount)} />
          <InfoField label="Agency Net Commission" value={formatCurrency(policy.agencyNetCommission)} />
          <InfoField label="Override split" value={policy.overrideSplit ? 'Yes' : 'No'} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-alza-teal-50">
                <ArrowLeftRight className="h-4 w-4 text-alza-teal-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Related Transactions</h2>
                <p className="text-xs text-slate-500">Live from transactions.policy_id = {policy.id.slice(0, 8)}…</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {canAddTxn && (
                <button
                  type="button"
                  onClick={() => setAddTxnOpen(true)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
                >
                  <Plus className="h-4 w-4" />
                  Add Transaction
                </button>
              )}
              <button type="button" onClick={() => navigate(transactionsHref)} className="text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800">
                View Transactions
              </button>
            </div>
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
                {['Transaction #', 'Date', 'Type', 'Amount', 'Agency Commission', 'Producer Commission', 'Review Status', 'Producer Payment Status'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No transactions recorded for this policy.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-alza-blue-700">
                      <Link
                        to={`/transactions/${tx.id}`}
                        state={transactionLinkState({
                          returnTo: `/policies/${policy.id}`,
                          returnLabel: 'Policy',
                          financialsReturnTo,
                        })}
                      >
                        {tx.transactionNumber || '—'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{formatDateSafe(tx.transactionDate)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${typeStyles[tx.type] ?? typeStyles.new_policy_premium}`}>
                        {formatTypeLabel(tx.type)}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-4 py-4 text-sm font-semibold tabular-nums ${tx.amount < 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm tabular-nums text-slate-700">{formatCurrency(tx.agencyCommissionAmount)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm tabular-nums text-slate-700">{formatCurrency(tx.producerCommissionAmount)}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${reviewStatusStyles[tx.reviewStatus] ?? 'bg-slate-100 text-slate-700 ring-slate-500/20'}`}>
                        {formatLabel(tx.reviewStatus)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${paymentStatusStyles[tx.producerPaymentStatus]}`}>
                        {formatLabel(tx.producerPaymentStatus)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close" onClick={() => !saving && setEditOpen(false)} />
          <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Edit Policy</h3>
                <p className="mt-1 text-sm text-slate-500">Updates public.policies. Does not recalculate historical transactions.</p>
              </div>
              <button type="button" disabled={saving} onClick={() => setEditOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Policy number</span>
                  <input required value={form.policyNumber} onChange={(e) => setForm((p) => ({ ...p, policyNumber: e.target.value }))} className={inputClassName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Type / line</span>
                  <input value={form.policyType} onChange={(e) => setForm((p) => ({ ...p, policyType: e.target.value }))} className={inputClassName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Carrier</span>
                  <input value={form.carrier} onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))} className={inputClassName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">MGA</span>
                  <input value={form.mga} onChange={(e) => setForm((p) => ({ ...p, mga: e.target.value }))} className={inputClassName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Producer</span>
                  <DirectoryNameSelect kind="producer" value={form.producer} onChange={(v) => setForm((p) => ({ ...p, producer: v }))} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">CSR</span>
                  <DirectoryNameSelect kind="csr" value={form.csr} onChange={(v) => setForm((p) => ({ ...p, csr: v }))} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Effective date</span>
                  <input type="date" value={form.effectiveDate} onChange={(e) => setForm((p) => ({ ...p, effectiveDate: e.target.value }))} className={inputClassName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Expiration date</span>
                  <input type="date" value={form.expirationDate} onChange={(e) => setForm((p) => ({ ...p, expirationDate: e.target.value }))} className={inputClassName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Status</span>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as PolicyStatus }))} className={selectClassName}>
                    {POLICY_STATUSES.map((status) => (
                      <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <p className="mb-2 text-sm font-semibold text-slate-900">Commission / premium</p>
                {financialsLocked ? (
                  <p className="mb-3 text-sm text-amber-800">
                    Premium and commission fields are locked because this policy has linked transactions that are confirmed, batched, or paid. Historical transaction money is not recalculated.
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Premium</span>
                    <input disabled={financialsLocked} type="number" min="0" step="0.01" value={form.premium} onChange={(e) => setForm((p) => ({ ...p, premium: e.target.value }))} className={`${inputClassName} ${financialsLocked ? 'bg-slate-100' : ''}`} />
                  </label>
                  <div className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Commission Basis</span>
                    <div className="flex flex-wrap gap-2">
                      {(['percentage', 'flat'] as CommissionType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          disabled={financialsLocked}
                          onClick={() => setForm((p) => ({ ...p, commissionType: type }))}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                            form.commissionType === type
                              ? 'border-alza-blue-300 bg-alza-blue-50 text-alza-blue-800'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          {formatCommissionTypeLabel(type)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.commissionType === 'percentage' ? (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency Commission %</span>
                      <input disabled={financialsLocked} type="number" min="0" step="0.01" value={form.agencyCommissionPercentage} onChange={(e) => setForm((p) => ({ ...p, agencyCommissionPercentage: e.target.value }))} className={`${inputClassName} ${financialsLocked ? 'bg-slate-100' : ''}`} />
                    </label>
                  ) : (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency Commission Amount</span>
                      <input disabled={financialsLocked} type="number" step="0.01" value={form.agencyCommissionAmount} onChange={(e) => setForm((p) => ({ ...p, agencyCommissionAmount: e.target.value }))} className={`${inputClassName} ${financialsLocked ? 'bg-slate-100' : ''}`} />
                    </label>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Broker Fee</span>
                    <input disabled={financialsLocked} type="number" step="0.01" value={form.brokerFee} onChange={(e) => setForm((p) => ({ ...p, brokerFee: e.target.value }))} className={`${inputClassName} ${financialsLocked ? 'bg-slate-100' : ''}`} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Producer Split %</span>
                    <input disabled={financialsLocked} type="number" min="0" step="0.01" value={form.producerSplitPercentage} onChange={(e) => setForm((p) => ({ ...p, producerSplitPercentage: e.target.value }))} className={`${inputClassName} ${financialsLocked ? 'bg-slate-100' : ''}`} />
                  </label>
                </div>
                {!financialsLocked && editDerived && (
                  <div className="mt-3 grid gap-1.5 text-sm text-slate-700 sm:grid-cols-2">
                    <p>Agency Commission: <span className="font-semibold">{formatCurrency(editDerived.agencyCommissionAmount)}</span></p>
                    <p>Broker Fee: <span className="font-semibold">{formatCurrency(editDerived.brokerFee)}</span></p>
                    <p>Commission Pool: <span className="font-semibold">{formatCurrency(editDerived.commissionPool)}</span></p>
                    <p>Producer Share: <span className="font-semibold">{formatCurrency(editDerived.producerCommissionAmount)}</span></p>
                    <p>Agency Net: <span className="font-semibold">{formatCurrency(editDerived.agencyNetCommission)}</span></p>
                  </div>
                )}
                <label className={`mt-3 flex items-center gap-2 text-sm ${financialsLocked ? 'text-slate-400' : 'text-slate-700'}`}>
                  <input disabled={financialsLocked} type="checkbox" checked={form.overrideSplit} onChange={(e) => setForm((p) => ({ ...p, overrideSplit: e.target.checked }))} />
                  Override split
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={textareaClassName} />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" disabled={saving} onClick={() => setEditOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AddTransactionModal
        open={addTxnOpen}
        onClose={() => setAddTxnOpen(false)}
        lockedClientId={policy.clientId || undefined}
        lockedClientLabel={policy.clientName}
        lockedPolicyId={policy.id}
        lockedPolicyLabel={policy.policyNumber}
        onCreated={async () => {
          setAddTxnOpen(false)
          setActionSuccess('Transaction created. Related list refreshed.')
          await load()
        }}
      />
    </div>
  )
}
