import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react'
import {
  badgeClass,
  approveTransactionReview,
  archiveTransaction,
  canApproveTransactionReview,
  canArchiveTransaction,
  canEditTransaction,
  canEditTransactionCommission,
  canCorrectReturnedTransaction,
  canReturnTransactionForCorrection,
  canSubmitTransactionForReview,
  canVoidTransaction,
  confirmAgencyCommissionReceived,
  createProducerRecovery,
  deriveCommission,
  fetchCommissionTransactions,
  fetchRelatedReturnPremiums,
  formatCommissionTypeLabel,
  formatCurrency,
  formatDate,
  formatLabel,
  formatPercent,
  formatProducerSplitSourceLabel,
  formatRecoveryOutcomeLabel,
  formatReviewStatusLabel,
  formatTransactionRecoverySettledLabel,
  formatTypeLabel,
  getTransactionWorkflowStatus,
  getTransactionWorkflowTimeline,
  isCorrectionRequired,
  isOperationallyPendingTransaction,
  isReadyForPayout,
  canMarkProducerCommissionReady,
  markReadyBlockedReason,
  markProducerCommissionReady,
  normalizeCommissionType,
  paymentStatusStyles,
  PRODUCER_PAYMENT_STATUSES,
  recordDirectRecoveryPayment,
  REVIEW_STATUSES,
  reviewStatusStyles,
  returnTransactionForCorrection,
  submitTransactionForReview,
  availableRecoveryAmount,
  sumCreatedRecoveryAmounts,
  todayIsoDate,
  transactionRecoveryObligation,
  typeStyles,
  TRANSACTION_TYPES_FOR_CREATE,
  updateTransactionMetadata,
  voidTransaction,
  workflowStatusStyles,
  type CommissionTransaction,
  type CommissionType,
} from '../lib/commission'
import { useAuth } from '../lib/auth'
import { transactionExportColumns } from '../lib/exportDefinitions'
import { downloadTableExport } from '../lib/tableExport'
import { ExportMenu } from '../components/ui/ExportMenu'
import {
  financialsLinkState,
  transactionLinkState,
  txnReturnFromLocation,
  withFinancialsReturn,
} from '../lib/financialsNav'
import {
  canActOnAssignedReview,
  canApproveTransactions,
  canConfirmReceipts,
  canManageRecoveries,
  canManageTransactions,
  canMarkProducerReady,
  canSubmitTransactionReview,
  csrAssignmentMatches,
  isAdminDirectoryRole,
  isOpsMutatorRole,
  isProducerBookScoped,
  producerKeysMatch,
  resolveProducerBookName,
  roleInputFromProfile,
  toAppRoles,
} from '../lib/permissions'
import { fetchActiveReviewers, type ReviewerOption } from '../lib/reviewers'
import { DirectoryNameSelect } from '../components/directory/DirectoryNameSelect'
import { EntityActivityHistory } from '../components/activity/EntityActivityHistory'
import { SupportingDocumentsPanel } from '../components/activity/SupportingDocumentsPanel'
import { AddTransactionModal } from '../components/transactions/AddTransactionModal'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 10
const ALL = 'all'

const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

interface RecoverySummary {
  id: string
  recoveryNumber: string | null
  amount: number
  status: string
  notes: string
  createdAt: string
  remainingAmount: number
  appliedAmount: number
  voidedAt: string | null
}

function mapRecoveryRows(
  data: Array<Record<string, unknown>> | null | undefined,
): RecoverySummary[] {
  return (data ?? []).map((row) => {
    const amount = Number(row.amount ?? 0)
    const remainingRaw = row.remaining_amount
    const remainingAmount =
      remainingRaw === null || remainingRaw === undefined ? amount : Number(remainingRaw)
    const recoveryNumberRaw = row.recovery_number
    return {
      id: String(row.id),
      recoveryNumber:
        recoveryNumberRaw === null || recoveryNumberRaw === undefined
          ? null
          : String(recoveryNumberRaw).trim() || null,
      amount,
      status: String(row.status ?? 'open'),
      notes: String(row.notes ?? ''),
      createdAt: String(row.created_at ?? ''),
      remainingAmount: Number.isFinite(remainingAmount) ? remainingAmount : amount,
      appliedAmount: Number(row.applied_amount ?? 0) || 0,
      voidedAt: row.voided_at ? String(row.voided_at) : null,
    }
  })
}

const RECOVERY_SELECT =
  'id, recovery_number, amount, status, notes, created_at, remaining_amount, applied_amount, voided_at'

