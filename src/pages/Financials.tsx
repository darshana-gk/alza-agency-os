import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  CircleDollarSign,
  FileText,
  RotateCcw,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import {
  badgeClass,
  canConfirmProducerPaid,
  confirmAgencyCommissionReceived,
  confirmProducerPaid,
  createProducerPaymentBatch,
  createProducerRecovery,
  fetchCommissionTransactions,
  formatBatchStatusLabel,
  formatCurrency,
  formatDate,
  formatLabel,
  formatPercent,
  formatProducerPaymentMethodLabel,
  formatRecoverySettlementLabel,
  formatRecoveryStatusLabel,
  isDirectPaymentSettlement,
  isPayoutAppliedSettlement,
  isReadyForPayout,
  isValidProducerPaymentConfirmMethod,
  netAfterRecoveries,
  normalizeBatchStatus,
  normalizeRecoveryStatus,
  PRODUCER_PAYMENT_CONFIRM_METHODS,
  todayIsoDate,
  toNumber,
  validateConfirmPaidOutsideAlzaFlowInput,
  voidProducerRecovery,
  type CommissionTransaction,
} from '../lib/commission'
import { ExportMenu } from '../components/ui/ExportMenu'
import { useAgency } from '../lib/agencyContext'
import { useAuth } from '../lib/auth'
import {
  formatPaymentChannelLabel,
  formatPayoutScheduleLabel,
  nextPlannedPayoutDate,
} from '../lib/producerPayoutSchedule'
import {
  producerPaymentExportColumns,
  receiptExportColumns,
  recoveryExportColumns,
} from '../lib/exportDefinitions'
import {
  financialsLinkState,
  financialsRecordLinkClassName,
  parseFinancialsTab,
  type FinancialsTabId,
} from '../lib/financialsNav'
import { downloadTableExport } from '../lib/tableExport'
import {
  canAccessAdminSection,
  canConfirmReceipts,
  canMutateFinancialPayments,
} from '../lib/permissions'
import { SortableTh } from '../components/ui/SortableTh'
import { supabase } from '../lib/supabase'
import {
  DEFAULT_PRODUCER_PAYMENT_SORT,
  buildProducerPaymentRenderedRows,
  isProducerPaymentHeaderActive,
  mapProducerPaymentCreatedAt,
  nextProducerPaymentSort,
  producerPaymentHeaderDirection,
  type ProducerPaymentSort,
  type ProducerPaymentSortKey,
} from '../lib/producerPaymentTable'
import {
  compareIsoDate,
  nextTableSort,
  sortRows,
  type TableSortState,
} from '../lib/tableSort'

type FinancialsTab = FinancialsTabId

interface ClientEmbed {
  business_name: string | null
}

interface TransactionEmbed {
  transaction_number: string | null
}

interface ReceiptRow {
  id: string
  created_at: string
  notes: string | null
  client_id: string | null
  policy_id: string | null
  transaction_id: string | null
  producer: string | null
  source: string | null
  external_invoice_id: string | null
  policy_number: string | null
  client_name: string | null
  deposit_reference: string | null
  imported_at: string | null
  reconciliation_status: string | null
  settlement_date: string | null
  clients: ClientEmbed | ClientEmbed[] | null
  transactions: TransactionEmbed | TransactionEmbed[] | null
}

interface RecoveryRow {
  id: string
  created_at: string
  notes: string | null
  status: string | null
  amount: number | string | null
  applied_amount: number | string | null
  remaining_amount: number | string | null
  recovery_number: string | null
  transaction_id: string | null
  producer: string | null
  receipt_id: string | null
  settlement_method: string | null
  transactions:
    | (TransactionEmbed & { client_id?: string | null; policy_id?: string | null })
    | (TransactionEmbed & { client_id?: string | null; policy_id?: string | null })[]
    | null
  agency_commission_receipts:
    | {
        id: string
        client_id: string | null
        policy_id: string | null
        client_name: string | null
        policy_number: string | null
      }
    | {
        id: string
        client_id: string | null
        policy_id: string | null
        client_name: string | null
        policy_number: string | null
      }[]
    | null
}

interface PaymentBatchRow {
  id: string
  created_at: string
  notes: string | null
  status: string | null
  producer: string | null
  payment_date: string | null
  batch_number: string | null
  gross_commission: number | string | null
  net_payment: number | string | null
  payment_method: string | null
  payment_reference: string | null
  voided_at: string | null
  confirmed_by?: string | null
  confirmed_at?: string | null
  payment_channel?: string | null
  producer_payment_batch_items:
    | {
        id: string
        batch_id: string | null
        transaction_id: string | null
        net_amount: number | string | null
        transactions: TransactionEmbed | TransactionEmbed[] | null
      }[]
    | {
        id: string
        batch_id: string | null
        transaction_id: string | null
        net_amount: number | string | null
        transactions: TransactionEmbed | TransactionEmbed[] | null
      }
    | null
}

interface Receipt {
  id: string
  settlementDate: string | null
  importedAt: string | null
  clientId: string
  policyId: string
  transactionId: string
  clientName: string
  policyNumber: string
  transactionNumber: string
  source: string
  depositReference: string
  reconciliationStatus: string
  producer: string
  notes: string
}

interface Recovery {
  id: string
  recoveryNumber: string | null
  createdAt: string
  producer: string
  amount: number
  appliedAmount: number
  remainingAmount: number
  status: string
  settlementMethod: string
  notes: string
  transactionNumber: string
  receiptLabel: string
  transactionId: string
  receiptId: string | null
  clientId: string
  policyId: string
  clientName: string
  policyNumber: string
}

interface PaymentBatch {
  id: string
  createdAt: string
  batchNumber: string
  producer: string
  paymentDate: string | null
  grossCommission: number
  netPayment: number
  status: string
  paymentMethod: string
  paymentReference: string
  notes: string
  voided: boolean
  itemCount: number
  transactionIds: string[]
  itemNetAmounts: Record<string, number>
  paymentChannel: string | null
  confirmedBy: string | null
  confirmedAt: string | null
}

interface RecoveryAmountRow {
  producer: string | null
  amount: number | string | null
  applied_amount: number | string | null
  remaining_amount: number | string | null
  status: string | null
  settlement_method: string | null
}

const ALL = 'all'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const BATCH_ITEMS_EMBED = `
            producer_payment_batch_items (
              id, batch_id, transaction_id, net_amount,
              transactions ( transaction_number )
            )
`

const BATCH_SELECT_WITH_AUDIT = `
            id, created_at, notes, status, producer, payment_date, batch_number,
            gross_commission, net_payment, payment_method, payment_reference, voided_at,
            confirmed_by, confirmed_at, payment_channel,
            ${BATCH_ITEMS_EMBED}
          `

const BATCH_SELECT_LEGACY = `
            id, created_at, notes, status, producer, payment_date, batch_number,
            gross_commission, net_payment, payment_method, payment_reference, voided_at,
            ${BATCH_ITEMS_EMBED}
          `

function isMissingColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  const msg = (error.message ?? '').toLowerCase()
  const code = error.code ?? ''
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    msg.includes('payment_channel') ||
    msg.includes('confirmed_by') ||
    msg.includes('confirmed_at')
  )
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapReceipt(row: ReceiptRow): Receipt {
  const client = firstEmbed(row.clients)
  const txn = firstEmbed(row.transactions)
  return {
    id: row.id,
    settlementDate: row.settlement_date,
    importedAt: row.imported_at ?? row.created_at,
    clientId: row.client_id ?? '',
    policyId: row.policy_id ?? '',
    transactionId: row.transaction_id ?? '',
    clientName: row.client_name?.trim() || client?.business_name?.trim() || '—',
    policyNumber: row.policy_number?.trim() || '—',
    transactionNumber: txn?.transaction_number?.trim() || '—',
    source: row.source?.trim() || '—',
    depositReference: row.deposit_reference?.trim() || row.external_invoice_id?.trim() || '—',
    reconciliationStatus: (row.reconciliation_status ?? 'pending').toLowerCase(),
    producer: row.producer?.trim() || '—',
    notes: row.notes?.trim() || '—',
  }
}

function mapRecovery(row: RecoveryRow): Recovery {
  const txn = firstEmbed(row.transactions)
  const receipt = firstEmbed(row.agency_commission_receipts)
  const clientName = receipt?.client_name?.trim() || '—'
  const policyNumber = receipt?.policy_number?.trim() || '—'
  const receiptBits = [clientName !== '—' ? clientName : null, policyNumber !== '—' ? policyNumber : null].filter(
    Boolean,
  )
  const amount = toNumber(row.amount)
  const appliedAmount = toNumber(row.applied_amount)
  const remainingAmount =
    row.remaining_amount == null ? Math.max(0, amount - appliedAmount) : toNumber(row.remaining_amount)
  return {
    id: row.id,
    recoveryNumber: row.recovery_number?.trim() || null,
    createdAt: row.created_at,
    producer: row.producer?.trim() || '—',
    amount,
    appliedAmount,
    remainingAmount,
    status: normalizeRecoveryStatus(row.status),
    settlementMethod: isDirectPaymentSettlement(row.settlement_method)
      ? 'direct_payment'
      : 'next_payout',
    notes: row.notes?.trim() || '—',
    transactionNumber: txn?.transaction_number?.trim() || '—',
    receiptLabel: receiptBits.length > 0 ? receiptBits.join(' · ') : row.receipt_id ? 'Linked receipt' : '—',
    transactionId: row.transaction_id ?? '',
    receiptId: row.receipt_id,
    clientId: receipt?.client_id ?? txn?.client_id ?? '',
    policyId: receipt?.policy_id ?? txn?.policy_id ?? '',
    clientName,
    policyNumber,
  }
}

