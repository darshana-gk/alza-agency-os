import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, Building2, FileText, Pencil, Plus, RefreshCw, Repeat, Shield, X } from 'lucide-react'
import { DirectoryNameSelect } from '../components/directory/DirectoryNameSelect'
import { AddTransactionModal } from '../components/transactions/AddTransactionModal'
import { RewritePolicyModal } from '../components/policies/RewritePolicyModal'
import { useAuth } from '../lib/auth'
import {
  financialsReturnFromLocation,
  transactionLinkState,
  withFinancialsReturn,
} from '../lib/financialsNav'
import {
  POLICY_STATUSES,
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
  listPolicyFileTerms,
  policyTermFinancialTotals,
  policyTermPath,
  resolveCurrentPolicyPremium,
  resolvePolicyFileTerm,
  toPolicyTermTxn,
} from '../lib/policyPremium'
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
import { parseProducerSplitPercentage } from '../lib/producerSplitValidation'
import { supabase } from '../lib/supabase'
import { loadPolicyRewriteLineage, type PolicyLineageLink } from '../lib/policyRenewRewrite'

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

function formatPolicyTermRange(effectiveDate: string, expirationDate: string): string {
  const start = formatDateSafe(effectiveDate)
  const end = formatDateSafe(expirationDate)
  if (start === '—' && end === '—') return '—'
  return `${start} – ${end}`
}