export function Transactions() {
  const { profile } = useAuth()
  const roleInput = roleInputFromProfile(profile)
  const canMutate = canManageTransactions(roleInput)
  const canConfirm = canConfirmReceipts(roleInput)
  const canSubmitReview = canSubmitTransactionReview(roleInput)
  const canApprove = canApproveTransactions(roleInput)
  const canReady = canMarkProducerReady(roleInput)
  const canRecovery = canManageRecoveries(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const { id: routeTxnId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [transactions, setTransactions] = useState<CommissionTransaction[]>([])
  const [producerScopeLimitation, setProducerScopeLimitation] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState(searchParams.get('year') || ALL)
  const [clientFilter, setClientFilter] = useState(searchParams.get('client') || ALL)
  const [policyFilter, setPolicyFilter] = useState(searchParams.get('policy') || ALL)
  const [producerFilter, setProducerFilter] = useState(searchParams.get('producer') || ALL)
  const [csrFilter, setCsrFilter] = useState(searchParams.get('csr') || ALL)
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || ALL)
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || ALL)
  const [reviewFilter, setReviewFilter] = useState(searchParams.get('review') || ALL)
  const [paymentFilter, setPaymentFilter] = useState(searchParams.get('payment') || ALL)
  const [confirmedFilter, setConfirmedFilter] = useState(searchParams.get('confirmed') || ALL)
  const [correctionFilter, setCorrectionFilter] = useState(searchParams.get('correction') || ALL)
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') || '')
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || '')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(routeTxnId ?? null)
  const [recoveries, setRecoveries] = useState<RecoverySummary[]>([])
  const [recoveriesLoading, setRecoveriesLoading] = useState(false)
  const [recoveryCreatedByTxn, setRecoveryCreatedByTxn] = useState<Map<string, number>>(new Map())

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [readyOpen, setReadyOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [submitReviewOpen, setSubmitReviewOpen] = useState(false)
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([])
  const [editReviewerUserId, setEditReviewerUserId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [addTxnOpen, setAddTxnOpen] = useState(false)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [receivedAmount, setReceivedAmount] = useState('')
  const [receivedDate, setReceivedDate] = useState(todayIsoDate())
  const [source, setSource] = useState('')
  const [depositReference, setDepositReference] = useState('')
  const [externalInvoiceId, setExternalInvoiceId] = useState('')
  const [receiptNotes, setReceiptNotes] = useState('')
  const [varianceAck, setVarianceAck] = useState(false)

  const [recoveryAmount, setRecoveryAmount] = useState('')
  const [recoveryNotes, setRecoveryNotes] = useState('')
  const [recoverySettlementMethod, setRecoverySettlementMethod] = useState<
    'next_payout' | 'direct_payment'
  >('next_payout')
  const [recoveryAssistOpen, setRecoveryAssistOpen] = useState(false)

  const [relatedReturns, setRelatedReturns] = useState<
    Array<{ id: string; number: string; amount: number }>
  >([])
  const [originalTxnLabel, setOriginalTxnLabel] = useState<string | null>(null)

  const [directPayOpen, setDirectPayOpen] = useState(false)
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(null)
  const [directPayAmount, setDirectPayAmount] = useState('')
  const [directPayDate, setDirectPayDate] = useState(todayIsoDate())
  const [directPayRef, setDirectPayRef] = useState('')
  const [directPayNotes, setDirectPayNotes] = useState('')

  const [editDate, setEditDate] = useState('')
  const [editType, setEditType] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editRemarks, setEditRemarks] = useState('')
  const [editProducer, setEditProducer] = useState('')
  const [editCsr, setEditCsr] = useState('')
  const [editClientId, setEditClientId] = useState('')
  const [editPolicyId, setEditPolicyId] = useState('')
  const [editTransactionEffectiveDate, setEditTransactionEffectiveDate] = useState('')
  const [editTransactionExpirationDate, setEditTransactionExpirationDate] = useState('')
  const [editPremiumAmount, setEditPremiumAmount] = useState('')
  const [editCommissionType, setEditCommissionType] = useState<CommissionType>('percentage')
  const [editAgencyPct, setEditAgencyPct] = useState('')
  const [editAgencyAmount, setEditAgencyAmount] = useState('')
  const [editBrokerFee, setEditBrokerFee] = useState('0')
  const [editProducerSplit, setEditProducerSplit] = useState('')
  const [clientOptionsForEdit, setClientOptionsForEdit] = useState<{ id: string; name: string }[]>([])
  const [policyOptionsForEdit, setPolicyOptionsForEdit] = useState<
    { id: string; number: string; clientId: string; effectiveDate: string; expirationDate: string }[]
  >([])

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    setProducerScopeLimitation(null)
    const { data, error } = await fetchCommissionTransactions()
    if (error) {
      setFetchError(error.message)
      setTransactions([])
      setProducerScopeLimitation(null)
    } else if (isProducerBookScoped(roleInput)) {
      const names = [...new Set(data.map((tx) => tx.producer).filter((p) => p && p !== '—'))]
      const scope = resolveProducerBookName(roleInput, profile?.fullName, names, {
        linkedProducerName: profile?.linkedProducerName,
      })
      setProducerScopeLimitation(scope.limitation)
      if (!scope.lockedName) {
        setTransactions([])
      } else {
        setTransactions(data.filter((tx) => producerKeysMatch(tx.producer, scope.lockedName)))
      }
    } else {
      setTransactions(data)
    }
    setLoading(false)
  }, [roleInput, profile?.fullName, profile?.linkedProducerName])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  // Recovery totals for negative producer-commission rows (list secondary indicator).
  useEffect(() => {
    const negativeIds = transactions
      .filter((tx) => tx.producerCommissionAmount < 0)
      .map((tx) => tx.id)
    if (negativeIds.length === 0) {
      setRecoveryCreatedByTxn(new Map())
      return
    }

    let cancelled = false
    async function loadRecoveryTotals() {
      const { data, error } = await supabase
        .from('producer_commission_recoveries')
        .select('transaction_id, amount, status, voided_at')
        .in('transaction_id', negativeIds)
      if (cancelled) return
      if (error) {
        setRecoveryCreatedByTxn(new Map())
        return
      }
      const map = new Map<string, number>()
      for (const row of data ?? []) {
        const tid = row.transaction_id ? String(row.transaction_id) : ''
        if (!tid) continue
        if (row.voided_at) continue
        if (String(row.status ?? '').toLowerCase() === 'voided') continue
        map.set(tid, (map.get(tid) ?? 0) + Number(row.amount ?? 0))
      }
      setRecoveryCreatedByTxn(map)
    }
    void loadRecoveryTotals()
    return () => {
      cancelled = true
    }
  }, [transactions])

  // Deep link: /transactions/:id opens the matching drawer by UUID.
  useEffect(() => {
    setSelectedId(routeTxnId ?? null)
  }, [routeTxnId])

  const txnReturn = txnReturnFromLocation(location)
  const transactionsListPath = `/transactions${location.search}`

  function openTransaction(id: string) {
    setSelectedId(id)
    setActionError(null)
    setActionSuccess(null)
    navigate(`/transactions/${id}${location.search}`, {
      state: transactionLinkState({
        returnTo: transactionsListPath,
        returnLabel: 'Transactions',
      }),
    })
  }

  function closeTransaction() {
    setSelectedId(null)
    if (txnReturn) {
      navigate(txnReturn.path)
      return
    }
    navigate(transactionsListPath, { replace: true })
  }

  // Sync deep-link query params into filters (UUID-based). Missing param clears filter.
  useEffect(() => {
    setYearFilter(searchParams.get('year') || ALL)
    setClientFilter(searchParams.get('client') || ALL)
    setPolicyFilter(searchParams.get('policy') || ALL)
    setProducerFilter(searchParams.get('producer') || ALL)
    setCsrFilter(searchParams.get('csr') || ALL)
    setTypeFilter(searchParams.get('type') || ALL)
    setStatusFilter(searchParams.get('status') || ALL)
    setReviewFilter(searchParams.get('review') || ALL)
    setPaymentFilter(searchParams.get('payment') || ALL)
    setConfirmedFilter(searchParams.get('confirmed') || ALL)
    setCorrectionFilter(searchParams.get('correction') || ALL)
    setDateFrom(searchParams.get('dateFrom') || '')
    setDateTo(searchParams.get('dateTo') || '')
  }, [searchParams])

  // Keep URL query params aligned with drill-down filters.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const sync = (key: string, value: string) => {
          if (!value || value === ALL) next.delete(key)
          else next.set(key, value)
        }
        sync('year', yearFilter)
        sync('client', clientFilter)
        sync('policy', policyFilter)
        sync('producer', producerFilter)
        sync('csr', csrFilter)
        sync('type', typeFilter)
        sync('status', statusFilter)
        sync('review', reviewFilter)
        sync('payment', paymentFilter)
        sync('confirmed', confirmedFilter)
        sync('correction', correctionFilter)
        sync('dateFrom', dateFrom)
        sync('dateTo', dateTo)
        const nextStr = next.toString()
        if (nextStr === prev.toString()) return prev
        return next
      },
      { replace: true },
    )
  }, [
    yearFilter,
    clientFilter,
    policyFilter,
    producerFilter,
    csrFilter,
    typeFilter,
    statusFilter,
    reviewFilter,
    paymentFilter,
    confirmedFilter,
    correctionFilter,
    dateFrom,
    dateTo,
    setSearchParams,
  ])

  useEffect(() => {
    setPage(1)
  }, [
    search,
    yearFilter,
    clientFilter,
    policyFilter,
    producerFilter,
    csrFilter,
    typeFilter,
    statusFilter,
    reviewFilter,
    paymentFilter,
    confirmedFilter,
    correctionFilter,
    dateFrom,
    dateTo,
  ])

  // If client changes and selected policy belongs to a different client, reset policy.
  useEffect(() => {
    if (policyFilter === ALL || clientFilter === ALL || loading) return
    const policyRows = transactions.filter((tx) => tx.policyId === policyFilter)
    if (policyRows.length === 0) return
    const matchesClient = policyRows.some((tx) => tx.clientId === clientFilter)
    if (!matchesClient) setPolicyFilter(ALL)
  }, [clientFilter, policyFilter, transactions, loading])

  const selected = useMemo(
    () => transactions.find((tx) => tx.id === selectedId) ?? null,
    [transactions, selectedId],
  )

  useEffect(() => {
    if (!selectedId) {
      setRecoveries([])
      setRelatedReturns([])
      setOriginalTxnLabel(null)
      return
    }

    const txnId = selectedId
    let cancelled = false
    async function loadRecoveries() {
      setRecoveriesLoading(true)
      const { data, error } = await supabase
        .from('producer_commission_recoveries')
        .select(RECOVERY_SELECT)
        .eq('transaction_id', txnId)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) {
        setRecoveries([])
      } else {
        setRecoveries(mapRecoveryRows(data as Array<Record<string, unknown>>))
      }
      setRecoveriesLoading(false)
    }

    async function loadRelatedLinks() {
      const txn = transactions.find((tx) => tx.id === txnId)
      const related = await fetchRelatedReturnPremiums(txnId)
      if (cancelled) return
      setRelatedReturns(related.data)

      if (txn?.originalTransactionId) {
        const { data } = await supabase
          .from('transactions')
          .select('transaction_number')
          .eq('id', txn.originalTransactionId)
          .maybeSingle()
        if (cancelled) return
        setOriginalTxnLabel(
          data?.transaction_number ? String(data.transaction_number) : txn.originalTransactionId,
        )
      } else {
        setOriginalTxnLabel(null)
      }
    }

    loadRecoveries()
    void loadRelatedLinks()
    return () => {
      cancelled = true
    }
  }, [selectedId, transactions])

  const yearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const tx of transactions) {
      const year = tx.transactionDate?.slice(0, 4)
      if (year && /^\d{4}$/.test(year)) years.add(year)
    }
    return [...years].sort((a, b) => b.localeCompare(a))
  }, [transactions])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const tx of transactions) {
      if (!tx.clientId) continue
      map.set(tx.clientId, tx.clientName || tx.clientId)
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [transactions])

  const policyOptions = useMemo(() => {
    const map = new Map<string, { number: string; clientId: string }>()
    for (const tx of transactions) {
      if (!tx.policyId) continue
      if (clientFilter !== ALL && tx.clientId !== clientFilter) continue
      map.set(tx.policyId, {
        number: tx.policyNumber || tx.policyId,
        clientId: tx.clientId,
      })
    }
    return [...map.entries()]
      .map(([id, meta]) => ({ id, number: meta.number }))
      .sort((a, b) => a.number.localeCompare(b.number))
  }, [transactions, clientFilter])

  const producerOptions = useMemo(() => {
    return [...new Set(transactions.map((tx) => tx.producer).filter((p) => p && p !== '—'))].sort(
      (a, b) => a.localeCompare(b),
    )
  }, [transactions])

  const csrOptions = useMemo(() => {
    return [...new Set(transactions.map((tx) => tx.csr).filter((c) => c && c !== '—'))].sort(
      (a, b) => a.localeCompare(b),
    )
  }, [transactions])

  const typeOptions = useMemo(() => {
    return [...new Set(transactions.map((tx) => tx.type))].sort((a, b) =>
      formatTypeLabel(a).localeCompare(formatTypeLabel(b)),
    )
  }, [transactions])

  const statusOptions = useMemo(() => {
    return [...new Set(transactions.map((tx) => tx.status))].sort()
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return transactions.filter((tx) => {
      if (yearFilter !== ALL && tx.transactionDate.slice(0, 4) !== yearFilter) return false
      if (clientFilter !== ALL && tx.clientId !== clientFilter) return false
      if (policyFilter !== ALL && tx.policyId !== policyFilter) return false
      if (producerFilter !== ALL && tx.producer !== producerFilter) return false
      if (csrFilter !== ALL && tx.csr !== csrFilter) return false
      if (typeFilter !== ALL && tx.type !== typeFilter) return false
      if (statusFilter !== ALL && tx.status !== statusFilter) return false
      if (reviewFilter !== ALL && tx.reviewStatus !== reviewFilter) return false
      if (paymentFilter !== ALL && tx.producerPaymentStatus !== paymentFilter) return false
      if (confirmedFilter === 'yes' && !tx.agencyCommissionConfirmed) return false
      if (confirmedFilter === 'no' && tx.agencyCommissionConfirmed) return false
      if (correctionFilter === 'yes') {
        if (!isCorrectionRequired(tx)) return false
        const roles = toAppRoles(roleInput)
        const isCsrOps =
          isOpsMutatorRole(roleInput) &&
          roles.includes('csr') &&
          !isAdminDirectoryRole(roleInput)
        if (
          isCsrOps &&
          !csrAssignmentMatches({
            csrUserId: tx.csrUserId,
            csrName: tx.csr,
            profileId: profile?.id,
            profileFullName: profile?.fullName,
            profileEmail: profile?.email,
          })
        ) {
          return false
        }
      }
      if (correctionFilter === 'no' && isCorrectionRequired(tx)) return false
      if (dateFrom && tx.transactionDate < dateFrom) return false
      if (dateTo && tx.transactionDate > dateTo) return false
      if (!query) return true
      return (
        tx.clientName.toLowerCase().includes(query) ||
        tx.transactionNumber.toLowerCase().includes(query) ||
        tx.description.toLowerCase().includes(query) ||
        tx.policyNumber.toLowerCase().includes(query) ||
        tx.producer.toLowerCase().includes(query) ||
        tx.csr.toLowerCase().includes(query) ||
        formatTypeLabel(tx.type).toLowerCase().includes(query) ||
        formatLabel(tx.producerPaymentStatus).toLowerCase().includes(query) ||
        formatLabel(tx.reviewStatus).toLowerCase().includes(query)
      )
    })
  }, [
    transactions,
    search,
    yearFilter,
    clientFilter,
    policyFilter,
    producerFilter,
    csrFilter,
    typeFilter,
    statusFilter,
    reviewFilter,
    paymentFilter,
    confirmedFilter,
    correctionFilter,
    dateFrom,
    dateTo,
    roleInput,
    profile?.id,
    profile?.fullName,
    profile?.email,
  ])

  const kpis = useMemo(() => {
    const netVolume = filteredTransactions.reduce((sum, tx) => sum + tx.amount, 0)
    const returnPremiumTotal = filteredTransactions
      .filter((tx) => tx.type === 'return_premium' || tx.type === 'cancellation_premium')
      .reduce((sum, tx) => sum + tx.amount, 0)
    const pendingCount = filteredTransactions.filter((tx) =>
      isOperationallyPendingTransaction(tx),
    ).length
    return {
      total: filteredTransactions.length,
      netVolume,
      returnPremiumTotal,
      pendingCount,
    }
  }, [filteredTransactions])

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredTransactions.slice(start, start + PAGE_SIZE)
  }, [filteredTransactions, currentPage])

  const rangeStart =
    filteredTransactions.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredTransactions.length)

  const confirmVariance = useMemo(() => {
    if (!selected) return 0
    const received = Number(receivedAmount)
    if (!Number.isFinite(received)) return 0
    return received - selected.expectedAmount
  }, [selected, receivedAmount])

  const confirmHasVariance = Math.abs(confirmVariance) > 0.009

  function clearFilters() {
    setSearch('')
    setYearFilter(ALL)
    setClientFilter(ALL)
    setPolicyFilter(ALL)
    setProducerFilter(ALL)
    setCsrFilter(ALL)
    setTypeFilter(ALL)
    setStatusFilter(ALL)
    setReviewFilter(ALL)
    setPaymentFilter(ALL)
    setConfirmedFilter(ALL)
    setCorrectionFilter(ALL)
    setDateFrom('')
    setDateTo('')
  }

  const hasActiveFilters =
    search.trim() !== '' ||
    yearFilter !== ALL ||
    clientFilter !== ALL ||
    policyFilter !== ALL ||
    producerFilter !== ALL ||
    csrFilter !== ALL ||
    typeFilter !== ALL ||
    statusFilter !== ALL ||
    reviewFilter !== ALL ||
    paymentFilter !== ALL ||
    confirmedFilter !== ALL ||
    correctionFilter !== ALL ||
    dateFrom !== '' ||
    dateTo !== ''

  const activeFilterCount = [
    search.trim() !== '',
    yearFilter !== ALL,
    clientFilter !== ALL,
    policyFilter !== ALL,
    producerFilter !== ALL,
    csrFilter !== ALL,
    typeFilter !== ALL,
    statusFilter !== ALL,
    reviewFilter !== ALL,
    paymentFilter !== ALL,
    confirmedFilter !== ALL,
    correctionFilter !== ALL,
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length

  const moreFilterCount = [
    csrFilter !== ALL,
    typeFilter !== ALL,
    statusFilter !== ALL,
    reviewFilter !== ALL,
    paymentFilter !== ALL,
    confirmedFilter !== ALL,
    correctionFilter !== ALL,
    dateFrom !== '',
    dateTo !== '',
  ].filter(Boolean).length

  function openConfirmReceipt() {
    if (!selected) return
    setActionError(null)
    setActionSuccess(null)
    setReceivedAmount(String(selected.expectedAmount))
    setReceivedDate(todayIsoDate())
    setSource('')
    setDepositReference('')
    setExternalInvoiceId('')
    setReceiptNotes('')
    setVarianceAck(false)
    setConfirmOpen(true)
  }

  async function handleConfirmReceipt(e: FormEvent) {
    e.preventDefault()
    if (!selected || !canConfirm) return
    const amount = Number(receivedAmount)
    if (!Number.isFinite(amount)) {
      setActionError('Enter a valid amount received.')
      return
    }
    if (!receivedDate) {
      setActionError('Received date is required.')
      return
    }

    setSaving(true)
    setActionError(null)
    const result = await confirmAgencyCommissionReceived({
      transaction: selected,
      amountReceived: amount,
      receivedDate,
      source,
      depositReference,
      externalInvoiceId,
      notes: receiptNotes,
      varianceAcknowledged: varianceAck,
    })
    setSaving(false)

    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }

    setConfirmOpen(false)
    setActionSuccess('Agency commission receipt confirmed.')
    await loadTransactions()
  }

  async function handleMarkReady() {
    if (!selected || !canReady) return
    setSaving(true)
    setActionError(null)
    const result = await markProducerCommissionReady(selected.id)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setReadyOpen(false)
    setActionSuccess('Producer commission marked Ready for payout.')
    await loadTransactions()
  }

  function openRecoveryModal(opts?: {
    amount?: string
    notes?: string
    settlementMethod?: 'next_payout' | 'direct_payment'
    fromAssist?: boolean
  }) {
    setActionError(null)
    setActionSuccess(null)
    const available =
      selected != null ? availableRecoveryAmount(selected.producerCommissionAmount, recoveries) : 0
    const defaultAmount =
      opts?.amount ??
      (selected && selected.producerCommissionAmount < 0 && available > 0 ? String(available) : '')
    setRecoveryAmount(defaultAmount)
    setRecoveryNotes(opts?.notes ?? '')
    setRecoverySettlementMethod(opts?.settlementMethod ?? 'next_payout')
    setRecoveryAssistOpen(Boolean(opts?.fromAssist))
    setRecoveryOpen(true)
  }

  function openDirectPayModal(recovery: RecoverySummary) {
    setActionError(null)
    setActionSuccess(null)
    setSelectedRecoveryId(recovery.id)
    setDirectPayAmount(String(recovery.remainingAmount > 0 ? recovery.remainingAmount : recovery.amount))
    setDirectPayDate(todayIsoDate())
    setDirectPayRef('')
    setDirectPayNotes('')
    setDirectPayOpen(true)
  }

  async function handleCreateRecovery(e: FormEvent) {
    e.preventDefault()
    if (!selected || !canRecovery) return
    const amount = Number(recoveryAmount)
    if (!Number.isFinite(amount) || !(amount > 0)) {
      setActionError('Enter a recovery amount greater than zero.')
      return
    }
    if (!recoveryNotes.trim()) {
      setActionError('Reason / notes are required.')
      return
    }
    const available = availableRecoveryAmount(selected.producerCommissionAmount, recoveries)
    if (selected.producerCommissionAmount < 0 && amount > available + 0.009) {
      setActionError(
        available <= 0
          ? 'This transaction is fully recovered. No additional recovery can be recorded.'
          : `Recovery amount exceeds available recoverable amount (${formatCurrency(available)}).`,
      )
      return
    }
    setSaving(true)
    setActionError(null)
    const result = await createProducerRecovery({
      transactionId: selected.id,
      receiptId: selected.agencyCommissionReceiptId,
      producer: selected.producer,
      amount,
      notes: recoveryNotes,
      clientId: selected.clientId,
      policyId: selected.policyId,
      reason: recoveryNotes,
      settlementMethod: recoverySettlementMethod,
    })
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    const createdId = result.data?.id ? String(result.data.id) : null
    const wasDirect = recoverySettlementMethod === 'direct_payment'
    setRecoveryOpen(false)
    setRecoveryAssistOpen(false)
    setRecoveryAmount('')
    setRecoveryNotes('')
    setRecoverySettlementMethod('next_payout')
    setActionSuccess('Producer commission recovery recorded.')
    setSelectedId(selected.id)
    const { data } = await supabase
      .from('producer_commission_recoveries')
      .select(RECOVERY_SELECT)
      .eq('transaction_id', selected.id)
      .order('created_at', { ascending: false })
    const mapped = mapRecoveryRows(data as Array<Record<string, unknown>>)
    setRecoveries(mapped)
    setRecoveryCreatedByTxn((prev) => {
      const next = new Map(prev)
      next.set(selected.id, sumCreatedRecoveryAmounts(mapped))
      return next
    })
    await loadTransactions()
    if (wasDirect && createdId) {
      const created = mapped.find((row) => row.id === createdId)
      if (created) openDirectPayModal(created)
    }
  }

  async function handleDirectRecoveryPayment(e: FormEvent) {
    e.preventDefault()
    if (!selectedRecoveryId || !canRecovery) return
    const amount = Number(directPayAmount)
    if (!Number.isFinite(amount) || !(amount > 0)) {
      setActionError('Enter a valid amount received.')
      return
    }
    if (!directPayDate) {
      setActionError('Received date is required.')
      return
    }
    setSaving(true)
    setActionError(null)
    const result = await recordDirectRecoveryPayment({
      recoveryId: selectedRecoveryId,
      amountReceived: amount,
      receivedDate: directPayDate,
      paymentReference: directPayRef,
      notes: directPayNotes,
    })
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setDirectPayOpen(false)
    setSelectedRecoveryId(null)
    setActionSuccess('Direct recovery payment recorded.')
    if (selected) {
      const { data } = await supabase
        .from('producer_commission_recoveries')
        .select(RECOVERY_SELECT)
        .eq('transaction_id', selected.id)
        .order('created_at', { ascending: false })
      setRecoveries(mapRecoveryRows(data as Array<Record<string, unknown>>))
    }
    await loadTransactions()
  }

  async function handleVoidTransaction(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    if (!voidReason.trim()) {
      setActionError('Void reason is required.')
      return
    }
    setSaving(true)
    setActionError(null)
    const result = await voidTransaction(selected.id, voidReason)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setVoidOpen(false)
    setVoidReason('')
    setActionSuccess('Transaction voided.')
    await loadTransactions()
  }

  async function openEditModal() {
    if (!selected || !canEditTransaction(selected)) return
    const mayCorrect = canCorrectReturnedTransaction(selected, roleInput, {
      id: profile?.id,
      fullName: profile?.fullName,
      email: profile?.email,
    })
    if (!canMutate && !mayCorrect) return
    setActionError(null)
    setActionSuccess(null)
    setEditDate(selected.transactionDate || '')
    setEditType(selected.type || 'new_policy_premium')
    setEditDescription(selected.description || '')
    setEditNotes(selected.notes || '')
    setEditRemarks(selected.remarks || '')
    setEditProducer(selected.producer === '—' ? '' : selected.producer)
    setEditCsr(selected.csr === '—' ? '' : selected.csr)
    setEditClientId(selected.clientId || '')
    setEditPolicyId(selected.policyId || '')
    setEditTransactionEffectiveDate(selected.transactionEffectiveDate || '')
    setEditTransactionExpirationDate(selected.transactionExpirationDate || '')
    setEditPremiumAmount(String(selected.premiumAmount))
    setEditCommissionType(selected.commissionType)
    setEditAgencyPct(
      selected.agencyCommissionPercentage === null ? '' : String(selected.agencyCommissionPercentage),
    )
    setEditAgencyAmount(String(selected.agencyCommissionAmount))
    setEditBrokerFee(String(selected.brokerFee))
    setEditProducerSplit(
      selected.producerSplitPercentage === null ? '' : String(selected.producerSplitPercentage),
    )
    setEditReviewerUserId(selected.reviewerUserId || '')

    const [{ data: clients }, { data: policies }, reviewerRes] = await Promise.all([
      supabase.from('clients').select('id, business_name').order('business_name'),
      supabase.from('policies').select('id, policy_number, client_id, effective_date, expiration_date').order('policy_number'),
      fetchActiveReviewers(),
    ])
    setReviewers(reviewerRes.data)
    if (!selected.reviewerUserId && reviewerRes.data.length === 1) {
      setEditReviewerUserId(reviewerRes.data[0].id)
    }

    setClientOptionsForEdit(
      (clients ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.business_name ?? row.id),
      })),
    )
    setPolicyOptionsForEdit(
      (policies ?? []).map((row) => ({
        id: String(row.id),
        number: String(row.policy_number ?? row.id),
        clientId: String(row.client_id ?? ''),
        effectiveDate: String(row.effective_date ?? '').slice(0, 10),
        expirationDate: String(row.expiration_date ?? '').slice(0, 10),
      })),
    )
    setEditOpen(true)
  }

  async function handleEditTransaction(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setSaving(true)
    setActionError(null)
    const unlockCommission = canEditTransactionCommission(selected, roleInput, {
      id: profile?.id,
      fullName: profile?.fullName,
      email: profile?.email,
    })
    const commissionType = normalizeCommissionType(editCommissionType)
    const result = await updateTransactionMetadata({
      transactionId: selected.id,
      transactionDate: editDate,
      description: editDescription,
      notes: editNotes,
      remarks: editRemarks,
      type: editType,
      producer: editProducer,
      csr: editCsr,
      clientId: editClientId,
      policyId: editPolicyId,
      transactionEffectiveDate: editTransactionEffectiveDate || null,
      transactionExpirationDate: editTransactionExpirationDate || null,
      reviewerUserId: editReviewerUserId.trim() || null,
      unlockCommission,
      premiumAmount: unlockCommission ? Number(editPremiumAmount) : undefined,
      commissionType: unlockCommission ? commissionType : undefined,
      agencyCommissionPercentage:
        unlockCommission && commissionType === 'percentage' ? Number(editAgencyPct) : null,
      agencyCommissionAmount:
        unlockCommission && commissionType === 'flat' ? Number(editAgencyAmount) : null,
      brokerFee: unlockCommission ? Number(editBrokerFee) : undefined,
      producerSplitPercentage: unlockCommission ? Number(editProducerSplit) : undefined,
    })
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setEditOpen(false)
    setActionSuccess('Transaction details updated.')
    await loadTransactions()
  }

  async function handleApproveReview(e: FormEvent) {
    e.preventDefault()
    if (!selected || !canApprove) return
    setSaving(true)
    setActionError(null)
    const result = await approveTransactionReview(selected.id)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setApproveOpen(false)
    setActionSuccess('Transaction review approved.')
    await loadTransactions()
  }

  async function handleSubmitForReview(e: FormEvent) {
    e.preventDefault()
    if (!selected || !canSubmitReview) return
    setSaving(true)
    setActionError(null)
    const result = await submitTransactionForReview(selected)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setSubmitReviewOpen(false)
    const emailNote = result.email?.message ? ` ${result.email.message}` : ''
    setActionSuccess(`Submitted for Review.${emailNote}`)
    await loadTransactions()
  }

  async function handleReturnForCorrection(e: FormEvent) {
    e.preventDefault()
    if (!selected || !canApprove) return
    if (!returnReason.trim()) {
      setActionError('Reason for correction is required.')
      return
    }
    setSaving(true)
    setActionError(null)
    const result = await returnTransactionForCorrection(selected.id, returnReason)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setReturnOpen(false)
    setReturnReason('')
    const emailNote = result.email?.message ? ` ${result.email.message}` : ''
    setActionSuccess(`Returned for correction.${emailNote}`)
    await loadTransactions()
  }

  async function handleArchiveTransaction(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setSaving(true)
    setActionError(null)
    const result = await archiveTransaction(selected.id)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setArchiveOpen(false)
    setSelectedId(null)
    setActionSuccess('Transaction archived.')
    await loadTransactions()
  }

  const editPoliciesForClient = useMemo(() => {
    if (!editClientId) return policyOptionsForEdit
    return policyOptionsForEdit.filter((p) => p.clientId === editClientId)
  }, [policyOptionsForEdit, editClientId])

  const reviewGate = selected
    ? canActOnAssignedReview({
        role: roleInput,
        profileUserId: profile?.id,
        reviewerUserId: selected.reviewerUserId,
      })
    : { allowed: false, ownerOverride: false }

  const showApprove =
    canApprove && selected && canApproveTransactionReview(selected) && reviewGate.allowed
  const showSubmitReview = canSubmitReview && selected && canSubmitTransactionForReview(selected)
  const showReturn =
    canApprove && selected && canReturnTransactionForCorrection(selected) && reviewGate.allowed
  const showMarkReady =
    canReady && selected && canMarkProducerCommissionReady(selected) && reviewGate.allowed
  const markReadyBlocked =
    selected &&
    selected.reviewStatus === 'approved' &&
    canReady &&
    !showMarkReady &&
    !selected.paidDate
      ? markReadyBlockedReason(selected)
      : null
  /** Explain missing Approve/Return without loosening gates. */
  const reviewActionBlockedReason =
    selected &&
    canApprove &&
    selected.agencyCommissionConfirmed &&
    selected.reviewStatus === 'matched' &&
    !showApprove
      ? !selected.reviewerUserId?.trim()
        ? 'Cannot approve: no Owner/Admin reviewer is assigned on this transaction.'
        : !reviewGate.allowed
          ? 'Cannot approve: only the assigned reviewer may act (Owner may override when signed in as Owner).'
          : !canApproveTransactionReview(selected)
            ? 'Cannot approve: transaction is not eligible (paid, batched, archived, or not submitted).'
            : 'Approve / Return actions are unavailable for this transaction.'
      : null
  const showGoToPayments = Boolean(
    canReady && selected && selected.producerPaymentStatus === 'ready' && !selected.paidDate,
  )
  const showEdit = Boolean(
    selected &&
      canEditTransaction(selected) &&
      (canMutate ||
        canCorrectReturnedTransaction(selected, roleInput, {
          id: profile?.id,
          fullName: profile?.fullName,
          email: profile?.email,
        })),
  )
  const showCommissionEdit = Boolean(
    selected &&
      canEditTransactionCommission(selected, roleInput, {
        id: profile?.id,
        fullName: profile?.fullName,
        email: profile?.email,
      }),
  )
  const showVoid =
    Boolean(
      canMutate &&
        selected &&
        !selected.voidedAt &&
        canVoidTransaction(selected, recoveries.length) &&
        canApprove,
    )
  const showArchive = Boolean(
    canMutate &&
      selected &&
      !selected.voidedAt &&
      canArchiveTransaction(selected, recoveries.length) &&
      !showVoid,
  )
  const hasOpenRecoveryForProducer = Boolean(
    selected &&
      recoveries.some(
        (row) =>
          row.status === 'open' &&
          !row.voidedAt &&
          row.remainingAmount > 0,
      ),
  )
  const selectedRecoveryObligation = selected
    ? transactionRecoveryObligation(selected.producerCommissionAmount)
    : 0
  const selectedRecoveryCreated = selected ? sumCreatedRecoveryAmounts(recoveries) : 0
  const selectedRecoveryAvailable = selected
    ? availableRecoveryAmount(selected.producerCommissionAmount, recoveries)
    : 0
  const selectedRecoverySettledLabel = selected
    ? formatTransactionRecoverySettledLabel(selected.producerCommissionAmount, recoveries)
    : null
  const selectedFullyRecovered =
    selectedRecoveryObligation > 0 && selectedRecoveryAvailable <= 0 && selectedRecoveryCreated > 0
  const showRecoveryAssist = Boolean(
    canRecovery &&
      selected &&
      selected.type === 'return_premium' &&
      selected.producerCommissionAmount < 0 &&
      !hasOpenRecoveryForProducer &&
      selectedRecoveryAvailable > 0,
  )
  const correctionRequired = Boolean(selected && isCorrectionRequired(selected))
  const ownerOverrideLabel = reviewGate.ownerOverride ? 'Owner Override' : null

  const editCommissionPreview = useMemo(() => {
    if (!showCommissionEdit) return null
    const premium = Number(editPremiumAmount)
    const split = Number(editProducerSplit)
    const brokerFee = Number(editBrokerFee)
    const commissionType = normalizeCommissionType(editCommissionType)
    if (!Number.isFinite(premium) || !Number.isFinite(split) || split < 0 || !Number.isFinite(brokerFee)) {
      return null
    }
    if (commissionType === 'percentage') {
      const pct = Number(editAgencyPct)
      if (!Number.isFinite(pct) || pct < 0) return null
      return deriveCommission({
        commissionType: 'percentage',
        baseAmount: premium,
        agencyCommissionPercentage: pct,
        agencyCommissionAmount: null,
        brokerFee,
        producerSplitPercentage: split,
      })
    }
    const flat = Number(editAgencyAmount)
    if (!Number.isFinite(flat)) return null
    return deriveCommission({
      commissionType: 'flat',
      baseAmount: premium,
      agencyCommissionPercentage: null,
      agencyCommissionAmount: flat,
      brokerFee,
      producerSplitPercentage: split,
    })
  }, [
    showCommissionEdit,
    editPremiumAmount,
    editCommissionType,
    editAgencyPct,
    editAgencyAmount,
    editBrokerFee,
    editProducerSplit,
  ])

  return (
    <div className="space-y-5">
      {producerLocked && producerScopeLimitation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {producerScopeLimitation}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md lg:max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search client, policy, type, or transaction #"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>
        {canMutate && (
          <button
            type="button"
            onClick={() => setAddTxnOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Transaction
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Transactions" value={String(kpis.total)} icon={ArrowLeftRight} tone="blue" />
        <KpiCard
          label="Net Premium Volume"
          value={formatCurrency(kpis.netVolume)}
          icon={CircleDollarSign}
          tone="teal"
          negative={kpis.netVolume < 0}
        />
        <KpiCard
          label="Return Premiums"
          value={formatCurrency(kpis.returnPremiumTotal)}
          icon={RotateCcw}
          tone="orange"
          negative={kpis.returnPremiumTotal < 0}
        />
        <KpiCard label="Pending Transactions" value={String(kpis.pendingCount)} icon={Wallet} tone="amber" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          className={`flex flex-col gap-3 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between ${
            hasActiveFilters || moreFiltersOpen ? 'border-b border-slate-100' : ''
          }`}
        >
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <CalendarRange className="h-4 w-4 text-slate-400" />
            <span className={hasActiveFilters ? 'font-medium text-slate-700' : 'font-medium text-slate-600'}>
              Filters
            </span>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-alza-blue-50 px-2 py-0.5 text-xs font-semibold text-alza-blue-700 ring-1 ring-inset ring-alza-blue-600/20">
                {activeFilterCount} active
              </span>
            )}
            <span className="text-xs text-slate-400">
              {filteredTransactions.length}{' '}
              {filteredTransactions.length === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              rowCount={filteredTransactions.length}
              disabled={loading}
              onExport={(format) =>
                downloadTableExport({
                  format,
                  sheetName: 'Transactions',
                  columns: transactionExportColumns,
                  rows: filteredTransactions,
                  filenameBase: 'Transactions',
                  label: 'transactions',
                })
              }
            />
            <button
              type="button"
              onClick={() => setMoreFiltersOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              More Filters
              {moreFilterCount > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-600">
                  {moreFilterCount}
                </span>
              )}
              <ChevronDown className={`h-4 w-4 transition-transform ${moreFiltersOpen ? 'rotate-180' : ''}`} />
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterSelect id="year-filter" label="Year" value={yearFilter} onChange={setYearFilter}>
            <option value={ALL}>All years</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="client-filter" label="Client" value={clientFilter} onChange={(value) => {
            setClientFilter(value)
            setPolicyFilter(ALL)
          }}>
            <option value={ALL}>All clients</option>
            {clientOptions.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="policy-filter" label="Policy" value={policyFilter} onChange={setPolicyFilter}>
            <option value={ALL}>All policies</option>
            {policyOptions.map((policy) => (
              <option key={policy.id} value={policy.id}>{policy.number}</option>
            ))}
          </FilterSelect>
          <FilterSelect id="producer-filter" label="Producer" value={producerFilter} onChange={setProducerFilter}>
            <option value={ALL}>All producers</option>
            {producerOptions.map((producer) => (
              <option key={producer} value={producer}>{producer}</option>
            ))}
          </FilterSelect>
        </div>

        {moreFiltersOpen && (
          <div className="grid gap-3 border-t border-slate-100 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
            <FilterSelect id="csr-filter" label="CSR" value={csrFilter} onChange={setCsrFilter}>
              <option value={ALL}>All CSRs</option>
              {csrOptions.map((csr) => (
                <option key={csr} value={csr}>{csr}</option>
              ))}
            </FilterSelect>
            <FilterSelect id="type-filter" label="Transaction Type" value={typeFilter} onChange={setTypeFilter}>
              <option value={ALL}>All types</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>{formatTypeLabel(type)}</option>
              ))}
            </FilterSelect>
            <FilterSelect id="status-filter" label="Transaction Status" value={statusFilter} onChange={setStatusFilter}>
              <option value={ALL}>All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{formatLabel(status)}</option>
              ))}
            </FilterSelect>
            <FilterSelect id="review-filter" label="Review Status" value={reviewFilter} onChange={setReviewFilter}>
              <option value={ALL}>All review statuses</option>
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>{formatReviewStatusLabel(status)}</option>
              ))}
            </FilterSelect>
            <FilterSelect id="payment-filter" label="Producer Payment Status" value={paymentFilter} onChange={setPaymentFilter}>
              <option value={ALL}>All payment statuses</option>
              {PRODUCER_PAYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>{formatLabel(status)}</option>
              ))}
            </FilterSelect>
            <FilterSelect id="confirmed-filter" label="Agency Confirmed" value={confirmedFilter} onChange={setConfirmedFilter}>
              <option value={ALL}>All</option>
              <option value="yes">Confirmed</option>
              <option value="no">Awaiting receipt</option>
            </FilterSelect>
            <FilterSelect
              id="correction-filter"
              label="Correction Required"
              value={correctionFilter}
              onChange={setCorrectionFilter}
            >
              <option value={ALL}>All</option>
              <option value="yes">Returned for correction</option>
              <option value="no">Not returned</option>
            </FilterSelect>
            <div>
              <label htmlFor="date-from" className="mb-1.5 block text-xs font-medium text-slate-500">Date From</label>
              <input id="date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selectClassName} />
            </div>
            <div>
              <label htmlFor="date-to" className="mb-1.5 block text-xs font-medium text-slate-500">Date To</label>
              <input id="date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selectClassName} />
            </div>
          </div>
        )}
      </div>

      {fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load transactions: {fetchError}
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {actionSuccess}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="min-w-[170px] px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Transaction</th>
                <th className="min-w-[170px] px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Client / Policy</th>
                <th className="min-w-[140px] px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Policy Term</th>
                <th className="min-w-[120px] px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                <th className="min-w-[140px] px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Agency Commission</th>
                <th className="min-w-[150px] px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Producer</th>
                <th className="min-w-[140px] px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Workflow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-600">Loading transactions...</td></tr>
              ) : paginatedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <p className="text-sm font-medium text-slate-900">No transactions match the selected filters</p>
                    <p className="mt-1 text-sm text-slate-500">Try adjusting your search or filters.</p>
                  </td>
                </tr>
              ) : (
                paginatedTransactions.map((tx) => {
                  const workflow = getTransactionWorkflowStatus(tx)
                  const obligation = transactionRecoveryObligation(tx.producerCommissionAmount)
                  const created = recoveryCreatedByTxn.get(tx.id) ?? 0
                  const fullyRecovered = obligation > 0 && created + 0.009 >= obligation
                  return (
                  <tr
                    key={tx.id}
                    onClick={() => openTransaction(tx.id)}
                    className="cursor-pointer transition-colors hover:bg-alza-blue-50/50"
                  >
                    <td className="px-5 py-5 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide ${typeStyles[tx.type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {formatTypeLabel(tx.type)}
                        </span>
                        {tx.voidedAt && (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide bg-red-100 text-red-800">
                            VOID
                          </span>
                        )}
                      </div>
                      {tx.transactionNumber ? (
                        <p className="mt-1.5">
                          <Link
                            to={`/transactions/${tx.id}${location.search}`}
                            state={transactionLinkState({
                              returnTo: transactionsListPath,
                              returnLabel: 'Transactions',
                            })}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-semibold text-alza-blue-700 hover:underline"
                          >
                            {tx.transactionNumber}
                          </Link>
                        </p>
                      ) : (
                        <p className="mt-1.5 text-sm font-semibold text-slate-900">—</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">{formatDate(tx.transactionDate)}</p>
                    </td>
                    <td className="px-5 py-5 align-top">
                      <p className="font-medium text-slate-900">{tx.clientName}</p>
                      <p className="mt-1 text-xs text-slate-500">{tx.policyNumber}</p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-5 align-top">
                      <p className="text-slate-800">{formatDate(tx.policyEffectiveDate)}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(tx.policyExpirationDate)}</p>
                    </td>
                    <td className={`whitespace-nowrap px-5 py-5 align-top text-right font-semibold tabular-nums ${tx.amount < 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-5 align-top text-right font-medium tabular-nums text-slate-900">
                      {formatCurrency(tx.agencyCommissionAmount)}
                    </td>
                    <td className="px-5 py-5 align-top">
                      <p className="font-medium text-slate-900">{tx.producer}</p>
                      <p className="mt-1 text-xs tabular-nums text-slate-500">
                        {formatCurrency(tx.producerCommissionAmount)}
                      </p>
                    </td>
                    <td className="px-5 py-5 align-top">
                      <div className="flex flex-col items-start gap-1.5">
                        {tx.voidedAt && (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-600/20">
                            VOID
                          </span>
                        )}
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${workflowStatusStyles[workflow]}`}>
                          {workflow}
                        </span>
                        {fullyRecovered && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
                            Recovered / Settled
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && filteredTransactions.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Showing <span className="font-medium text-slate-900">{rangeStart}-{rangeEnd}</span> of{' '}
              <span className="font-medium text-slate-900">{filteredTransactions.length}</span>
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-sm text-slate-600">Page {currentPage} of {totalPages}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close transaction detail" onClick={closeTransaction} />
          <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={closeTransaction}
                className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-alza-blue-700"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to {txnReturn?.label ?? 'Transactions'}
              </button>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Transaction</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-900">{selected.transactionNumber || 'Untitled'}</h3>
                    {selected.voidedAt && (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-600/20">
                        VOID
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{formatTypeLabel(selected.type)} · {formatDate(selected.transactionDate)}</p>
                </div>
                <button type="button" onClick={closeTransaction} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {(showApprove || showReturn) && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {showApprove && (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null)
                        setApproveOpen(true)
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {ownerOverrideLabel ? 'Approve (Owner Override)' : 'Approve'}
                    </button>
                  )}
                  {showReturn && (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null)
                        setReturnReason('')
                        setReturnOpen(true)
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {ownerOverrideLabel ? 'Return for Correction (Owner Override)' : 'Return for Correction'}
                    </button>
                  )}
                </div>
              )}
              {reviewActionBlockedReason && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  {reviewActionBlockedReason}
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {showRecoveryAssist && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                  <p className="font-semibold">
                    Producer commission recovery required:{' '}
                    {formatCurrency(selectedRecoveryAvailable)}
                  </p>
                  <p className="mt-1 text-xs text-amber-900/80">
                    Return premium created a negative producer commission. Create a recovery/chargeback to settle it.
                    {selectedRecoveryCreated > 0
                      ? ` Already recovered ${formatCurrency(selectedRecoveryCreated)} of ${formatCurrency(selectedRecoveryObligation)}.`
                      : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      openRecoveryModal({
                        amount: String(selectedRecoveryAvailable),
                        notes: 'Return Premium Commission Recovery',
                        settlementMethod: 'next_payout',
                        fromAssist: true,
                      })
                    }
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-950 hover:bg-amber-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Create Recovery / Chargeback
                  </button>
                </div>
              )}

              {selectedRecoverySettledLabel && (
                <div
                  className={`rounded-lg border px-3 py-3 text-sm ${
                    selectedFullyRecovered
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-amber-200 bg-amber-50 text-amber-950'
                  }`}
                >
                  <p className="font-semibold">{selectedRecoverySettledLabel}</p>
                  {selectedFullyRecovered ? (
                    <p className="mt-1 text-xs opacity-80">
                      Negative producer commission for this transaction is fully recovered. Approval status is separate.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs opacity-80">
                      Available to recover: {formatCurrency(selectedRecoveryAvailable)}
                    </p>
                  )}
                </div>
              )}

              <Section title="Transaction">
                <DetailGrid
                  items={[
                    ['Transaction #', selected.transactionNumber || '—'],
                    ['Transaction Type', formatTypeLabel(selected.type)],
                    ['Transaction Date', formatDate(selected.transactionDate)],
                    [
                      'Transaction Effective Date',
                      formatDate(selected.transactionEffectiveDate),
                    ],
                    [
                      'Transaction Expiration Date',
                      formatDate(selected.transactionExpirationDate),
                    ],
                    ['Description', selected.description || '—'],
                    ['Amount', formatCurrency(selected.amount)],
                  ]}
                />
              </Section>

              <Section title="Client / Policy">
                <DetailGrid
                  items={[
                    [
                      'Client',
                      selected.clientId ? (
                        <Link
                          to={`/clients/${selected.clientId}`}
                          state={withFinancialsReturn(
                            txnReturn?.label === 'Financials' ? txnReturn.path : null,
                          )}
                          className="text-alza-blue-700 hover:underline"
                        >
                          {selected.clientName || '—'}
                        </Link>
                      ) : (
                        selected.clientName || '—'
                      ),
                    ],
                    [
                      'Policy #',
                      selected.policyId ? (
                        <Link
                          to={`/policies/${selected.policyId}`}
                          state={withFinancialsReturn(
                            txnReturn?.label === 'Financials' ? txnReturn.path : null,
                          )}
                          className="text-alza-blue-700 hover:underline"
                        >
                          {selected.policyNumber || '—'}
                        </Link>
                      ) : (
                        selected.policyNumber || '—'
                      ),
                    ],
                    ['Policy Type', selected.policyType],
                    ['Carrier', selected.carrier],
                    ['MGA', selected.mga],
                    [
                      'Policy Term',
                      selected.policyEffectiveDate || selected.policyExpirationDate
                        ? `${formatDate(selected.policyEffectiveDate)} → ${formatDate(selected.policyExpirationDate)}`
                        : '—',
                    ],
                    [
                      'Policy Effective Date',
                      formatDate(selected.policyEffectiveDate),
                    ],
                    [
                      'Policy Expiration Date',
                      formatDate(selected.policyExpirationDate),
                    ],
                  ]}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Policy term is read-only reference. Transaction effective/expiration dates above are
                  stored on the transaction and do not update the policy.
                </p>
              </Section>

              <Section title="Agency Commission">
                <DetailGrid
                  items={[
                    ['Commission Basis', formatCommissionTypeLabel(selected.commissionType)],
                    ...(selected.commissionType === 'percentage'
                      ? ([['Agency Commission %', formatPercent(selected.agencyCommissionPercentage)]] as [
                          string,
                          React.ReactNode,
                        ][])
                      : []),
                    ['Agency Commission Amount', formatCurrency(selected.agencyCommissionAmount)],
                    ['Broker Fee', formatCurrency(selected.brokerFee)],
                    ['Commission Pool', formatCurrency(selected.commissionPool)],
                  ]}
                />
                <p className="mt-2 text-xs text-slate-500">Stored snapshot values — not recalculated from the current policy.</p>
              </Section>

              <Section title="Producer Split">
                <DetailGrid
                  items={[
                    ['Producer', selected.producer],
                    [
                      'Producer Split',
                      formatProducerSplitSourceLabel(
                        selected.producerSplitSource,
                        selected.producerSplitPercentage,
                      ),
                    ],
                    ['Producer Commission', formatCurrency(selected.producerCommissionAmount)],
                    ['Agency Net Commission', formatCurrency(selected.agencyNetCommission)],
                  ]}
                />
              </Section>

              {(selected.originalTransactionId || relatedReturns.length > 0) && (
                <Section title="Related Transactions">
                  <div className="space-y-3 text-sm">
                    {selected.originalTransactionId && (
                      <p>
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Original Transaction
                        </span>
                        <br />
                        <Link
                          to={`/transactions/${selected.originalTransactionId}${location.search}`}
                          state={transactionLinkState({
                            returnTo: `/transactions/${selected.id}${location.search}`,
                            returnLabel: 'Transactions',
                          })}
                          className="font-medium text-alza-blue-700 hover:underline"
                        >
                          {originalTxnLabel || selected.originalTransactionId}
                        </Link>
                      </p>
                    )}
                    {relatedReturns.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Related Return Premiums
                        </p>
                        <ul className="space-y-1.5">
                          {relatedReturns.map((row) => (
                            <li key={row.id} className="flex items-center justify-between gap-3">
                              <Link
                                to={`/transactions/${row.id}${location.search}`}
                                state={transactionLinkState({
                                  returnTo: `/transactions/${selected.id}${location.search}`,
                                  returnLabel: 'Transactions',
                                })}
                                className="font-medium text-alza-blue-700 hover:underline"
                              >
                                {row.number}
                              </Link>
                              <span
                                className={`tabular-nums ${
                                  row.amount < 0 ? 'text-orange-700' : 'text-slate-700'
                                }`}
                              >
                                {formatCurrency(row.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Section>
              )}

              <Section title="Supporting Documents">
                <SupportingDocumentsPanel
                  entityType="transaction"
                  entityId={selected.id}
                  transactionId={selected.id}
                  canUpload={canMutate}
                  canDelete={canManageRecoveries(roleInput)}
                  title="Files"
                />
              </Section>

              <Section title="Workflow">
                {(() => {
                  const timeline = getTransactionWorkflowTimeline(selected)
                  const workflow = getTransactionWorkflowStatus(selected)
                  return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {selected.voidedAt && (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-600/20">
                            VOID
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            workflowStatusStyles[workflow]
                          }`}
                        >
                          {workflow}
                        </span>
                        {correctionRequired && (
                          <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-inset ring-orange-600/20">
                            Correction Required
                          </span>
                        )}
                        {ownerOverrideLabel && (
                          <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-800 ring-1 ring-inset ring-violet-600/20">
                            {ownerOverrideLabel}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            reviewStatusStyles[selected.reviewStatus]
                          }`}
                        >
                          {formatReviewStatusLabel(selected.reviewStatus, correctionRequired)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            paymentStatusStyles[selected.producerPaymentStatus]
                          }`}
                        >
                          {formatLabel(selected.producerPaymentStatus)}
                        </span>
                      </div>

                      {correctionRequired && (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-950">
                          <p className="font-semibold">Correction Required</p>
                          <p className="mt-1">Returned by: {selected.reviewReturnedByName}</p>
                          <p>Returned on: {formatDate((selected.reviewReturnedAt || '').slice(0, 10))}</p>
                          <p className="mt-2">Reason: {selected.reviewReturnReason || '—'}</p>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                          Workflow timeline
                        </p>
                        <ol className="space-y-1.5">
                          {timeline.stages.map((item) => {
                            const marker =
                              item.state === 'completed' ? '✓' : item.state === 'current' ? '●' : '○'
                            const showCorrectionNote =
                              correctionRequired &&
                              (item.stage === 'Receipt Confirmed' || item.stage === 'Submitted for Review')
                            return (
                              <li
                                key={item.stage}
                                className={`flex items-center gap-2.5 text-sm ${
                                  item.state === 'current'
                                    ? 'font-semibold text-slate-900'
                                    : item.state === 'completed'
                                      ? 'font-medium text-slate-700'
                                      : 'text-slate-400'
                                }`}
                              >
                                <span
                                  className={`inline-flex w-4 shrink-0 justify-center text-xs ${
                                    item.state === 'completed'
                                      ? 'text-emerald-600'
                                      : item.state === 'current'
                                        ? 'text-alza-blue-600'
                                        : 'text-slate-300'
                                  }`}
                                  aria-hidden
                                >
                                  {marker}
                                </span>
                                <span>{item.stage}</span>
                                {item.state === 'current' && (
                                  <span className="text-xs font-medium text-alza-blue-700">
                                    (current)
                                  </span>
                                )}
                                {showCorrectionNote && item.stage === 'Receipt Confirmed' && (
                                  <span className="text-xs font-medium text-orange-700">
                                    · Correction Required
                                  </span>
                                )}
                              </li>
                            )
                          })}
                        </ol>
                      </div>

                      <DetailGrid
                        items={[
                          [
                            'Reviewer',
                            selected.reviewerUserId
                              ? `${selected.reviewerName}${selected.reviewerRole ? ` · ${formatLabel(selected.reviewerRole)}` : ''}`
                              : '—',
                          ],
                          ['Agency Commission Confirmed', selected.agencyCommissionConfirmed ? 'Yes' : 'No'],
                          [
                            'Review Status',
                            formatReviewStatusLabel(selected.reviewStatus, correctionRequired),
                          ],
                          ['Producer Payment Status', formatLabel(selected.producerPaymentStatus)],
                          ['Receipt ID', selected.agencyCommissionReceiptId || '—'],
                          ['Received date', formatDate(selected.receivedDate)],
                          [
                            'Amount received',
                            selected.amountReceived === null
                              ? '—'
                              : formatCurrency(selected.amountReceived),
                          ],
                          [
                            'Payment batch',
                            selected.paymentBatchNumber || selected.paymentBatchId || '—',
                          ],
                          ['Paid date', formatDate(selected.paidDate)],
                          [
                            'Paid amount',
                            selected.paidAmount === null ? '—' : formatCurrency(selected.paidAmount),
                          ],
                        ]}
                      />

                      {isReadyForPayout(selected) && (
                        <p className="text-xs font-medium text-emerald-700">
                          Eligible for payout batch via Financials → Producer Payments
                        </p>
                      )}
                    </div>
                  )
                })()}
              </Section>

              <Section title="Recoveries on this transaction">
                {recoveriesLoading ? (
                  <p className="text-sm text-slate-500">Loading recoveries...</p>
                ) : recoveries.length === 0 ? (
                  <p className="text-sm text-slate-500">No commission recoveries recorded for this transaction.</p>
                ) : (
                  <ul className="space-y-2">
                    {recoveries.map((row) => {
                      const canDirectPay =
                        canRecovery &&
                        row.status === 'open' &&
                        !row.voidedAt &&
                        row.remainingAmount > 0
                      return (
                        <li key={row.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              {row.recoveryNumber && (
                                <p className="text-xs font-medium text-slate-500">{row.recoveryNumber}</p>
                              )}
                              <span className={`font-semibold tabular-nums ${row.amount < 0 ? 'text-orange-700' : 'text-slate-900'}`}>
                                {formatCurrency(row.amount)}
                              </span>
                            </div>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(row.status)}`}>
                              {formatRecoveryOutcomeLabel({
                                status: row.status,
                                applied_amount: row.appliedAmount,
                                remaining_amount: row.remainingAmount,
                                voided_at: row.voidedAt,
                              })}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDate(row.createdAt)} · Remaining {formatCurrency(row.remainingAmount)}
                            {row.notes ? ` · ${row.notes}` : ''}
                          </p>
                          {canDirectPay && (
                            <button
                              type="button"
                              onClick={() => openDirectPayModal(row)}
                              className="mt-2 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Record Direct Payment
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Section>

              <Section title="Activity History">
                <EntityActivityHistory transactionId={selected.id} title="Timeline" />
              </Section>
            </div>

            <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-6 py-4">
                {canConfirm && !selected.agencyCommissionConfirmed && !selected.voidedAt && (
                  <button type="button" onClick={openConfirmReceipt} className="inline-flex w-full items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90">
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm Commission Received
                  </button>
                )}
                {showSubmitReview && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null)
                      setSubmitReviewOpen(true)
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Submit for Review
                  </button>
                )}
                {selected.agencyCommissionConfirmed &&
                  selected.reviewStatus === 'matched' &&
                  !correctionRequired &&
                  !showApprove && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-900">
                    Submitted for Review — awaiting Owner/Admin approval
                  </p>
                )}
                {selected.reviewStatus === 'approved' && (
                  <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs font-medium text-emerald-800">
                    Review status: Approved
                  </p>
                )}
                {markReadyBlocked && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                    {markReadyBlocked}
                  </p>
                )}
                {showMarkReady && (
                  <button type="button" onClick={() => setReadyOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-4 py-2.5 text-sm font-medium text-alza-blue-800 hover:bg-alza-blue-100">
                    {ownerOverrideLabel ? 'Mark Ready for Payout (Owner Override)' : 'Mark Ready for Payout'}
                  </button>
                )}
                {showGoToPayments && (
                  <button
                    type="button"
                    onClick={() => {
                      const producer = selected.producer.trim()
                      const qs = new URLSearchParams({ tab: 'payments' })
                      if (producer && producer !== '—') qs.set('producer', producer)
                      navigate(`/financials?${qs.toString()}`, {
                        state: financialsLinkState(`/transactions/${selected.id}`),
                      })
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-900 hover:bg-violet-100"
                  >
                    <Wallet className="h-4 w-4" />
                    Go to Producer Payments
                  </button>
                )}
                {showEdit && (
                  <button
                    type="button"
                    onClick={() => void openEditModal()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit Transaction
                  </button>
                )}
                {canRecovery && !selected.voidedAt && selectedFullyRecovered && (
                  <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-center text-xs font-medium text-emerald-800">
                    Fully recovered
                  </p>
                )}
                {canRecovery &&
                  !selected.voidedAt &&
                  !(selected.producerCommissionAmount < 0 && selectedRecoveryAvailable <= 0) && (
                  <button
                    type="button"
                    onClick={() => openRecoveryModal()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Record Recovery / Chargeback
                  </button>
                )}
                {showVoid && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null)
                      setVoidReason('')
                      setVoidOpen(true)
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100"
                  >
                    <Ban className="h-4 w-4" />
                    Void Transaction
                  </button>
                )}
                {showArchive && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null)
                      setArchiveOpen(true)
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100"
                  >
                    <Archive className="h-4 w-4" />
                    Archive Transaction
                  </button>
                )}
            </div>
          </aside>
        </div>
      )}

      {confirmOpen && selected && (
        <Modal title="Confirm Commission Received" onClose={() => !saving && setConfirmOpen(false)}>
          <form onSubmit={handleConfirmReceipt} className="space-y-4">
            <p className="text-sm text-slate-600">
              Creates an <span className="font-medium">agency_commission_receipts</span> record and updates this transaction’s receipt fields. Stored commission amounts are not recalculated.
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                ['Client', selected.clientName],
                ['Policy', selected.policyNumber],
                ['Expected agency commission', formatCurrency(selected.expectedAmount)],
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount received">
                <input required type="number" step="0.01" value={receivedAmount} onChange={(e) => { setReceivedAmount(e.target.value); setVarianceAck(false) }} className={inputClassName} />
              </Field>
              <Field label="Received date">
                <input required type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={inputClassName} />
              </Field>
              <Field label="Source">
                <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Carrier statement, MGA, wire…" className={inputClassName} />
              </Field>
              <Field label="Deposit / reference">
                <input value={depositReference} onChange={(e) => setDepositReference(e.target.value)} className={inputClassName} />
              </Field>
              <Field label="External invoice / payment reference">
                <input value={externalInvoiceId} onChange={(e) => setExternalInvoiceId(e.target.value)} className={inputClassName} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} rows={3} className={textareaClassName} />
            </Field>

            {confirmHasVariance && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <p className="font-medium">Variance detected</p>
                <p className="mt-1">
                  Received {formatCurrency(Number(receivedAmount) || 0)} vs expected{' '}
                  {formatCurrency(selected.expectedAmount)} (
                  {formatCurrency(confirmVariance)}).
                </p>
                <label className="mt-3 flex items-start gap-2">
                  <input type="checkbox" checked={varianceAck} onChange={(e) => setVarianceAck(e.target.checked)} className="mt-1" />
                  <span>I reviewed this variance and want to confirm receipt anyway.</span>
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" disabled={saving} onClick={() => setConfirmOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={saving || (confirmHasVariance && !varianceAck)} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Confirming…' : 'Confirm Receipt'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {readyOpen && selected && (
        <Modal title="Mark Ready for Payout" onClose={() => !saving && setReadyOpen(false)}>
          <p className="text-sm text-slate-600">
            Sets <span className="font-medium">producer_payment_status</span> to <span className="font-medium">ready</span> for{' '}
            {selected.transactionNumber}. Create the payment batch and Confirm Paid only from Financials → Producer Payments.
          </p>
          <DetailGrid
            items={[
              ['Producer', selected.producer],
              ['Producer commission', formatCurrency(selected.producerCommissionAmount)],
              ['Agency confirmed', selected.agencyCommissionConfirmed ? 'Yes' : 'No'],
            ]}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setReadyOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" disabled={saving} onClick={handleMarkReady} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
              {saving ? 'Updating…' : 'Mark Ready for Payout'}
            </button>
          </div>
        </Modal>
      )}

      {recoveryOpen && selected && (
        <Modal
          title="Record Recovery / Chargeback"
          onClose={() => {
            if (saving) return
            setRecoveryOpen(false)
            setRecoveryAssistOpen(false)
          }}
        >
          <form onSubmit={handleCreateRecovery} className="space-y-4">
            <p className="text-sm text-slate-600">
              Creates a <span className="font-medium">producer_commission_recoveries</span> row. This is never created automatically from return premiums.
              {recoveryAssistOpen ? ' Prefilled from return-premium recovery assist.' : ''}
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                ['Producer', selected.producer],
                ['Linked receipt', selected.agencyCommissionReceiptId ? 'Yes' : 'None'],
                ...(selected.producerCommissionAmount < 0
                  ? ([
                      ['Recovery obligation', formatCurrency(selectedRecoveryObligation)],
                      ['Already recovered', formatCurrency(selectedRecoveryCreated)],
                      ['Available to recover', formatCurrency(selectedRecoveryAvailable)],
                    ] as Array<[string, string]>)
                  : []),
              ]}
            />
            <Field label="Recovery amount">
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                max={
                  selected.producerCommissionAmount < 0 && selectedRecoveryAvailable > 0
                    ? selectedRecoveryAvailable
                    : undefined
                }
                value={recoveryAmount}
                onChange={(e) => setRecoveryAmount(e.target.value)}
                className={inputClassName}
              />
            </Field>
            <Field label="Settlement method">
              <select
                value={recoverySettlementMethod}
                onChange={(e) =>
                  setRecoverySettlementMethod(
                    e.target.value === 'direct_payment' ? 'direct_payment' : 'next_payout',
                  )
                }
                className={selectClassName}
              >
                <option value="next_payout">Next payout</option>
                <option value="direct_payment">Direct payment</option>
              </select>
            </Field>
            <Field label="Reason / notes">
              <textarea required value={recoveryNotes} onChange={(e) => setRecoveryNotes(e.target.value)} rows={3} className={textareaClassName} />
            </Field>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setRecoveryOpen(false)
                  setRecoveryAssistOpen(false)
                }}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Recovery'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {directPayOpen && selectedRecoveryId && (
        <Modal title="Record Direct Recovery Payment" onClose={() => !saving && setDirectPayOpen(false)}>
          <form onSubmit={handleDirectRecoveryPayment} className="space-y-4">
            <p className="text-sm text-slate-600">
              Records producer paid agency directly against an open recovery. Does not create a payout batch.
            </p>
            <Field label="Amount received">
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={directPayAmount}
                onChange={(e) => setDirectPayAmount(e.target.value)}
                className={inputClassName}
              />
            </Field>
            <Field label="Received date">
              <input
                required
                type="date"
                value={directPayDate}
                onChange={(e) => setDirectPayDate(e.target.value)}
                className={inputClassName}
              />
            </Field>
            <Field label="Payment reference">
              <input
                value={directPayRef}
                onChange={(e) => setDirectPayRef(e.target.value)}
                className={inputClassName}
              />
            </Field>
            <Field label="Notes">
              <textarea
                value={directPayNotes}
                onChange={(e) => setDirectPayNotes(e.target.value)}
                rows={3}
                className={textareaClassName}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setDirectPayOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {voidOpen && selected && (
        <Modal title="Void Transaction" onClose={() => !saving && setVoidOpen(false)}>
          <form onSubmit={handleVoidTransaction} className="space-y-4">
            <p className="text-sm text-slate-600">
              Voids this financially progressed transaction. It remains in history with a VOID status and cannot be archived or paid.
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                ['Client', selected.clientName],
                ['Policy', selected.policyNumber],
              ]}
            />
            <Field label="Void reason *">
              <textarea
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={4}
                className={textareaClassName}
                placeholder="Explain why this transaction is being voided…"
              />
            </Field>
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              Confirm void. This is a financial integrity action and cannot be undone from the list.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setVoidOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !voidReason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Voiding…' : 'Void Transaction'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editOpen && selected && (
        <Modal title="Edit Transaction" onClose={() => !saving && setEditOpen(false)}>
          <form onSubmit={handleEditTransaction} className="space-y-4">
            <p className="text-sm text-slate-600">
              {showCommissionEdit
                ? isCorrectionRequired(selected)
                  ? 'Returned for Correction — Owner/Admin or assigned CSR may amend amount, commission, dates, and identity. Paid/batched transactions stay locked.'
                  : 'Identity and unconfirmed commission snapshot may be edited. Paid, batched, or receipt-confirmed transactions keep commission locked unless returned for correction.'
                : 'Identity and metadata only. Premium and commission amounts stay locked because this transaction is confirmed, batched, paid, ready for payout, or otherwise financially locked.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Transaction date">
                <input required type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className={inputClassName} />
              </Field>
              <Field label="Type">
                <select required value={editType} onChange={(e) => setEditType(e.target.value)} className={selectClassName}>
                  {[
                    ...TRANSACTION_TYPES_FOR_CREATE,
                    ...(editType &&
                    !(TRANSACTION_TYPES_FOR_CREATE as readonly string[]).includes(editType)
                      ? [editType]
                      : []),
                  ].map((type) => (
                    <option key={type} value={type}>{formatTypeLabel(type)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Transaction Effective Date">
                <input
                  type="date"
                  value={editTransactionEffectiveDate}
                  onChange={(e) => setEditTransactionEffectiveDate(e.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Transaction Expiration Date">
                <input
                  type="date"
                  value={editTransactionExpirationDate}
                  onChange={(e) => setEditTransactionExpirationDate(e.target.value)}
                  className={inputClassName}
                />
              </Field>
              <Field label="Policy Effective Date (read-only)">
                <input
                  disabled
                  type="date"
                  value={
                    policyOptionsForEdit.find((p) => p.id === editPolicyId)?.effectiveDate ||
                    selected.policyEffectiveDate ||
                    ''
                  }
                  className={`${inputClassName} bg-slate-50`}
                />
              </Field>
              <Field label="Policy Expiration Date (read-only)">
                <input
                  disabled
                  type="date"
                  value={
                    policyOptionsForEdit.find((p) => p.id === editPolicyId)?.expirationDate ||
                    selected.policyExpirationDate ||
                    ''
                  }
                  className={`${inputClassName} bg-slate-50`}
                />
              </Field>
              <Field label="Client">
                <select
                  required
                  value={editClientId}
                  onChange={(e) => {
                    const nextClient = e.target.value
                    setEditClientId(nextClient)
                    const stillValid = policyOptionsForEdit.some(
                      (p) => p.id === editPolicyId && p.clientId === nextClient,
                    )
                    if (!stillValid) setEditPolicyId('')
                  }}
                  className={selectClassName}
                >
                  <option value="">Select client…</option>
                  {clientOptionsForEdit.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Policy">
                <select required value={editPolicyId} onChange={(e) => setEditPolicyId(e.target.value)} className={selectClassName}>
                  <option value="">Select policy…</option>
                  {editPoliciesForClient.map((policy) => (
                    <option key={policy.id} value={policy.id}>{policy.number}</option>
                  ))}
                </select>
              </Field>
              <Field label="Producer">
                <DirectoryNameSelect kind="producer" value={editProducer} onChange={setEditProducer} />
              </Field>
              <Field label="CSR">
                <DirectoryNameSelect kind="csr" value={editCsr} onChange={setEditCsr} />
              </Field>
              <Field label="Reviewer">
                <select
                  value={editReviewerUserId}
                  onChange={(e) => setEditReviewerUserId(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">Select Owner/Admin reviewer…</option>
                  {reviewers.map((reviewer) => (
                    <option key={reviewer.id} value={reviewer.id}>
                      {reviewer.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className={inputClassName} />
            </Field>
            <Field label="Notes">
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} className={textareaClassName} />
            </Field>
            <Field label="Remarks">
              <textarea value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} rows={2} className={textareaClassName} />
            </Field>

            {showCommissionEdit ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <p className="mb-3 text-sm font-semibold text-slate-900">Commission snapshot</p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {(['percentage', 'flat'] as CommissionType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setEditCommissionType(type)}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                        editCommissionType === type
                          ? 'border-alza-blue-300 bg-alza-blue-50 text-alza-blue-800'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {formatCommissionTypeLabel(type)}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Transaction Amount">
                    <input type="number" step="0.01" value={editPremiumAmount} onChange={(e) => setEditPremiumAmount(e.target.value)} className={inputClassName} />
                  </Field>
                  {editCommissionType === 'percentage' ? (
                    <Field label="Agency Commission %">
                      <input type="number" min="0" step="0.01" value={editAgencyPct} onChange={(e) => setEditAgencyPct(e.target.value)} className={inputClassName} />
                    </Field>
                  ) : (
                    <Field label="Agency Commission Amount">
                      <input type="number" step="0.01" value={editAgencyAmount} onChange={(e) => setEditAgencyAmount(e.target.value)} className={inputClassName} />
                    </Field>
                  )}
                  <Field label="Broker Fee">
                    <input type="number" step="0.01" value={editBrokerFee} onChange={(e) => setEditBrokerFee(e.target.value)} className={inputClassName} />
                  </Field>
                  <Field label="Producer Split %">
                    <input type="number" min="0" step="0.01" value={editProducerSplit} onChange={(e) => setEditProducerSplit(e.target.value)} className={inputClassName} />
                  </Field>
                </div>
                <DetailGrid
                  items={[
                    ['Agency Commission', editCommissionPreview ? formatCurrency(editCommissionPreview.agencyCommissionAmount) : '—'],
                    ['Broker Fee', editCommissionPreview ? formatCurrency(editCommissionPreview.brokerFee) : '—'],
                    ['Commission Pool', editCommissionPreview ? formatCurrency(editCommissionPreview.commissionPool) : '—'],
                    ['Producer Commission', editCommissionPreview ? formatCurrency(editCommissionPreview.producerCommissionAmount) : '—'],
                    ['Agency Net', editCommissionPreview ? formatCurrency(editCommissionPreview.agencyNetCommission) : '—'],
                  ]}
                />
              </div>
            ) : (
              <DetailGrid
                items={[
                  ['Commission Basis (locked)', formatCommissionTypeLabel(selected.commissionType)],
                  ...(selected.commissionType === 'percentage'
                    ? ([['Agency Commission % (locked)', formatPercent(selected.agencyCommissionPercentage)]] as [
                        string,
                        React.ReactNode,
                      ][])
                    : []),
                  ['Agency Commission Amount (locked)', formatCurrency(selected.agencyCommissionAmount)],
                  ['Broker Fee (locked)', formatCurrency(selected.brokerFee)],
                  ['Commission Pool (locked)', formatCurrency(selected.commissionPool)],
                  ['Producer Split % (locked)', formatPercent(selected.producerSplitPercentage)],
                  ['Producer Commission (locked)', formatCurrency(selected.producerCommissionAmount)],
                  ['Agency Net Commission (locked)', formatCurrency(selected.agencyNetCommission)],
                ]}
              />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEditOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {approveOpen && selected && (
        <Modal title="Approve Transaction Review" onClose={() => !saving && setApproveOpen(false)}>
          <form onSubmit={handleApproveReview} className="space-y-4">
            <p className="text-sm text-slate-600">
              Sets <span className="font-medium">review_status</span> to <span className="font-medium">approved</span>.
              Does not change commission amounts, mark Ready, create a batch, or mark paid.
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                [
                  'Current review',
                  formatReviewStatusLabel(selected.reviewStatus, correctionRequired),
                ],
                ['Agency confirmed', selected.agencyCommissionConfirmed ? 'Yes' : 'No'],
              ]}
            />
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setApproveOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                {saving ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {submitReviewOpen && selected && (
        <Modal title="Submit for Review" onClose={() => !saving && setSubmitReviewOpen(false)}>
          <form onSubmit={handleSubmitForReview} className="space-y-4">
            <p className="text-sm text-slate-600">
              Moves this transaction to <span className="font-medium">Submitted for Review</span> and notifies
              active Owner/Admin reviewers. Payout still requires Approve → Mark Ready → Producer Payments batch.
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                ['Client', selected.clientName],
                ['Policy', selected.policyNumber],
                ['Type', formatTypeLabel(selected.type)],
                ['Amount', formatCurrency(selected.premiumAmount || selected.amount)],
                ['Agency commission', formatCurrency(selected.agencyCommissionAmount)],
                ['Producer', selected.producer],
                ['Producer commission', formatCurrency(selected.producerCommissionAmount)],
                ['CSR', selected.csr],
                ['Receipt confirmed', selected.agencyCommissionConfirmed ? 'Yes' : 'No'],
              ]}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setSubmitReviewOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Submitting…' : 'Submit for Review'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {returnOpen && selected && (
        <Modal title="Return for Correction" onClose={() => !saving && setReturnOpen(false)}>
          <form onSubmit={handleReturnForCorrection} className="space-y-4">
            <p className="text-sm text-slate-600">
              Returns review status to Expected so the CSR can correct details and Submit for Review again.
              Does not change receipt confirmation. Reviewer assignment is kept.
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                [
                  'Current review',
                  formatReviewStatusLabel(selected.reviewStatus, correctionRequired),
                ],
                ['Producer payment', formatLabel(selected.producerPaymentStatus)],
              ]}
            />
            <Field label="Reason for correction *">
              <textarea
                required
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={4}
                className={textareaClassName}
                placeholder="Explain what needs to be corrected…"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setReturnOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !returnReason.trim()}
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {saving ? 'Returning…' : 'Return for Correction'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {archiveOpen && selected && (
        <Modal title="Archive Transaction" onClose={() => !saving && setArchiveOpen(false)}>
          <form onSubmit={handleArchiveTransaction} className="space-y-4">
            <p className="text-sm text-slate-600">
              Soft-archives this transaction (<span className="font-medium">archived_at</span>).
              It will leave the normal list. Hard delete is not available for financial safety.
            </p>
            <DetailGrid
              items={[
                ['Transaction', selected.transactionNumber],
                ['Client', selected.clientName],
                ['Policy', selected.policyNumber],
              ]}
            />
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              Confirm archive. This cannot be undone from the Transactions list.
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setArchiveOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50">
                {saving ? 'Archiving…' : 'Archive Transaction'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <AddTransactionModal
        open={addTxnOpen}
        onClose={() => setAddTxnOpen(false)}
        onCreated={(transactionId) => {
          void loadTransactions()
          navigate(`/transactions/${transactionId}${location.search}`)
        }}
      />
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  negative,
}: {
  label: string
  value: string
  icon: typeof Wallet
  tone: 'blue' | 'teal' | 'orange' | 'amber' | 'violet'
  negative?: boolean
}) {
  const tones = {
    blue: 'bg-alza-blue-50 text-alza-blue-600',
    teal: 'bg-alza-teal-50 text-alza-teal-600',
    orange: 'bg-orange-50 text-orange-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className={`mt-0.5 truncate text-base font-bold tabular-nums ${negative ? 'text-orange-700' : 'text-slate-900'}`}>{value}</p>
        </div>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClassName}>
        {children}
      </select>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-3 text-sm font-semibold text-slate-900">{title}</h4>
      {children}
    </section>
  )
}

function DetailGrid({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs font-medium text-slate-500">{label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close dialog" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