function mapBatch(row: PaymentBatchRow): PaymentBatch {
  const items = Array.isArray(row.producer_payment_batch_items)
    ? row.producer_payment_batch_items
    : row.producer_payment_batch_items
      ? [row.producer_payment_batch_items]
      : []
  const itemNetAmounts: Record<string, number> = {}
  const transactionIds: string[] = []
  for (const item of items) {
    if (!item.transaction_id) continue
    transactionIds.push(item.transaction_id)
    itemNetAmounts[item.transaction_id] = toNumber(item.net_amount)
  }
  return {
    id: row.id,
    createdAt: mapProducerPaymentCreatedAt(row.created_at),
    batchNumber: row.batch_number?.trim() || '—',
    producer: row.producer?.trim() || '—',
    paymentDate: row.payment_date,
    grossCommission: toNumber(row.gross_commission),
    netPayment: toNumber(row.net_payment),
    status: normalizeBatchStatus(row.status),
    paymentMethod: row.payment_method?.trim() || '—',
    paymentReference: row.payment_reference?.trim() || '—',
    notes: row.notes?.trim() || '—',
    voided: Boolean(row.voided_at),
    itemCount: items.length,
    transactionIds,
    itemNetAmounts,
    paymentChannel: row.payment_channel?.trim() || null,
    confirmedBy: row.confirmed_by ?? null,
    confirmedAt: row.confirmed_at ?? null,
  }
}