function RelatedTermSection({
  title,
  rows,
  emptyLabel,
  policyId,
  financialsReturnTo,
}: {
  title: string
  rows: CommissionTransaction[]
  emptyLabel: string
  policyId: string
  financialsReturnTo?: string | null
}) {
  const columns = [
    'Transaction #',
    'Date',
    'Type',
    'Policy #',
    'Term',
    'Amount',
    'Agency Commission',
    'Producer Split %',
    'Producer Commission',
    'Review Status',
    'Producer Payment Status',
  ]
  return (
    <div>
      <div className="border-b border-slate-200 bg-slate-50/80 px-6 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h3>
      </div>
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/50">
            {columns.map((col) => (
              <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((tx) => (
              <tr key={tx.id} className="hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-alza-blue-700">
                  <Link
                    to={`/transactions/${tx.id}`}
                    state={transactionLinkState({
                      returnTo: `/policies/${policyId}`,
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
                <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{tx.policyNumber || '—'}</td>
                <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">
                  {formatPolicyTermRange(tx.policyEffectiveDate, tx.policyExpirationDate)}
                </td>
                <td className={`whitespace-nowrap px-4 py-4 text-sm font-semibold tabular-nums ${tx.amount < 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                  {formatCurrency(tx.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm tabular-nums text-slate-700">{formatCurrency(tx.agencyCommissionAmount)}</td>
                <td className="whitespace-nowrap px-4 py-4 text-sm tabular-nums text-slate-700">{formatPercent(tx.producerSplitPercentage)}</td>
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
  )
}

export function PolicyDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const termParam = searchParams.get('term')
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
  const [renewOpen, setRenewOpen] = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [lineage, setLineage] = useState<{
    rewrittenFrom: PolicyLineageLink | null
    rewrittenTo: PolicyLineageLink[]
  }>({ rewrittenFrom: null, rewrittenTo: [] })
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
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
        clients!policies_client_id_fkey ( business_name, client_number )
      `,
      )
      .eq('id', id)
      .maybeSingle()

    if (policyError) {
      setPolicy(null)
      setTransactions([])
      setLineage({ rewrittenFrom: null, rewrittenTo: [] })
      setError(policyError.message)
      setLoading(false)
      return
    }

    if (!policyRow) {
      setPolicy(null)
      setTransactions([])
      setLineage({ rewrittenFrom: null, rewrittenTo: [] })
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

    const { data: txData, error: txError } = await fetchCommissionTransactionsByPolicy(id)
    if (txError) {
      setTransactions([])
      setError(txError.message)
      setLoading(false)
      return
    }

    setTransactions(txData)
    const lineageRes = await loadPolicyRewriteLineage(id)
    if (!lineageRes.error) {
      setLineage({ rewrittenFrom: lineageRes.rewrittenFrom, rewrittenTo: lineageRes.rewrittenTo })
    } else {
      setLineage({ rewrittenFrom: null, rewrittenTo: [] })
    }
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

  const termViews = useMemo(() => {
    if (!policy) return []
    return listPolicyFileTerms(
      transactions.map((tx) =>
        toPolicyTermTxn({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          archived: tx.archived,
          voidedAt: tx.voidedAt,
          transactionDate: tx.transactionDate,
          createdAt: tx.createdAt,
          transactionEffectiveDate: tx.transactionEffectiveDate,
          transactionExpirationDate: tx.transactionExpirationDate,
          brokerFee: tx.brokerFee,
          agencyCommissionAmount: tx.agencyCommissionAmount,
          producerCommissionAmount: tx.producerCommissionAmount,
          agencyNetCommission: tx.agencyNetCommission,
          policyNumber: tx.policyNumber,
          policyEffectiveDate: tx.policyEffectiveDate,
          policyExpirationDate: tx.policyExpirationDate,
          producer: tx.producer,
          csr: tx.csr,
          carrier: tx.carrier,
          mga: tx.mga,
        }),
      ),
      {
        policyNumber: policy.policyNumber,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        producer: policy.producer,
        csr: policy.csr,
        carrier: policy.carrier,
        mga: policy.mga,
        premium: policy.premium,
      },
      {
        policyEffectiveDate: policy.effectiveDate,
        policyExpirationDate: policy.expirationDate,
      },
    )
  }, [policy, transactions])

  const selectedTerm = useMemo(
    () => resolvePolicyFileTerm(termViews, termParam),
    [termViews, termParam],
  )
  const isCurrentTerm = selectedTerm?.isCurrent !== false

  const termTotals = useMemo(() => {
    return selectedTerm?.totals ?? policyTermFinancialTotals([])
  }, [selectedTerm])

  const relatedById = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions])
  const termTransactions = (selectedTerm?.transactionIds ?? [])
    .map((txnId) => relatedById.get(txnId))
    .filter((tx): tx is CommissionTransaction => Boolean(tx))

  const liveTransactionCount = selectedTerm?.liveTransactionCount ?? 0

  const financialTotals = useMemo(() => {
    const currentPolicyPremium = isCurrentTerm
      ? resolveCurrentPolicyPremium({
          policyPremium: policy?.premium,
          transactionPremiumSum: termTotals.currentPolicyPremium,
          liveTransactionCount,
        })
      : termTotals.currentPolicyPremium
    return { ...termTotals, currentPolicyPremium }
  }, [termTotals, policy?.premium, liveTransactionCount, isCurrentTerm])

  const displayedPolicyNumber = selectedTerm?.policyNumber || policy?.policyNumber || '—'
  const displayedEffectiveDate = selectedTerm?.effectiveDate || policy?.effectiveDate || ''
  const displayedExpirationDate = selectedTerm?.expirationDate || policy?.expirationDate || ''
  const displayedCarrier = selectedTerm?.carrier || policy?.carrier || '—'
  const displayedMga = selectedTerm?.mga || policy?.mga || '—'
  const displayedProducer = selectedTerm?.producer || policy?.producer || '—'
  const displayedCsr = selectedTerm?.csr || policy?.csr || '—'
  const displayedStatus: PolicyStatus = !isCurrentTerm
    ? policy?.status === 'cancelled'
      ? 'cancelled'
      : 'expired'
    : policy?.status ?? 'pending'

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
    const splitParsed = parseProducerSplitPercentage(form.producerSplitPercentage)
    if (!splitParsed.ok) {
      setFormError(splitParsed.error)
      return
    }
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
      unlockFinancials: true,
      commissionType,
      agencyCommissionPercentage:
        commissionType === 'percentage' ? Number(form.agencyCommissionPercentage) : null,
      agencyCommissionAmount:
        commissionType === 'flat' ? Number(form.agencyCommissionAmount) : null,
      brokerFee: Number(form.brokerFee),
      producerSplitPercentage: splitParsed.value,
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
        {canAddTxn && isCurrentTerm && (
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
          <h1 className="text-2xl font-bold text-slate-900">{displayedPolicyNumber}</h1>
          <p className="text-sm text-slate-500">
            {policy.policyType} · {policy.clientName}
            {policy.clientNumber !== '—' ? ` · ${policy.clientNumber}` : ''}
            {displayedEffectiveDate || displayedExpirationDate
              ? ` · ${formatPolicyTermRange(displayedEffectiveDate, displayedExpirationDate)}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${policyStatusStyles[displayedStatus]}`}>
            {policyStatusLabels[displayedStatus]}
          </span>
          {canEdit && isCurrentTerm && (
            <button type="button" onClick={openEdit} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Pencil className="h-4 w-4" />
              Edit Policy
            </button>
          )}
          {canAddTxn && isCurrentTerm && (
            <button
              type="button"
              onClick={() => setRenewOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Renew
            </button>
          )}
          {canEdit && canAddTxn && isCurrentTerm && (
            <button
              type="button"
              onClick={() => setRewriteOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Repeat className="h-4 w-4" />
              Rewrite
            </button>
          )}
          {canAddTxn && isCurrentTerm && (
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

      {!isCurrentTerm && selectedTerm ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Viewing a prior term ({selectedTerm.policyNumber}
          {displayedEffectiveDate || displayedExpirationDate
            ? `, ${formatPolicyTermRange(displayedEffectiveDate, displayedExpirationDate)}`
            : ''}
          ). This page shows only that term’s transactions.
          {termViews.find((term) => term.isCurrent) ? (
            <>
              {' '}
              <Link
                to={policyTermPath(policy.id, termViews.find((term) => term.isCurrent)?.termId)}
                className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
              >
                Open current term ({termViews.find((term) => term.isCurrent)?.policyNumber})
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {termViews.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {termViews.map((term) => (
            <Link
              key={term.termId}
              to={policyTermPath(policy.id, term.termId)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                selectedTerm?.termId === term.termId
                  ? 'bg-alza-blue-50 text-alza-blue-800 ring-alza-blue-600/20'
                  : 'bg-white text-slate-600 ring-slate-200 hover:text-alza-blue-700'
              }`}
            >
              {formatPolicyTermRange(term.effectiveDate, term.expirationDate)} · {term.policyNumber}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
            <Shield className="h-5 w-5 text-alza-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Policy Information</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Policy Number" value={displayedPolicyNumber} />
          <InfoField label="Client" value={policy.clientName} />
          <InfoField label="Policy Type" value={policy.policyType} />
          <InfoField label="Carrier" value={displayedCarrier} />
          <InfoField label="MGA" value={displayedMga} />
          <InfoField label="Effective Date" value={formatDateSafe(displayedEffectiveDate)} />
          <InfoField label="Expiration Date" value={formatDateSafe(displayedExpirationDate)} />
          <InfoField label="Status" value={policyStatusLabels[displayedStatus]} />
          <InfoField label="Producer" value={displayedProducer} />
          <InfoField label="CSR" value={displayedCsr} />
          <InfoField
            label="Current Policy Premium"
            value={formatCurrency(financialTotals.currentPolicyPremium)}
          />
          <InfoField label="Transactions this term" value={String(selectedTerm?.transactionIds.length ?? 0)} />
          <InfoField label="Client #" value={policy.clientNumber} />
          {selectedTerm?.priorTermId ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Prior term</p>
              <p className="mt-1 text-sm">
                <Link
                  to={policyTermPath(policy.id, selectedTerm.priorTermId)}
                  className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
                >
                  {termViews.find((term) => term.termId === selectedTerm.priorTermId)?.policyNumber || 'Open prior term'}
                </Link>
              </p>
            </div>
          ) : null}
          {selectedTerm?.nextTermId ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Renewed to</p>
              <p className="mt-1 text-sm">
                <Link
                  to={policyTermPath(policy.id, selectedTerm.nextTermId)}
                  className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
                >
                  {termViews.find((term) => term.termId === selectedTerm.nextTermId)?.policyNumber || 'Open next term'}
                </Link>
              </p>
            </div>
          ) : null}
          {lineage.rewrittenFrom ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Rewritten from</p>
              <p className="mt-1 text-sm">
                <Link
                  to={`/policies/${lineage.rewrittenFrom.id}`}
                  className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
                >
                  {lineage.rewrittenFrom.policyNumber}
                </Link>
              </p>
            </div>
          ) : null}
          {lineage.rewrittenTo.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Rewritten to</p>
              <p className="mt-1 text-sm">
                {lineage.rewrittenTo.map((link, i) => (
                  <span key={link.id}>
                    {i > 0 ? ', ' : ''}
                    <Link
                      to={`/policies/${link.id}`}
                      className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
                    >
                      {link.policyNumber}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          ) : null}
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
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Financial Totals</h2>
        <p className="mb-5 text-xs text-slate-500">
          Totals on this page use only transactions that belong to the selected policy term.
          Voided and archived transactions are excluded from money totals. Imported reference
          premium is shown only when this is the current term and it has no live transactions.
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField
            label="Current Policy Premium"
            value={formatCurrency(financialTotals.currentPolicyPremium)}
          />
          <InfoField label="Total Broker Fees" value={formatCurrency(financialTotals.totalBrokerFees)} />
          <InfoField
            label="Total Agency Commission"
            value={formatCurrency(financialTotals.totalAgencyCommission)}
          />
          <InfoField
            label="Total Commission Pool"
            value={formatCurrency(financialTotals.totalCommissionPool)}
          />
          <InfoField
            label="Total Producer Commission"
            value={formatCurrency(financialTotals.totalProducerCommission)}
          />
          <InfoField
            label="Agency Net Commission"
            value={formatCurrency(financialTotals.totalAgencyNet)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold text-slate-900">Commission Setup</h2>
        {isCurrentTerm ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Commission Basis" value={formatCommissionTypeLabel(policy.commissionType)} />
          {policy.commissionType === 'percentage' ? (
            <InfoField label="Agency Commission %" value={formatPercent(policy.agencyCommissionPercentage)} />
          ) : (
            <InfoField
              label="Default Agency Commission Amount"
              value={formatCurrency(policy.agencyCommissionAmount)}
            />
          )}
          <InfoField label="Default Broker Fee" value={formatCurrency(policy.brokerFee)} />
          <InfoField label="Producer" value={policy.producer} />
          <InfoField label="Producer Split %" value={formatPercent(policy.producerSplitPercentage)} />
          <InfoField label="Override split" value={policy.overrideSplit ? 'Yes' : 'No'} />
        </div>
        ) : (
          <p className="text-sm text-slate-600">
            Commission setup for new transactions lives on the current term.
          </p>
        )}
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
                <p className="text-xs text-slate-500">This term only · {displayedPolicyNumber}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {canAddTxn && isCurrentTerm && (
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
          {termTransactions.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No transactions recorded for this term.</p>
          ) : (
            <RelatedTermSection
              title="This term"
              rows={termTransactions}
              emptyLabel="No transactions recorded for this term."
              policyId={policy.id}
              financialsReturnTo={financialsReturnTo}
            />
          )}
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
                <p className="mb-2 text-sm font-semibold text-slate-900">Commission Defaults</p>
                <p className="mb-3 text-sm text-slate-600">
                  Changing defaults does not recalculate historical transactions. Default Broker Fee is inherited by new transactions.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Commission Basis</span>
                    <div className="flex flex-wrap gap-2">
                      {(['percentage', 'flat'] as CommissionType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, commissionType: type }))}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
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
                      <input type="number" min="0" step="0.01" value={form.agencyCommissionPercentage} onChange={(e) => setForm((p) => ({ ...p, agencyCommissionPercentage: e.target.value }))} className={inputClassName} />
                    </label>
                  ) : (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-slate-500">Default Agency Commission Amount</span>
                      <input type="number" step="0.01" value={form.agencyCommissionAmount} onChange={(e) => setForm((p) => ({ ...p, agencyCommissionAmount: e.target.value }))} className={inputClassName} />
                    </label>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Default Broker Fee</span>
                    <input type="number" step="0.01" value={form.brokerFee} onChange={(e) => setForm((p) => ({ ...p, brokerFee: e.target.value }))} className={inputClassName} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">
                      Producer Split % <span className="text-red-500">*</span>
                    </span>
                    <input type="number" min="0" max="100" step="0.01" value={form.producerSplitPercentage} onChange={(e) => setForm((p) => ({ ...p, producerSplitPercentage: e.target.value }))} className={inputClassName} />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.overrideSplit} onChange={(e) => setForm((p) => ({ ...p, overrideSplit: e.target.checked }))} />
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
      <AddTransactionModal
        open={renewOpen}
        mode="renew"
        onClose={() => setRenewOpen(false)}
        lockedClientId={policy.clientId || undefined}
        lockedClientLabel={policy.clientName}
        lockedPolicyId={policy.id}
        lockedPolicyLabel={policy.policyNumber}
        onCreated={async () => {
          setRenewOpen(false)
          setActionSuccess('Renewal saved. The new term is now the current policy-term entry.')
          await load()
          navigate(`/policies/${policy.id}`)
        }}
      />
      <RewritePolicyModal
        open={rewriteOpen}
        sourcePolicyId={policy.id}
        onClose={() => setRewriteOpen(false)}
        onCreated={(policyId) => {
          setRewriteOpen(false)
          setActionSuccess('Rewritten policy created.')
          navigate(`/policies/${policyId}`)
        }}
      />
    </div>
  )
}