export function Financials() {
  const { profile } = useAuth()
  const { agency } = useAgency()
  const canPay = canMutateFinancialPayments(profile?.role)
  const canConfirm = canConfirmReceipts(profile?.role)
  const canLinkProducers = canAccessAdminSection(profile?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseFinancialsTab(searchParams.get('tab'))

  function setTab(next: FinancialsTab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'receipts') params.delete('tab')
        else params.set('tab', next)
        // Status meanings differ by tab — clear when switching.
        params.delete('status')
        if (next !== 'receipts') {
          params.delete('client')
          params.delete('policy')
        }
        return params
      },
      { replace: true },
    )
  }

  function setParam(key: string, value: string, allToken = ALL) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (!value || value === allToken) params.delete(key)
        else params.set(key, value)
        return params
      },
      { replace: true },
    )
  }

  const search = searchParams.get('q') ?? ''
  const statusFilter = searchParams.get('status') ?? ALL
  const yearFilter = searchParams.get('year') ?? ALL
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo = searchParams.get('dateTo') ?? ''
  const clientFilter = searchParams.get('client') ?? ALL
  const policyFilter = searchParams.get('policy') ?? ALL
  const producerFilter = searchParams.get('producer') ?? ALL

  const financialsReturnTo = useMemo(() => {
    const qs = searchParams.toString()
    return qs ? `/financials?${qs}` : '/financials'
  }, [searchParams])

  const navState = useMemo(() => financialsLinkState(financialsReturnTo), [financialsReturnTo])
  const [loading, setLoading] = useState(true)
  const [receiptsError, setReceiptsError] = useState<string | null>(null)
  const [batchesError, setBatchesError] = useState<string | null>(null)
  const [recoveriesError, setRecoveriesError] = useState<string | null>(null)
  const [transactionsError, setTransactionsError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [batches, setBatches] = useState<PaymentBatch[]>([])
  const [recoveries, setRecoveries] = useState<Recovery[]>([])
  const [transactions, setTransactions] = useState<CommissionTransaction[]>([])
  const [recoveryAmounts, setRecoveryAmounts] = useState<RecoveryAmountRow[]>([])

  const [selectedReadyIds, setSelectedReadyIds] = useState<string[]>([])
  const [batchNotes, setBatchNotes] = useState('')
  const [createBatchOpen, setCreateBatchOpen] = useState(false)
  const [payBatch, setPayBatch] = useState<PaymentBatch | null>(null)
  const [viewBatch, setViewBatch] = useState<PaymentBatch | null>(null)
  const [paymentDate, setPaymentDate] = useState(todayIsoDate())
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentSort, setPaymentSort] = useState<ProducerPaymentSort>(DEFAULT_PRODUCER_PAYMENT_SORT)
  const [receiptSort, setReceiptSort] = useState<
    TableSortState<'settlement' | 'client' | 'policy' | 'transaction' | 'status'>
  >({ key: 'settlement', direction: 'desc' })
  const [recoverySort, setRecoverySort] = useState<
    TableSortState<
      | 'recoveryNumber'
      | 'createdAt'
      | 'producer'
      | 'amount'
      | 'applied'
      | 'remaining'
      | 'status'
      | 'settlement'
      | 'transaction'
    >
  >({ key: 'createdAt', direction: 'desc' })
  const [saving, setSaving] = useState(false)

  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryTxnId, setRecoveryTxnId] = useState('')
  const [recoveryAmount, setRecoveryAmount] = useState('')
  const [recoveryNotes, setRecoveryNotes] = useState('')
  const [voidRecoveryId, setVoidRecoveryId] = useState<string | null>(null)
  const [voidRecoveryLabel, setVoidRecoveryLabel] = useState('')

  const [confirmTxn, setConfirmTxn] = useState<CommissionTransaction | null>(null)
  const [receivedAmount, setReceivedAmount] = useState('')
  const [receivedDate, setReceivedDate] = useState(todayIsoDate())
  const [receiptSource, setReceiptSource] = useState('')
  const [depositReference, setDepositReference] = useState('')
  const [externalInvoiceId, setExternalInvoiceId] = useState('')
  const [receiptNotes, setReceiptNotes] = useState('')
  const [varianceAck, setVarianceAck] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setReceiptsError(null)
    setBatchesError(null)
    setRecoveriesError(null)
    setTransactionsError(null)

    const [receiptsResult, batchesFirst, recoveriesResult, txResult, recoveryAmtResult] =
      await Promise.all([
        supabase
          .from('agency_commission_receipts')
          .select(
            `
            id, created_at, notes, client_id, policy_id, transaction_id, producer, source,
            external_invoice_id, policy_number, client_name, deposit_reference, imported_at,
            reconciliation_status, settlement_date,
            clients ( business_name ),
            transactions!agency_commission_receipts_transaction_id_fkey ( transaction_number )
          `,
          )
          .order('settlement_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('producer_payment_batches')
          .select(BATCH_SELECT_WITH_AUDIT)
          .order('created_at', { ascending: false })
          .order('batch_number', { ascending: false }),
        supabase
          .from('producer_commission_recoveries')
          .select(
            `
            id, created_at, notes, status, amount, applied_amount, remaining_amount,
            recovery_number, transaction_id, producer, receipt_id, settlement_method,
            transactions ( transaction_number, client_id, policy_id ),
            agency_commission_receipts ( id, client_id, policy_id, client_name, policy_number )
          `,
          )
          .order('created_at', { ascending: false }),
        fetchCommissionTransactions(),
        supabase
          .from('producer_commission_recoveries')
          .select('producer, amount, applied_amount, remaining_amount, status, settlement_method'),
      ])

    let batchesResult: { data: unknown; error: { message: string } | null } = batchesFirst
    if (batchesResult.error && isMissingColumnError(batchesResult.error)) {
      batchesResult = await supabase
        .from('producer_payment_batches')
        .select(BATCH_SELECT_LEGACY)
        .order('created_at', { ascending: false })
        .order('batch_number', { ascending: false })
    }

    if (receiptsResult.error) {
      setReceiptsError(receiptsResult.error.message)
      setReceipts([])
    } else {
      setReceipts(((receiptsResult.data ?? []) as unknown as ReceiptRow[]).map(mapReceipt))
    }

    if (batchesResult.error) {
      setBatchesError(batchesResult.error.message)
      setBatches([])
    } else {
      setBatches(((batchesResult.data ?? []) as unknown as PaymentBatchRow[]).map(mapBatch))
    }

    if (recoveriesResult.error) {
      setRecoveriesError(recoveriesResult.error.message)
      setRecoveries([])
    } else {
      setRecoveries(((recoveriesResult.data ?? []) as unknown as RecoveryRow[]).map(mapRecovery))
    }

    if (txResult.error) {
      setTransactionsError(txResult.error.message)
      setTransactions([])
    } else {
      setTransactions(txResult.data)
    }

    if (!recoveryAmtResult.error) {
      setRecoveryAmounts((recoveryAmtResult.data ?? []) as RecoveryAmountRow[])
    } else {
      setRecoveryAmounts([])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  function rowDate(value: string | null | undefined): string {
    if (!value) return ''
    return value.slice(0, 10)
  }

  function matchesYearAndRange(dateValue: string | null | undefined): boolean {
    const iso = rowDate(dateValue)
    if (yearFilter !== ALL) {
      if (!iso || iso.slice(0, 4) !== yearFilter) return false
    }
    if (dateFrom && (!iso || iso < dateFrom)) return false
    if (dateTo && (!iso || iso > dateTo)) return false
    return true
  }

  const openRecoveryByProducer = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of recoveryAmounts) {
      const producer = (row.producer ?? '').trim()
      if (!producer) continue
      if (normalizeRecoveryStatus(row.status) !== 'open') continue
      if (!isPayoutAppliedSettlement(row.settlement_method)) continue
      const remaining =
        row.remaining_amount == null
          ? Math.max(0, toNumber(row.amount) - toNumber(row.applied_amount))
          : toNumber(row.remaining_amount)
      if (remaining <= 0) continue
      map.set(producer, (map.get(producer) ?? 0) + remaining)
    }
    return map
  }, [recoveryAmounts])

  const openDirectRecoveryByProducer = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of recoveryAmounts) {
      const producer = (row.producer ?? '').trim()
      if (!producer) continue
      if (normalizeRecoveryStatus(row.status) !== 'open') continue
      if (!isDirectPaymentSettlement(row.settlement_method)) continue
      const remaining =
        row.remaining_amount == null
          ? Math.max(0, toNumber(row.amount) - toNumber(row.applied_amount))
          : toNumber(row.remaining_amount)
      if (remaining <= 0) continue
      map.set(producer, (map.get(producer) ?? 0) + remaining)
    }
    return map
  }, [recoveryAmounts])

  const nextPlannedPayout = useMemo(
    () =>
      nextPlannedPayoutDate({
        schedule: agency?.producerPayoutSchedule,
        anchorDate: agency?.producerPayoutAnchorDate,
      }),
    [agency?.producerPayoutSchedule, agency?.producerPayoutAnchorDate],
  )

  const kpis = useMemo(() => {
    const expectedAgency = transactions.reduce((sum, tx) => sum + tx.expectedAmount, 0)
    const receivedAgency = transactions
      .filter((tx) => tx.agencyCommissionConfirmed)
      .reduce((sum, tx) => sum + (tx.amountReceived ?? 0), 0)

    const readyByProducerGross = new Map<string, number>()
    for (const tx of transactions.filter(isReadyForPayout)) {
      const key = tx.producer.trim()
      if (!key || key === '—') continue
      readyByProducerGross.set(key, (readyByProducerGross.get(key) ?? 0) + tx.producerCommissionAmount)
    }

    let producerPayableGross = 0
    let producerPayableOpenRecoveries = 0
    let producerPayable = 0
    for (const [producer, gross] of readyByProducerGross.entries()) {
      const openRec = openRecoveryByProducer.get(producer) ?? 0
      producerPayableGross += gross
      producerPayableOpenRecoveries += Math.min(openRec, gross)
      producerPayable += netAfterRecoveries(gross, openRec)
    }

    const producerPaid = transactions
      .filter((tx) => tx.producerPaymentStatus === 'paid')
      .reduce((sum, tx) => sum + (tx.paidAmount ?? tx.producerCommissionAmount), 0)
    const agencyNet = transactions.reduce((sum, tx) => sum + tx.agencyNetCommission, 0)
    const recoveriesOpen = recoveries
      .filter((row) => row.status === 'open' && isPayoutAppliedSettlement(row.settlementMethod))
      .reduce((sum, row) => sum + row.remainingAmount, 0)
    const directRecoveriesOpen = recoveries
      .filter((row) => row.status === 'open' && isDirectPaymentSettlement(row.settlementMethod))
      .reduce((sum, row) => sum + row.remainingAmount, 0)

    return {
      expectedAgency,
      receivedAgency,
      producerPayable,
      producerPayableGross,
      producerPayableOpenRecoveries,
      producerPaid,
      agencyNet,
      recoveriesOpen,
      directRecoveriesOpen,
    }
  }, [transactions, recoveries, openRecoveryByProducer])

  const readyItems = useMemo(() => {
    return transactions.filter(isReadyForPayout).map((tx) => ({ tx }))
  }, [transactions])

  const pendingReceiptConfirmations = useMemo(() => {
    return transactions
      .filter((tx) => !tx.agencyCommissionConfirmed && !tx.archived)
      .sort((a, b) => String(b.transactionDate).localeCompare(String(a.transactionDate)))
      .slice(0, 25)
  }, [transactions])

  const confirmHasVariance = useMemo(() => {
    if (!confirmTxn) return false
    const amount = Number(receivedAmount)
    if (!Number.isFinite(amount)) return false
    return Math.abs(amount - confirmTxn.expectedAmount) > 0.009
  }, [confirmTxn, receivedAmount])

  const confirmVariance = useMemo(() => {
    if (!confirmTxn) return 0
    return (Number(receivedAmount) || 0) - confirmTxn.expectedAmount
  }, [confirmTxn, receivedAmount])

  const readyByProducer = useMemo(() => {
    const groups = new Map<
      string,
      {
        items: typeof readyItems
        gross: number
        openRecoveries: number
        openDirectRecoveries: number
        netProposed: number
      }
    >()
    for (const item of readyItems) {
      const key = item.tx.producer.trim()
      if (!key || key === '—') continue
      const existing = groups.get(key)
      if (existing) {
        existing.items.push(item)
        existing.gross += item.tx.producerCommissionAmount
      } else {
        groups.set(key, {
          items: [item],
          gross: item.tx.producerCommissionAmount,
          openRecoveries: 0,
          openDirectRecoveries: 0,
          netProposed: 0,
        })
      }
    }
    for (const [producer, group] of groups.entries()) {
      group.openRecoveries = openRecoveryByProducer.get(producer) ?? 0
      group.openDirectRecoveries = openDirectRecoveryByProducer.get(producer) ?? 0
      group.netProposed = netAfterRecoveries(group.gross, group.openRecoveries)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [readyItems, openRecoveryByProducer, openDirectRecoveryByProducer])

  const selectedReady = useMemo(
    () => readyItems.filter((item) => selectedReadyIds.includes(item.tx.id)),
    [readyItems, selectedReadyIds],
  )

  const selectedBatchPreview = useMemo(() => {
    if (selectedReady.length === 0) {
      return {
        producer: '',
        gross: 0,
        openRecoveries: 0,
        openDirectRecoveries: 0,
        recoveryApplied: 0,
        net: 0,
      }
    }
    const producers = [...new Set(selectedReady.map((item) => item.tx.producer.trim()))]
    const producer = producers.length === 1 ? producers[0] : ''
    const gross = selectedReady.reduce((sum, item) => sum + item.tx.producerCommissionAmount, 0)
    const openRecoveries = producer ? (openRecoveryByProducer.get(producer) ?? 0) : 0
    const openDirectRecoveries = producer ? (openDirectRecoveryByProducer.get(producer) ?? 0) : 0
    const recoveryApplied = Math.min(openRecoveries, gross)
    const net = netAfterRecoveries(gross, openRecoveries)
    return { producer, gross, openRecoveries, openDirectRecoveries, recoveryApplied, net }
  }, [selectedReady, openRecoveryByProducer, openDirectRecoveryByProducer])

  const selectedProducers = useMemo(
    () => [...new Set(selectedReady.map((item) => item.tx.producer))],
    [selectedReady],
  )

  const transactionsById = useMemo(() => {
    const map = new Map<string, CommissionTransaction>()
    for (const tx of transactions) map.set(tx.id, tx)
    return map
  }, [transactions])

  const statusOptions = useMemo(() => {
    if (tab === 'receipts') return [...new Set(receipts.map((r) => r.reconciliationStatus))].sort()
    if (tab === 'payments') return [...new Set(batches.map((b) => b.status))].sort()
    return [...new Set(recoveries.map((r) => r.status))].sort()
  }, [tab, receipts, batches, recoveries])

  const yearOptions = useMemo(() => {
    const years = new Set<string>()
    const add = (value: string | null | undefined) => {
      const y = rowDate(value).slice(0, 4)
      if (/^\d{4}$/.test(y)) years.add(y)
    }
    if (tab === 'receipts') {
      for (const row of receipts) {
        add(row.settlementDate)
        add(row.importedAt)
      }
    } else if (tab === 'payments') {
      for (const row of batches) add(row.createdAt)
    } else {
      for (const row of recoveries) add(row.createdAt)
    }
    return [...years].sort((a, b) => b.localeCompare(a))
  }, [tab, receipts, batches, recoveries])

  const receiptClientOptions = useMemo(
    () => [...new Set(receipts.map((r) => r.clientName).filter((v) => v && v !== '—'))].sort(),
    [receipts],
  )

  const receiptPolicyOptions = useMemo(
    () => [...new Set(receipts.map((r) => r.policyNumber).filter((v) => v && v !== '—'))].sort(),
    [receipts],
  )

  const producerOptions = useMemo(() => {
    if (tab === 'receipts') {
      return [...new Set(receipts.map((r) => r.producer).filter((v) => v && v !== '—'))].sort()
    }
    if (tab === 'payments') {
      return [...new Set(batches.map((b) => b.producer).filter((v) => v && v !== '—'))].sort()
    }
    return [...new Set(recoveries.map((r) => r.producer).filter((v) => v && v !== '—'))].sort()
  }, [tab, receipts, batches, recoveries])

  const filteredReceipts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return receipts.filter((row) => {
      if (statusFilter !== ALL && row.reconciliationStatus !== statusFilter) return false
      if (clientFilter !== ALL && row.clientName !== clientFilter) return false
      if (policyFilter !== ALL && row.policyNumber !== policyFilter) return false
      if (producerFilter !== ALL && row.producer !== producerFilter) return false
      if (!matchesYearAndRange(row.settlementDate || row.importedAt)) return false
      if (!query) return true
      return (
        row.clientName.toLowerCase().includes(query) ||
        row.policyNumber.toLowerCase().includes(query) ||
        row.transactionNumber.toLowerCase().includes(query) ||
        row.source.toLowerCase().includes(query) ||
        row.depositReference.toLowerCase().includes(query) ||
        row.producer.toLowerCase().includes(query)
      )
    })
  }, [receipts, search, statusFilter, clientFilter, policyFilter, producerFilter, yearFilter, dateFrom, dateTo])

  const sortedReceipts = useMemo(
    () =>
      sortRows(
        filteredReceipts,
        receiptSort,
        {
          settlement: (row) => row.settlementDate || row.importedAt,
          client: (row) => row.clientName,
          policy: (row) => row.policyNumber,
          transaction: (row) => row.transactionNumber,
          status: (row) => row.reconciliationStatus,
        },
        { settlement: 'date' },
        (a, b) => compareIsoDate(a.importedAt, b.importedAt, 'desc'),
      ),
    [filteredReceipts, receiptSort],
  )

  const filteredBatches = useMemo(() => {
    const { sorted } = buildProducerPaymentRenderedRows(batches, {
      filter: {
        search,
        statusFilter,
        producerFilter,
        matchesYearAndRange,
      },
      sort: paymentSort,
    })
    return sorted
  }, [batches, search, statusFilter, producerFilter, yearFilter, dateFrom, dateTo, paymentSort])

  function handlePaymentSort(key: ProducerPaymentSortKey) {
    setPaymentSort((current) => nextProducerPaymentSort(current, key))
  }

  const filteredRecoveries = useMemo(() => {
    const query = search.trim().toLowerCase()
    return recoveries.filter((row) => {
      if (statusFilter !== ALL && row.status !== statusFilter) return false
      if (producerFilter !== ALL && row.producer !== producerFilter) return false
      if (!matchesYearAndRange(row.createdAt)) return false
      if (!query) return true
      return (
        row.producer.toLowerCase().includes(query) ||
        row.transactionNumber.toLowerCase().includes(query) ||
        (row.recoveryNumber || '').toLowerCase().includes(query) ||
        row.notes.toLowerCase().includes(query)
      )
    })
  }, [recoveries, search, statusFilter, producerFilter, yearFilter, dateFrom, dateTo])

  const sortedRecoveries = useMemo(
    () =>
      sortRows(
        filteredRecoveries,
        recoverySort,
        {
          recoveryNumber: (row) => row.recoveryNumber,
          createdAt: (row) => row.createdAt,
          producer: (row) => row.producer,
          amount: (row) => row.amount,
          applied: (row) => row.appliedAmount,
          remaining: (row) => row.remainingAmount,
          status: (row) => row.status,
          settlement: (row) => row.settlementMethod,
          transaction: (row) => row.transactionNumber,
        },
        {
          createdAt: 'date',
          amount: 'number',
          applied: 'number',
          remaining: 'number',
        },
      ),
    [filteredRecoveries, recoverySort],
  )

  function toggleReadyId(id: string) {
    if (!canPay) return
    setSelectedReadyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function selectProducerGroup(producer: string) {
    if (!canPay) return
    const ids = readyItems.filter((item) => item.tx.producer === producer).map((item) => item.tx.id)
    setSelectedReadyIds((prev) => {
      const allSelected = ids.every((id) => prev.includes(id))
      if (allSelected) return prev.filter((id) => !ids.includes(id))
      return [...new Set([...prev, ...ids])]
    })
  }

  function openConfirmReceipt(tx: CommissionTransaction) {
    if (!canConfirm) return
    setActionError(null)
    setActionSuccess(null)
    setConfirmTxn(tx)
    setReceivedAmount(String(tx.expectedAmount))
    setReceivedDate(todayIsoDate())
    setReceiptSource('')
    setDepositReference('')
    setExternalInvoiceId('')
    setReceiptNotes('')
    setVarianceAck(false)
  }

  async function handleConfirmReceipt(e: FormEvent) {
    e.preventDefault()
    if (!confirmTxn || !canConfirm) return
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
      transaction: confirmTxn,
      amountReceived: amount,
      receivedDate,
      source: receiptSource,
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

    setConfirmTxn(null)
    setActionSuccess('Agency commission receipt confirmed.')
    await loadAll()
  }

  async function handleCreateBatch(e: FormEvent) {
    e.preventDefault()
    if (!canPay) {
      setActionError('You do not have permission to create producer payment batches.')
      return
    }
    if (selectedReady.length === 0) {
      setActionError('Select at least one ready transaction.')
      return
    }
    if (selectedProducers.length !== 1) {
      setActionError('A payment batch must include transactions for a single producer.')
      return
    }

    setSaving(true)
    setActionError(null)

    const result = await createProducerPaymentBatch({
      producer: selectedProducers[0],
      transactionIds: selectedReady.map((item) => item.tx.id),
      notes: batchNotes,
    })
    setSaving(false)

    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }

    setCreateBatchOpen(false)
    setBatchNotes('')
    setSelectedReadyIds([])
    setActionSuccess(
      `Payment batch ${result.data?.batchNumber} created. Gross ${formatCurrency(result.data?.grossCommission ?? 0)}, recovery applied ${formatCurrency(result.data?.recoveryApplied ?? 0)}, net ${formatCurrency(result.data?.netPayment ?? 0)}. Confirm paid when payment is complete.`,
    )
    await loadAll()
  }

  async function handleConfirmPaid(e: FormEvent) {
    e.preventDefault()
    if (!canPay) {
      setActionError('You do not have permission to confirm producer payments.')
      return
    }
    if (!payBatch) return
    if (!paymentDate.trim()) {
      setActionError('Payment date is required.')
      return
    }
    const confirmValidation = validateConfirmPaidOutsideAlzaFlowInput({
      paymentDate,
      paymentMethod,
      paymentReference,
      notes: paymentNotes,
    })
    if (confirmValidation) {
      setActionError(confirmValidation)
      return
    }

    setSaving(true)
    setActionError(null)
    const result = await confirmProducerPaid({
      batchId: payBatch.id,
      paymentDate,
      paymentMethod,
      paymentReference,
      notes: paymentNotes,
    })
    setSaving(false)

    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }

    setPayBatch(null)
    setPaymentNotes('')
    setActionSuccess(`Payment confirmed outside ALZA Flow for batch ${payBatch.batchNumber}.`)
    await loadAll()
  }

  const confirmPaidReady =
    Boolean(paymentDate.trim()) && isValidProducerPaymentConfirmMethod(paymentMethod)

  async function handleCreateRecovery(e: FormEvent) {
    e.preventDefault()
    if (!canPay) {
      setActionError('You do not have permission to record producer recoveries.')
      return
    }
    const tx = transactions.find((row) => row.id === recoveryTxnId)
    if (!tx) {
      setActionError('Select a transaction for the recovery.')
      return
    }
    if (!tx.producer.trim() || tx.producer === '—') {
      setActionError('Selected transaction has no producer.')
      return
    }
    const amount = Number(recoveryAmount)
    if (!Number.isFinite(amount) || !(amount > 0)) {
      setActionError('Enter a recovery amount greater than zero.')
      return
    }
    if (!recoveryNotes.trim()) {
      setActionError('Reason / notes are required.')
      return
    }

    setSaving(true)
    setActionError(null)
    const result = await createProducerRecovery({
      transactionId: tx.id,
      receiptId: tx.agencyCommissionReceiptId,
      producer: tx.producer,
      amount,
      notes: recoveryNotes,
    })
    setSaving(false)

    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }

    setRecoveryOpen(false)
    setRecoveryTxnId('')
    setRecoveryAmount('')
    setRecoveryNotes('')
    setActionSuccess('Recovery / chargeback recorded as Open.')
    await loadAll()
  }

  async function handleVoidRecoveryConfirm() {
    if (!voidRecoveryId) return
    if (!canPay) {
      setActionError('You do not have permission to void recoveries.')
      return
    }
    setSaving(true)
    setActionError(null)
    const result = await voidProducerRecovery(voidRecoveryId)
    setSaving(false)
    if (result.error) {
      setActionError(
        `RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`,
      )
      return
    }
    setVoidRecoveryId(null)
    setVoidRecoveryLabel('')
    setActionSuccess('Recovery voided. The original transaction was not changed.')
    await loadAll()
  }

  const tabs: { id: FinancialsTab; label: string; count: number }[] = [
    { id: 'receipts', label: 'Agency Commission Receipts', count: receipts.length },
    { id: 'payments', label: 'Producer Payments', count: batches.length },
    { id: 'recoveries', label: 'Recoveries / Chargebacks', count: recoveries.length },
  ]

  const activeError =
    tab === 'receipts' ? receiptsError : tab === 'payments' ? batchesError : recoveriesError

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Expected Agency Commission"
          value={formatCurrency(kpis.expectedAgency)}
          hint="Sum of transaction.expected_amount"
          icon={FileText}
          tone="blue"
          onClick={() => setTab('receipts')}
        />
        <KpiCard
          label="Agency Commission Received"
          value={formatCurrency(kpis.receivedAgency)}
          hint="Sum of confirmed transaction.amount_received"
          icon={CircleDollarSign}
          tone="teal"
          onClick={() => setTab('receipts')}
        />
        <KpiCard
          label="Producer Commission Payable"
          value={formatCurrency(kpis.producerPayable)}
          hint={`Gross ${formatCurrency(kpis.producerPayableGross)} − next-payout recoveries ${formatCurrency(kpis.producerPayableOpenRecoveries)} (never below $0)`}
          icon={Wallet}
          tone="amber"
          onClick={() => {
            setSearchParams(
              (prev) => {
                const params = new URLSearchParams(prev)
                params.set('tab', 'payments')
                params.delete('status')
                params.delete('client')
                params.delete('policy')
                return params
              },
              { replace: true },
            )
          }}
        />
        <KpiCard
          label="Producer Commission Paid"
          value={formatCurrency(kpis.producerPaid)}
          hint="producer_payment_status = paid"
          icon={Wallet}
          tone="violet"
          onClick={() => {
            setSearchParams(
              (prev) => {
                const params = new URLSearchParams(prev)
                params.set('tab', 'payments')
                params.set('status', 'paid')
                params.delete('client')
                params.delete('policy')
                return params
              },
              { replace: true },
            )
          }}
        />
        <KpiCard
          label="Agency Net Commission"
          value={formatCurrency(kpis.agencyNet)}
          hint="Sum of transaction.agency_net_commission"
          icon={CircleDollarSign}
          tone="blue"
        />
        <KpiCard
          label="Open Producer Recoveries"
          value={formatCurrency(kpis.recoveriesOpen)}
          hint={
            kpis.directRecoveriesOpen > 0
              ? `Next-payout carry-forward only. Direct payment outstanding: ${formatCurrency(kpis.directRecoveriesOpen)} (does not reduce payouts)`
              : 'Next-payout carry-forward only (excludes Direct Payment)'
          }
          icon={RotateCcw}
          tone="orange"
          onClick={() => setTab('recoveries')}
        />
      </div>

      {transactionsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load transactions for KPIs/payables: {transactionsError}
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
      )}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{actionSuccess}</div>
      )}
      {nextPlannedPayout && (
        <div className="rounded-xl border border-alza-blue-100 bg-alza-blue-50 px-4 py-3 text-sm text-alza-blue-900">
          <span className="font-medium">Next Planned Payout:</span> {formatDate(nextPlannedPayout)}
          {agency?.producerPayoutSchedule ? (
            <span className="text-alza-blue-800">
              {' '}
              ({formatPayoutScheduleLabel(agency.producerPayoutSchedule)} schedule — planning only)
            </span>
          ) : null}
        </div>
      )}
      {!canPay && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Financials is limited for your role: you can view all tabs and confirm agency commission receipts.
          Creating payment batches, confirming paid outside ALZA Flow, and recording/voiding recoveries require Owner or
          Admin.
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {tabs.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border border-b-white border-slate-200 bg-white text-alza-blue-700'
                  : 'border border-transparent text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {item.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-alza-blue-50 text-alza-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                {item.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1 lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setParam('q', e.currentTarget.value, '')}
              placeholder={
                tab === 'receipts'
                  ? 'Search receipts by client, policy, or transaction...'
                  : tab === 'payments'
                    ? 'Search batches by number, producer, or reference...'
                    : 'Search recoveries by producer, transaction, or notes...'
              }
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
            />
          </div>
          <ExportMenu
            rowCount={
              tab === 'receipts'
                ? filteredReceipts.length
                : tab === 'payments'
                  ? filteredBatches.length
                  : filteredRecoveries.length
            }
            disabled={loading}
            onExport={(format) => {
              if (tab === 'receipts') {
                return downloadTableExport({
                  format,
                  sheetName: 'Receipts',
                  columns: receiptExportColumns,
                  rows: filteredReceipts.map((row) => ({
                    ...row,
                    amountReceived: transactionsById.get(row.transactionId)?.amountReceived ?? null,
                  })),
                  filenameBase: 'Financials_Receipts',
                  label: 'receipts',
                })
              }
              if (tab === 'payments') {
                return downloadTableExport({
                  format,
                  sheetName: 'Producer Payments',
                  columns: producerPaymentExportColumns,
                  rows: filteredBatches,
                  filenameBase: 'Financials_Producer_Payments',
                  label: 'payments',
                })
              }
              return downloadTableExport({
                format,
                sheetName: 'Recoveries',
                columns: recoveryExportColumns,
                rows: filteredRecoveries,
                filenameBase: 'Financials_Recoveries',
                label: 'recoveries',
              })
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="financials-year-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              Year
            </label>
            <select
              id="financials-year-filter"
              value={yearFilter}
              onChange={(e) => setParam('year', e.target.value)}
              className={selectClassName}
            >
              <option value={ALL}>All years</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="financials-date-from" className="mb-1.5 block text-xs font-medium text-slate-500">
              Date from
            </label>
            <input
              id="financials-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setParam('dateFrom', e.target.value, '')}
              className={selectClassName}
            />
          </div>
          <div>
            <label htmlFor="financials-date-to" className="mb-1.5 block text-xs font-medium text-slate-500">
              Date to
            </label>
            <input
              id="financials-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setParam('dateTo', e.target.value, '')}
              className={selectClassName}
            />
          </div>
          <div>
            <label htmlFor="financials-producer-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              Producer
            </label>
            <select
              id="financials-producer-filter"
              value={producerFilter}
              onChange={(e) => setParam('producer', e.target.value)}
              className={selectClassName}
            >
              <option value={ALL}>All producers</option>
              {producerOptions.map((producer) => (
                <option key={producer} value={producer}>
                  {producer}
                </option>
              ))}
            </select>
          </div>
          {tab === 'receipts' && (
            <>
              <div>
                <label htmlFor="financials-client-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
                  Client
                </label>
                <select
                  id="financials-client-filter"
                  value={clientFilter}
                  onChange={(e) => setParam('client', e.target.value)}
                  className={selectClassName}
                >
                  <option value={ALL}>All clients</option>
                  {receiptClientOptions.map((client) => (
                    <option key={client} value={client}>
                      {client}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="financials-policy-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
                  Policy
                </label>
                <select
                  id="financials-policy-filter"
                  value={policyFilter}
                  onChange={(e) => setParam('policy', e.target.value)}
                  className={selectClassName}
                >
                  <option value={ALL}>All policies</option>
                  {receiptPolicyOptions.map((policy) => (
                    <option key={policy} value={policy}>
                      {policy}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label htmlFor="financials-status-filter" className="mb-1.5 block text-xs font-medium text-slate-500">
              {tab === 'receipts'
                ? 'Reconciliation status'
                : tab === 'payments'
                  ? 'Batch status'
                  : 'Recovery status'}
            </label>
            <select
              id="financials-status-filter"
              value={statusFilter}
              onChange={(e) => setParam('status', e.target.value)}
              className={selectClassName}
            >
              <option value={ALL}>All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {tab === 'payments'
                    ? status === 'paid'
                      ? 'Paid'
                      : formatBatchStatusLabel(status)
                    : tab === 'recoveries'
                      ? formatRecoveryStatusLabel(status)
                      : formatLabel(status)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {activeError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load{' '}
          {tab === 'receipts'
            ? 'agency_commission_receipts'
            : tab === 'payments'
              ? 'producer_payment_batches'
              : 'producer_commission_recoveries'}
          : {activeError}
        </div>
      )}

      {tab === 'payments' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Ready for Payment</h3>
              <p className="text-sm text-slate-500">
                Producer commissions that are ready to be included in a payment batch.
              </p>
            </div>
            {canPay && (
            <button
              type="button"
              disabled={selectedReady.length === 0}
              onClick={() => {
                setActionError(null)
                setCreateBatchOpen(true)
              }}
              className="inline-flex items-center justify-center rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create Payment Batch
            </button>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading ready payables...</p>
          ) : readyByProducer.length === 0 ? (
            <p className="text-sm text-slate-500">No producer commissions are currently ready for payment.</p>
          ) : (
            <div className="space-y-5">
              {readyByProducer.map(([producer, group]) => (
                <div key={producer} className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex flex-col gap-2 bg-slate-50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {canLinkProducers && producer && producer !== '—' ? (
                          <Link
                            to={`/admin/producers?search=${encodeURIComponent(producer)}`}
                            state={navState}
                            className={financialsRecordLinkClassName}
                          >
                            {producer}
                          </Link>
                        ) : (
                          producer
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {group.items.length} transaction{group.items.length === 1 ? '' : 's'} ready
                      </p>
                      <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3 sm:gap-4">
                        <p>
                          <span className="text-slate-500">Gross Commission</span>{' '}
                          <span className="font-semibold tabular-nums text-slate-900">
                            {formatCurrency(group.gross)}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-500">Open Recoveries (next payout)</span>{' '}
                          <span
                            className={`font-semibold tabular-nums ${group.openRecoveries > 0 ? 'text-orange-700' : 'text-slate-900'}`}
                          >
                            {formatCurrency(group.openRecoveries)}
                          </span>
                        </p>
                        <p>
                          <span className="text-slate-500">Net Proposed</span>{' '}
                          <span className="font-semibold tabular-nums text-slate-900">
                            {formatCurrency(group.netProposed)}
                          </span>
                        </p>
                      </div>
                      {group.openDirectRecoveries > 0 && (
                        <p className="mt-1.5 text-xs text-slate-600">
                          Direct payment outstanding:{' '}
                          <span className="font-semibold tabular-nums text-slate-800">
                            {formatCurrency(group.openDirectRecoveries)}
                          </span>{' '}
                          (not deducted from this payout)
                        </p>
                      )}
                    </div>
                    {canPay ? (
                      <button
                        type="button"
                        onClick={() => selectProducerGroup(producer)}
                        className="text-xs font-medium text-alza-blue-700 hover:text-alza-blue-800"
                      >
                        Toggle select
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Read only</span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-2"></th>
                          <th className="px-4 py-2">Transaction</th>
                          <th className="px-4 py-2">Client</th>
                          <th className="px-4 py-2">Policy</th>
                          <th className="px-4 py-2 text-right">Agency Comm.</th>
                          <th className="px-4 py-2 text-right">Split</th>
                          <th className="px-4 py-2 text-right">Producer Comm.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.items.map(({ tx }) => (
                          <tr key={tx.id} className="text-sm">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                disabled={!canPay}
                                checked={selectedReadyIds.includes(tx.id)}
                                onChange={() => toggleReadyId(tx.id)}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <RecordLink to={`/transactions/${tx.id}`} state={navState}>
                                {tx.transactionNumber}
                              </RecordLink>
                            </td>
                            <td className="px-4 py-3">
                              <RecordLink to={tx.clientId ? `/clients/${tx.clientId}` : undefined} state={navState}>
                                {tx.clientName}
                              </RecordLink>
                            </td>
                            <td className="px-4 py-3">
                              <RecordLink to={tx.policyId ? `/policies/${tx.policyId}` : undefined} state={navState}>
                                {tx.policyNumber}
                              </RecordLink>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {formatCurrency(tx.agencyCommissionAmount)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {formatPercent(tx.producerSplitPercentage)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {formatCurrency(tx.producerCommissionAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'recoveries' && canPay && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              setRecoveryOpen(true)
            }}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Record Recovery / Chargeback
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          {tab === 'receipts' && (
            <>
              {canConfirm && pendingReceiptConfirmations.length > 0 && (
                <div className="border-b border-slate-200 bg-amber-50/40 px-4 py-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-900">Pending receipt confirmation</h3>
                    <p className="text-xs text-slate-600">
                      Confirm agency commission received to create a receipt ledger entry. Historical commission
                      amounts are not recalculated.
                    </p>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-amber-100 bg-white">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-2">Transaction</th>
                          <th className="px-4 py-2">Client</th>
                          <th className="px-4 py-2">Policy</th>
                          <th className="px-4 py-2 text-right">Expected</th>
                          <th className="px-4 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pendingReceiptConfirmations.map((tx) => (
                          <tr key={tx.id} className="text-sm">
                            <td className="px-4 py-3">
                              <RecordLink to={`/transactions/${tx.id}`} state={navState}>
                                {tx.transactionNumber}
                              </RecordLink>
                              <p className="text-xs text-slate-500">{formatDate(tx.transactionDate)}</p>
                            </td>
                            <td className="px-4 py-3">
                              <RecordLink to={tx.clientId ? `/clients/${tx.clientId}` : undefined} state={navState}>
                                {tx.clientName}
                              </RecordLink>
                            </td>
                            <td className="px-4 py-3">
                              <RecordLink to={tx.policyId ? `/policies/${tx.policyId}` : undefined} state={navState}>
                                {tx.policyNumber}
                              </RecordLink>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-medium">
                              {formatCurrency(tx.expectedAmount)}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => openConfirmReceipt(tx)}
                                className="rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-2.5 py-1.5 text-xs font-medium text-alza-blue-800 hover:bg-alza-blue-100"
                              >
                                Confirm Receipt
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <SortableTh
                    className="px-6"
                    active={receiptSort.key === 'settlement'}
                    direction={receiptSort.direction}
                    onSort={() => setReceiptSort((s) => nextTableSort(s, 'settlement'))}
                  >
                    Settlement / Imported
                  </SortableTh>
                  <SortableTh
                    className="px-6"
                    active={receiptSort.key === 'client'}
                    direction={receiptSort.direction}
                    onSort={() => setReceiptSort((s) => nextTableSort(s, 'client'))}
                  >
                    Client
                  </SortableTh>
                  <SortableTh
                    className="px-6"
                    active={receiptSort.key === 'policy'}
                    direction={receiptSort.direction}
                    onSort={() => setReceiptSort((s) => nextTableSort(s, 'policy'))}
                  >
                    Policy
                  </SortableTh>
                  <SortableTh
                    className="px-6"
                    active={receiptSort.key === 'transaction'}
                    direction={receiptSort.direction}
                    onSort={() => setReceiptSort((s) => nextTableSort(s, 'transaction'))}
                  >
                    Transaction
                  </SortableTh>
                  <SortableTh
                    className="px-6"
                    active={receiptSort.key === 'status'}
                    direction={receiptSort.direction}
                    onSort={() => setReceiptSort((s) => nextTableSort(s, 'status'))}
                  >
                    Status
                  </SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <EmptyOrLoading colSpan={5} loading label="Loading agency commission receipts..." />
                ) : sortedReceipts.length === 0 ? (
                  <EmptyOrLoading colSpan={5} title="No agency commission receipts recorded yet." subtitle="Confirm commission received from a transaction to create the first receipt." />
                ) : (
                  sortedReceipts.map((row) => (
                    <tr key={row.id} className="hover:bg-alza-blue-50/60">
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">{formatDate(row.settlementDate)}</p>
                        <p className="text-xs text-slate-500">Imported {formatDate(row.importedAt)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <RecordLink to={row.clientId ? `/clients/${row.clientId}` : undefined} state={navState}>
                          {row.clientName}
                        </RecordLink>
                        <p className="text-xs text-slate-500">
                          {canLinkProducers && row.producer !== '—' ? (
                            <Link
                              to={`/admin/producers?search=${encodeURIComponent(row.producer)}`}
                              state={navState}
                              className={financialsRecordLinkClassName}
                            >
                              {row.producer}
                            </Link>
                          ) : (
                            row.producer
                          )}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        <RecordLink to={row.policyId ? `/policies/${row.policyId}` : undefined} state={navState}>
                          {row.policyNumber}
                        </RecordLink>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        <RecordLink
                          to={row.transactionId ? `/transactions/${row.transactionId}` : undefined}
                          state={navState}
                        >
                          {row.transactionNumber}
                        </RecordLink>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(row.reconciliationStatus)}`}>
                          {formatLabel(row.reconciliationStatus)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </>
          )}

          {tab === 'payments' && (
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  {(
                    [
                      ['batchNumber', 'Batch', 'left'],
                      ['producer', 'Producer', 'left'],
                      ['paymentDate', 'Payment Date', 'left'],
                      ['grossCommission', 'Gross', 'right'],
                      ['netPayment', 'Net', 'right'],
                      ['status', 'Status', 'left'],
                      ['paymentMethod', 'Payment Details', 'left'],
                    ] as const
                  ).map(([key, label, align]) => (
                    <SortableTh
                      key={key}
                      className="px-6"
                      align={align}
                      active={isProducerPaymentHeaderActive(paymentSort, key)}
                      direction={producerPaymentHeaderDirection(paymentSort, key)}
                      onSort={() => handlePaymentSort(key)}
                    >
                      {label}
                    </SortableTh>
                  ))}
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <EmptyOrLoading colSpan={8} loading label="Loading producer payment batches..." />
                ) : filteredBatches.length === 0 ? (
                  <EmptyOrLoading colSpan={8} title="No producer payment batches recorded yet." subtitle="Create a batch from Ready for Payment when commissions are ready." />
                ) : (
                  filteredBatches.map((row) => (
                    <tr key={row.id} className="hover:bg-alza-blue-50/60">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-slate-900">{row.batchNumber}</p>
                        <p className="text-xs text-slate-500">{row.itemCount} item{row.itemCount === 1 ? '' : 's'}</p>
                        {row.transactionIds.length > 0 && (
                          <div className="mt-1 flex flex-col gap-0.5">
                            {row.transactionIds.map((txnId) => {
                              const tx = transactionsById.get(txnId)
                              const label = tx?.transactionNumber || txnId.slice(0, 8)
                              return (
                                <RecordLink key={txnId} to={`/transactions/${txnId}`} state={navState}>
                                  <span className="text-xs">{label}</span>
                                </RecordLink>
                              )
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900">
                        {canLinkProducers && row.producer !== '—' ? (
                          <Link
                            to={`/admin/producers?search=${encodeURIComponent(row.producer)}`}
                            state={navState}
                            className={financialsRecordLinkClassName}
                          >
                            {row.producer}
                          </Link>
                        ) : (
                          row.producer
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(row.paymentDate)}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold tabular-nums">{formatCurrency(row.grossCommission)}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold tabular-nums">{formatCurrency(row.netPayment)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(row.status)}`}>
                          {formatBatchStatusLabel(row.status, row.paymentChannel)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700">
                        {row.status === 'paid' ? (
                          <div className="space-y-0.5">
                            <p className="font-medium text-slate-900">
                              {formatProducerPaymentMethodLabel(row.paymentMethod)}
                            </p>
                            <p className="text-xs text-slate-500">
                              Ref: {row.paymentReference !== '—' ? row.paymentReference : '—'}
                            </p>
                            <button
                              type="button"
                              onClick={() => setViewBatch(row)}
                              className="text-xs font-medium text-alza-blue-700 hover:text-alza-blue-800"
                            >
                              View details
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="relative z-10 whitespace-nowrap px-6 py-4">
                        {canPay && canConfirmProducerPaid(row) ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setActionError(null)
                              setPaymentDate(todayIsoDate())
                              setPaymentMethod('')
                              setPaymentReference('')
                              setPaymentNotes(row.notes !== '—' ? row.notes : '')
                              setPayBatch(row)
                            }}
                            className="relative z-10 inline-flex cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-alza-blue-700 hover:bg-alza-blue-50 hover:text-alza-blue-800"
                          >
                            Confirm Paid Outside ALZA Flow
                          </button>
                        ) : row.status === 'paid' ? (
                          <button
                            type="button"
                            onClick={() => setViewBatch(row)}
                            className="text-sm font-medium text-slate-600 hover:text-alza-blue-700"
                          >
                            View
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'recoveries' && (
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  {(
                    [
                      ['recoveryNumber', 'Recovery #', 'left'],
                      ['createdAt', 'Created', 'left'],
                      ['producer', 'Producer', 'left'],
                      ['amount', 'Original', 'right'],
                      ['applied', 'Applied', 'right'],
                      ['remaining', 'Remaining', 'right'],
                      ['status', 'Status', 'left'],
                      ['settlement', 'Settlement', 'left'],
                      ['transaction', 'Transaction', 'left'],
                    ] as const
                  ).map(([key, label, align]) => (
                    <SortableTh
                      key={key}
                      className="px-6"
                      align={align}
                      active={recoverySort.key === key}
                      direction={recoverySort.direction}
                      onSort={() => setRecoverySort((s) => nextTableSort(s, key))}
                    >
                      {label}
                    </SortableTh>
                  ))}
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Receipt
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Notes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <EmptyOrLoading colSpan={12} loading label="Loading commission recoveries..." />
                ) : sortedRecoveries.length === 0 ? (
                  <EmptyOrLoading colSpan={12} title="No commission recoveries recorded yet." subtitle="Record recoveries explicitly from Financials or a transaction detail panel." />
                ) : (
                  sortedRecoveries.map((row) => (
                    <tr key={row.id} className="hover:bg-alza-blue-50/60">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-900">
                        {row.recoveryNumber || '—'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">{formatDate(row.createdAt)}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900">
                        {canLinkProducers && row.producer !== '—' ? (
                          <Link
                            to={`/admin/producers?search=${encodeURIComponent(row.producer)}`}
                            state={navState}
                            className={financialsRecordLinkClassName}
                          >
                            {row.producer}
                          </Link>
                        ) : (
                          row.producer
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm tabular-nums text-slate-700">
                        {formatCurrency(row.appliedAmount)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm tabular-nums text-slate-700">
                        {formatCurrency(row.remainingAmount)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(row.status)}`}>
                          {formatRecoveryStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                        {formatRecoverySettlementLabel(row.settlementMethod)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        <RecordLink
                          to={row.transactionId ? `/transactions/${row.transactionId}` : undefined}
                          state={navState}
                        >
                          {row.transactionNumber}
                        </RecordLink>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700">
                        {row.receiptId ? (
                          <RecordLink to={row.clientId ? `/clients/${row.clientId}` : undefined} state={navState}>
                            {row.receiptLabel}
                          </RecordLink>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{row.notes}</td>
                      <td className="px-6 py-4">
                        {canPay && row.status === 'open' && row.appliedAmount === 0 ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setVoidRecoveryId(row.id)
                              setVoidRecoveryLabel(
                                row.recoveryNumber?.trim() ||
                                  formatCurrency(row.amount) ||
                                  'this recovery',
                              )
                            }}
                            className="text-sm font-medium text-slate-600 hover:text-red-700"
                          >
                            Void Recovery
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-500">
        <ArrowLeftRight className="h-4 w-4" />
        Operational financials workspace — accounting confirmation only; no bank transfers.
      </div>

      {confirmTxn && (
        <Modal title="Confirm Commission Received" onClose={() => !saving && setConfirmTxn(null)}>
          <form onSubmit={handleConfirmReceipt} className="space-y-4">
            <p className="text-sm text-slate-600">
              Creates an agency commission receipt and updates this transaction’s receipt fields. Stored commission
              amounts are not recalculated.
            </p>
            <div className="grid gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-slate-500">Transaction:</span>{' '}
                <span className="font-medium text-slate-900">{confirmTxn.transactionNumber}</span>
              </p>
              <p>
                <span className="text-slate-500">Client:</span>{' '}
                <span className="font-medium text-slate-900">{confirmTxn.clientName}</span>
              </p>
              <p>
                <span className="text-slate-500">Policy:</span>{' '}
                <span className="font-medium text-slate-900">{confirmTxn.policyNumber}</span>
              </p>
              <p>
                <span className="text-slate-500">Expected:</span>{' '}
                <span className="font-medium text-slate-900">{formatCurrency(confirmTxn.expectedAmount)}</span>
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Amount received</span>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={receivedAmount}
                  onChange={(e) => {
                    setReceivedAmount(e.target.value)
                    setVarianceAck(false)
                  }}
                  className={inputClassName}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Received date</span>
                <input
                  required
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  className={inputClassName}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Source</span>
                <input
                  value={receiptSource}
                  onChange={(e) => setReceiptSource(e.target.value)}
                  placeholder="Carrier statement, MGA, wire…"
                  className={inputClassName}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Deposit / reference</span>
                <input
                  value={depositReference}
                  onChange={(e) => setDepositReference(e.target.value)}
                  className={inputClassName}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  External invoice / payment reference
                </span>
                <input
                  value={externalInvoiceId}
                  onChange={(e) => setExternalInvoiceId(e.target.value)}
                  className={inputClassName}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
              <textarea
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                rows={3}
                className={textareaClassName}
              />
            </label>
            {confirmHasVariance && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <p className="font-medium">Variance detected</p>
                <p className="mt-1">
                  Received {formatCurrency(Number(receivedAmount) || 0)} vs expected{' '}
                  {formatCurrency(confirmTxn.expectedAmount)} ({formatCurrency(confirmVariance)}).
                </p>
                <label className="mt-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={varianceAck}
                    onChange={(e) => setVarianceAck(e.target.checked)}
                    className="mt-1"
                  />
                  <span>I reviewed this variance and want to confirm receipt anyway.</span>
                </label>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmTxn(null)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || (confirmHasVariance && !varianceAck)}
                className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Confirming…' : 'Confirm Receipt'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {createBatchOpen && (
        <Modal title="Create Payment Batch" onClose={() => !saving && setCreateBatchOpen(false)}>
          <form onSubmit={handleCreateBatch} className="space-y-4">
            <p className="text-sm text-slate-600">
              Creates the batch atomically with open <span className="font-medium">Next payout</span> recoveries
              applied oldest-first. Direct Payment recoveries are excluded. Recoveries are consumed at create —
              Confirm Paid will not deduct again.
            </p>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p><span className="text-slate-500">Producer:</span> <span className="font-medium text-slate-900">{selectedBatchPreview.producer || selectedProducers.join(', ') || '—'}</span></p>
              <p className="mt-1"><span className="text-slate-500">Transactions:</span> <span className="font-medium text-slate-900">{selectedReady.length}</span></p>
              <p className="mt-1"><span className="text-slate-500">Gross:</span> <span className="font-medium text-slate-900">{formatCurrency(selectedBatchPreview.gross)}</span></p>
              <p className="mt-1"><span className="text-slate-500">Next-payout recovery applied:</span> <span className="font-medium text-orange-700">{formatCurrency(selectedBatchPreview.recoveryApplied)}</span></p>
              <p className="mt-1"><span className="text-slate-500">Net payment:</span> <span className="font-medium text-slate-900">{formatCurrency(selectedBatchPreview.net)}</span></p>
              {selectedBatchPreview.openDirectRecoveries > 0 && (
                <p className="mt-1 text-xs text-slate-600">
                  Direct payment outstanding {formatCurrency(selectedBatchPreview.openDirectRecoveries)} remains open and is not deducted here.
                </p>
              )}
              {selectedBatchPreview.net === 0 && selectedBatchPreview.gross > 0 && (
                <p className="mt-2 text-xs text-slate-600">Net is $0 because recoveries fully offset this payout. A zero-net draft batch is allowed; do not fake a $0.01 payment.</p>
              )}
            </div>
            {selectedProducers.length > 1 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Select transactions for only one producer per batch.
              </div>
            )}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
              <textarea value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} rows={3} className={textareaClassName} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setCreateBatchOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving || selectedReady.length === 0 || selectedProducers.length !== 1} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Creating…' : 'Confirm Create Batch'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {payBatch && (
        <Modal title="Confirm Paid Outside ALZA Flow" onClose={() => !saving && setPayBatch(null)}>
          <form onSubmit={handleConfirmPaid} className="space-y-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Confirm only after the producer has actually been paid. ALZA Flow does not process this payment.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm space-y-1.5">
              <p>
                <span className="text-slate-500">Payment Batch #:</span>{' '}
                <span className="font-medium text-slate-900">{payBatch.batchNumber}</span>
              </p>
              <p>
                <span className="text-slate-500">Producer:</span>{' '}
                <span className="font-medium text-slate-900">{payBatch.producer}</span>
              </p>
              <p>
                <span className="text-slate-500">Gross Producer Commission:</span>{' '}
                <span className="font-medium text-slate-900">{formatCurrency(payBatch.grossCommission)}</span>
              </p>
              <p>
                <span className="text-slate-500">Recovery / Chargeback Applied:</span>{' '}
                <span className="font-medium text-orange-700">
                  {formatCurrency(Math.max(payBatch.grossCommission - payBatch.netPayment, 0))}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Net Amount Paid:</span>{' '}
                <span className="font-medium text-slate-900">{formatCurrency(payBatch.netPayment)}</span>
              </p>
              {payBatch.netPayment === 0 && (
                <p className="pt-1 text-xs text-slate-600">
                  Net is $0 (fully offset at batch create). Confirming paid records completion only — recoveries are not deducted again.
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Payment Date *</span>
                <input
                  required
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className={inputClassName}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Payment Method *</span>
                <select
                  required
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">Select payment method…</option>
                  {PRODUCER_PAYMENT_CONFIRM_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  Payment Reference / Confirmation #
                </span>
                <input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className={inputClassName}
                  placeholder="Optional"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  rows={3}
                  className={textareaClassName}
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setPayBatch(null)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !confirmPaidReady}
                className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Confirming…' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {viewBatch && (
        <Modal title="Payment Batch Details" onClose={() => setViewBatch(null)}>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm space-y-1.5">
              <p>
                <span className="text-slate-500">Payment Batch #:</span>{' '}
                <span className="font-medium text-slate-900">{viewBatch.batchNumber}</span>
              </p>
              <p>
                <span className="text-slate-500">Producer:</span>{' '}
                <span className="font-medium text-slate-900">{viewBatch.producer}</span>
              </p>
              <p>
                <span className="text-slate-500">Status:</span>{' '}
                <span className="font-medium text-slate-900">
                  {formatBatchStatusLabel(viewBatch.status, viewBatch.paymentChannel)}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Gross Producer Commission:</span>{' '}
                <span className="font-medium text-slate-900">{formatCurrency(viewBatch.grossCommission)}</span>
              </p>
              <p>
                <span className="text-slate-500">Recovery / Chargeback Applied:</span>{' '}
                <span className="font-medium text-orange-700">
                  {formatCurrency(Math.max(viewBatch.grossCommission - viewBatch.netPayment, 0))}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Net Amount Paid:</span>{' '}
                <span className="font-medium text-slate-900">{formatCurrency(viewBatch.netPayment)}</span>
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm space-y-1.5">
              <p>
                <span className="text-slate-500">Payment Date:</span>{' '}
                <span className="font-medium text-slate-900">{formatDate(viewBatch.paymentDate)}</span>
              </p>
              <p>
                <span className="text-slate-500">Payment Method:</span>{' '}
                <span className="font-medium text-slate-900">
                  {formatProducerPaymentMethodLabel(viewBatch.paymentMethod)}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Payment Reference / Confirmation #:</span>{' '}
                <span className="font-medium text-slate-900">
                  {viewBatch.paymentReference !== '—' ? viewBatch.paymentReference : '—'}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Payment Channel:</span>{' '}
                <span className="font-medium text-slate-900">
                  {formatPaymentChannelLabel(viewBatch.paymentChannel, viewBatch.status)}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Confirmed:</span>{' '}
                <span className="font-medium text-slate-900">
                  {viewBatch.confirmedAt
                    ? formatDate(viewBatch.confirmedAt)
                    : viewBatch.status === 'paid'
                      ? 'Historical payment'
                      : '—'}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Notes:</span>{' '}
                <span className="font-medium text-slate-900">
                  {viewBatch.notes !== '—' ? viewBatch.notes : '—'}
                </span>
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setViewBatch(null)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {recoveryOpen && (
        <Modal title="Record Recovery / Chargeback" onClose={() => !saving && setRecoveryOpen(false)}>
          <form onSubmit={handleCreateRecovery} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Transaction</span>
              <select required value={recoveryTxnId} onChange={(e) => setRecoveryTxnId(e.target.value)} className={selectClassName}>
                <option value="">Select transaction…</option>
                {transactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {tx.transactionNumber} · {tx.clientName} · {tx.producer}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Amount (positive amount owed back)</span>
              <input required type="number" step="0.01" min="0.01" value={recoveryAmount} onChange={(e) => setRecoveryAmount(e.target.value)} className={inputClassName} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Reason / notes</span>
              <textarea required value={recoveryNotes} onChange={(e) => setRecoveryNotes(e.target.value)} rows={3} className={textareaClassName} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setRecoveryOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Recovery'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {voidRecoveryId && (
        <Modal
          title="Void Recovery"
          onClose={() => {
            if (saving) return
            setVoidRecoveryId(null)
            setVoidRecoveryLabel('')
          }}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Void recovery <span className="font-medium text-slate-900">{voidRecoveryLabel}</span>?
            </p>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              This voids only the recovery / chargeback record. The original transaction will not be
              changed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setVoidRecoveryId(null)
                  setVoidRecoveryLabel('')
                }}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleVoidRecoveryConfirm()}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Voiding…' : 'Void Recovery'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function RecordLink({
  to,
  state,
  children,
}: {
  to?: string
  state?: { financialsReturnTo?: string }
  children: ReactNode
}) {
  if (!to) {
    return <span className="text-sm text-slate-700">{children}</span>
  }
  return (
    <Link to={to} state={state} className={`text-sm ${financialsRecordLinkClassName}`}>
      {children}
    </Link>
  )
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  negative,
  onClick,
}: {
  label: string
  value: string
  hint: string
  icon: typeof Wallet
  tone: 'blue' | 'teal' | 'orange' | 'amber' | 'violet'
  negative?: boolean
  onClick?: () => void
}) {
  const tones = {
    blue: 'bg-alza-blue-50 text-alza-blue-600',
    teal: 'bg-alza-teal-50 text-alza-teal-600',
    orange: 'bg-orange-50 text-orange-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  }
  const body = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className={`mt-2 text-2xl font-bold ${negative ? 'text-orange-700' : 'text-slate-900'}`}>{value}</p>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-alza-blue-200 hover:bg-alza-blue-50/40"
      >
        {body}
      </button>
    )
  }
  return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{body}</div>
}

function EmptyOrLoading({
  colSpan,
  loading,
  label,
  title,
  subtitle,
}: {
  colSpan: number
  loading?: boolean
  label?: string
  title?: string
  subtitle?: string
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-12 text-center">
        {loading ? (
          <p className="text-sm text-slate-600">{label}</p>
        ) : (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
              <Search className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-900">{title}</p>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
        )}
      </td>
    </tr>
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
