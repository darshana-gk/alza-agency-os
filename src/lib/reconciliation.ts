import { recordActivity } from './activity'
import { fetchAgencyProfile } from './agency'
import { formatCurrency } from './commission'
import {
  canAccessReconciliation,
  canConfigureReconciliation,
  canConfirmReconciliationReceipts,
  loadCurrentAppRole,
  rejectUnlessRole,
} from './permissions'
import { parseStatementFile } from './reconciliationIntake'
import { supabase } from './supabase'
import {
  classifySignedVariance,
  mapStatementTransactionType,
  parseMoney,
  roundMoney,
} from './reconciliationMatching'

export {
  classifySignedVariance,
  expectedCommissionOf,
  mapStatementTransactionType,
  normalizePartyName,
  normalizePolicyNumber,
  parseMoney,
  partyNamesMatch,
  pickPolicyMatchWinner,
  resolveStatementPartyText,
  roundMoney,
  statementPartyMatchesTransaction,
} from './reconciliationMatching'

export const RECONCILIATION_STANDARD_FIELDS = [
  { key: 'policy_number', label: 'Policy number', required: true },
  { key: 'commission_amount', label: 'Commission amount (signed)', required: true },
  { key: 'client_name', label: 'Client name', required: false },
  { key: 'premium_amount', label: 'Premium amount', required: false },
  { key: 'transaction_date', label: 'Transaction date', required: false },
  { key: 'transaction_type', label: 'Transaction type', required: false },
  { key: 'carrier_name', label: 'Carrier name', required: false },
  { key: 'mga_name', label: 'MGA name', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'external_reference', label: 'External reference', required: false },
] as const

export type ReconciliationFieldKey = (typeof RECONCILIATION_STANDARD_FIELDS)[number]['key']
export type ColumnMapping = Partial<Record<ReconciliationFieldKey, string>>

export type StatementStatus =
  | 'pending'
  | 'mapping'
  | 'staged'
  | 'matching'
  | 'matched'
  | 'reviewed'
  | 'completed'
  | 'cancelled'

export type MatchStatus =
  | 'pending'
  | 'auto_matched'
  | 'manual_matched'
  | 'unmatched'
  | 'exception'
  | 'confirmed'
  | 'skipped'

export interface ReconciliationStatement {
  id: string
  agencyProfileId: string
  carrier: string | null
  mga: string | null
  carrierId: string | null
  mgaId: string | null
  statementDate: string | null
  periodStart: string
  periodEnd: string
  fileName: string
  fileHash: string
  fileStoragePath: string | null
  rowCount: number
  status: StatementStatus
  matchedCount: number
  unmatchedCount: number
  exceptionCount: number
  confirmedCount: number
  skippedCount: number
  missingCount: number
  roundingTolerance: number
  detectMissing: boolean
  notes: string | null
  uploadedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ReconciliationStatementRow {
  id: string
  statementId: string
  rowSource: 'import' | 'missing'
  rowIndex: number
  rawData: Record<string, unknown> | null
  policyNumber: string | null
  clientName: string | null
  commissionAmount: number | null
  premiumAmount: number | null
  transactionDate: string | null
  transactionType: string | null
  carrierName: string | null
  mgaName: string | null
  description: string | null
  externalReference: string | null
  matchStatus: MatchStatus
  matchConfidence: 'high' | 'medium' | 'low' | 'none' | null
  matchedTransactionId: string | null
  expectedCommission: number | null
  variance: number | null
  discrepancyType: string | null
  resolutionStatus: 'open' | 'acknowledged' | 'resolved' | 'ignored'
  resolutionNotes: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  receiptId: string | null
  createdAt: string
  updatedAt: string
  transactionNumber?: string | null
}

export interface ColumnMappingRecord {
  id: string
  name: string
  carrier: string | null
  mga: string | null
  carrierId: string | null
  mgaId: string | null
  mapping: ColumnMapping
}

export {
  detectStatementDelimiter,
  hashUtf8Sha256,
  normalizePastedStatementText,
  parseDelimitedStatementText,
  parseStatementFile,
  pastedStatementFileName,
  runStatementIntakeChecks,
  type ParsedStatementFile,
  type StatementDelimiter,
} from './reconciliationIntake'


export const DUPLICATE_FILE_MESSAGE = 'This exact file has already been imported'

const STATEMENT_SELECT = `
  id, agency_profile_id, carrier, mga, carrier_id, mga_id, statement_date,
  period_start, period_end, file_name, file_hash, file_storage_path, row_count,
  status, matched_count, unmatched_count, exception_count, confirmed_count,
  skipped_count, missing_count, rounding_tolerance, detect_missing, notes, uploaded_by,
  created_at, updated_at
`

const ROW_SELECT = `
  id, statement_id, row_source, row_index, raw_data, policy_number, client_name,
  commission_amount, premium_amount, transaction_date, transaction_type,
  carrier_name, mga_name, description, external_reference, match_status,
  match_confidence, matched_transaction_id, expected_commission, variance,
  discrepancy_type, resolution_status, resolution_notes, resolved_by, resolved_at,
  receipt_id, created_at, updated_at,
  transactions ( transaction_number )
`

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function mapStatement(row: Record<string, unknown>): ReconciliationStatement {
  return {
    id: String(row.id ?? ''),
    agencyProfileId: String(row.agency_profile_id ?? ''),
    carrier: (row.carrier as string | null) ?? null,
    mga: (row.mga as string | null) ?? null,
    carrierId: (row.carrier_id as string | null) ?? null,
    mgaId: (row.mga_id as string | null) ?? null,
    statementDate: (row.statement_date as string | null) ?? null,
    periodStart: String(row.period_start ?? ''),
    periodEnd: String(row.period_end ?? ''),
    fileName: String(row.file_name ?? ''),
    fileHash: String(row.file_hash ?? ''),
    fileStoragePath: (row.file_storage_path as string | null) ?? null,
    rowCount: num(row.row_count),
    status: (String(row.status ?? 'pending') as StatementStatus) || 'pending',
    matchedCount: num(row.matched_count),
    unmatchedCount: num(row.unmatched_count),
    exceptionCount: num(row.exception_count),
    confirmedCount: num(row.confirmed_count),
    skippedCount: num(row.skipped_count),
    missingCount: num(row.missing_count),
    roundingTolerance: num(row.rounding_tolerance) || 0.01,
    detectMissing: Boolean(row.detect_missing),
    notes: (row.notes as string | null) ?? null,
    uploadedBy: (row.uploaded_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapRow(row: Record<string, unknown>): ReconciliationStatementRow {
  const txn = firstEmbed(row.transactions as { transaction_number?: string } | { transaction_number?: string }[] | null)
  return {
    id: String(row.id ?? ''),
    statementId: String(row.statement_id ?? ''),
    rowSource: String(row.row_source ?? 'import') === 'missing' ? 'missing' : 'import',
    rowIndex: num(row.row_index),
    rawData: row.raw_data && typeof row.raw_data === 'object' ? asRecord(row.raw_data) : null,
    policyNumber: (row.policy_number as string | null) ?? null,
    clientName: (row.client_name as string | null) ?? null,
    commissionAmount: row.commission_amount == null ? null : num(row.commission_amount),
    premiumAmount: row.premium_amount == null ? null : num(row.premium_amount),
    transactionDate: (row.transaction_date as string | null) ?? null,
    transactionType: (row.transaction_type as string | null) ?? null,
    carrierName: (row.carrier_name as string | null) ?? null,
    mgaName: (row.mga_name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    externalReference: (row.external_reference as string | null) ?? null,
    matchStatus: (String(row.match_status ?? 'pending') as MatchStatus) || 'pending',
    matchConfidence: (row.match_confidence as ReconciliationStatementRow['matchConfidence']) ?? null,
    matchedTransactionId: (row.matched_transaction_id as string | null) ?? null,
    expectedCommission: row.expected_commission == null ? null : num(row.expected_commission),
    variance: row.variance == null ? null : num(row.variance),
    discrepancyType: (row.discrepancy_type as string | null) ?? null,
    resolutionStatus:
      (String(row.resolution_status ?? 'open') as ReconciliationStatementRow['resolutionStatus']) || 'open',
    resolutionNotes: (row.resolution_notes as string | null) ?? null,
    resolvedBy: (row.resolved_by as string | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    receiptId: (row.receipt_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    transactionNumber: txn?.transaction_number ?? null,
  }
}

export function formatReconciliationStatus(status: string | null | undefined): string {
  const v = String(status ?? '').trim().toLowerCase()
  if (!v) return '—'
  if (v === 'auto_matched' || v === 'manual_matched') return 'Matched'
  if (v === 'confirmed') return 'Confirmed'
  if (v === 'exception' || v === 'unmatched' || v === 'unmatched_row') return 'Needs Review'
  if (v === 'missing_from_statement' || v === 'missing') return 'Missing'
  if (v === 'underpaid') return 'Underpaid'
  if (v === 'overpaid') return 'Overpaid'
  if (v === 'skipped') return 'Skipped'
  if (v === 'exact_match') return 'Exact Match'
  if (v === 'zero_amount') return 'Zero Amount'
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isPreviouslyConfirmedSkip(notes: string | null | undefined): boolean {
  const n = String(notes ?? '').toLowerCase()
  return n.includes('receipt already confirmed') || n.includes('commission was already recorded at')
}

export function isCrossStatementOccupancyNote(notes: string | null | undefined): boolean {
  return String(notes ?? '').includes('Already matched on another statement')
}

export const GLOBAL_UNCONFIRMED_OCCUPANCY_STATUSES = ['auto_matched', 'manual_matched'] as const

export function isGlobalUnconfirmedOccupancyStatus(status: string | null | undefined): boolean {
  return GLOBAL_UNCONFIRMED_OCCUPANCY_STATUSES.includes(
    String(status ?? '').trim().toLowerCase() as (typeof GLOBAL_UNCONFIRMED_OCCUPANCY_STATUSES)[number],
  )
}

export function classifyStatementVsRecordedAmount(
  statementAmount: number | null | undefined,
  recordedAmount: number | null | undefined,
  tolerance: number,
): {
  discrepancyType: 'exact_match' | 'underpaid' | 'overpaid' | 'zero_amount' | null
  variance: number | null
} {
  if (statementAmount == null || recordedAmount == null) {
    return { discrepancyType: null, variance: null }
  }
  const actual = roundMoney(statementAmount)
  const recorded = roundMoney(recordedAmount)
  const variance = roundMoney(actual - recorded)
  if (actual === 0 && recorded !== 0) return { discrepancyType: 'zero_amount', variance }
  if (Math.abs(variance) <= tolerance) return { discrepancyType: 'exact_match', variance }
  if (variance < -tolerance) return { discrepancyType: 'underpaid', variance }
  return { discrepancyType: 'overpaid', variance }
}

export function buildAlreadyProcessedResolutionNotes(
  recordedAmount: number,
  statementAmount: number | null,
  tolerance: number,
): { notes: string; discrepancyType: string | null; variance: number | null } {
  const classified = classifyStatementVsRecordedAmount(statementAmount, recordedAmount, tolerance)
  const base = 'Receipt already confirmed for this transaction'
  if (
    statementAmount == null ||
    classified.discrepancyType === 'exact_match' ||
    classified.discrepancyType === null
  ) {
    return { notes: base, discrepancyType: null, variance: null }
  }
  return {
    notes: `${base}. Commission was already recorded at ${formatCurrency(recordedAmount)}. This statement reports ${formatCurrency(statementAmount)}.`,
    discrepancyType: classified.discrepancyType,
    variance: classified.variance,
  }
}

export function computeStatementPresentationSummary(
  rows: Array<{
    rowSource?: string | null
    matchStatus?: string | null
    resolutionNotes?: string | null
    discrepancyType?: string | null
  }>,
): {
  imported: number
  alreadyProcessed: number
  matched: number
  needsReview: number
  confirmed: number
  missing: number
  underpaid: number
  overpaid: number
} {
  const importedRows = rows.filter((r) => r.rowSource === 'import')
  let alreadyProcessed = 0
  let matched = 0
  let needsReview = 0
  let confirmed = 0
  let missing = 0
  let underpaid = 0
  let overpaid = 0

  for (const row of rows) {
    const discrepancy = String(row.discrepancyType ?? '').toLowerCase()
    if (discrepancy === 'underpaid') underpaid += 1
    if (discrepancy === 'overpaid') overpaid += 1

    if (row.rowSource === 'missing') {
      missing += 1
      continue
    }
    if (row.matchStatus === 'confirmed') {
      confirmed += 1
      continue
    }
    if (row.matchStatus === 'skipped' && isPreviouslyConfirmedSkip(row.resolutionNotes)) {
      alreadyProcessed += 1
      continue
    }
    if (row.matchStatus === 'auto_matched' || row.matchStatus === 'manual_matched') {
      matched += 1
      continue
    }
    if (
      row.matchStatus === 'exception' ||
      row.matchStatus === 'unmatched' ||
      isCrossStatementOccupancyNote(row.resolutionNotes)
    ) {
      needsReview += 1
    }
  }

  return {
    imported: importedRows.length,
    alreadyProcessed,
    matched,
    needsReview,
    confirmed,
    missing,
    underpaid,
    overpaid,
  }
}

/** Customer-facing source line for work queue / statement header. */
export function statementSourceLabel(statement: {
  carrier?: string | null
  mga?: string | null
}): string {
  const carrier = String(statement.carrier ?? '').trim()
  const mga = String(statement.mga ?? '').trim()
  if (carrier && mga) return `Carrier · ${carrier} · MGA · ${mga}`
  if (carrier) return `Carrier · ${carrier}`
  if (mga) return `MGA · ${mga}`
  return '—'
}

export type StatementWorkflowLabel =
  | 'Review Required'
  | 'Ready to Submit'
  | 'Ready for Approval'
  | 'Completed'
  | 'Cancelled'
  | 'Checking…'

/** Needs Review count for list/queue (DB rollups). */
export function statementQueueReviewCount(statement: {
  exceptionCount: number
  unmatchedCount: number
}): number {
  return Math.max(0, Number(statement.exceptionCount) + Number(statement.unmatchedCount))
}

/**
 * Daily work-queue workflow label using existing statement statuses.
 * Does not invent a second approval engine — `reviewed` = Ready for Approval.
 */
export function statementWorkflowLabel(statement: {
  status: StatementStatus
  exceptionCount: number
  unmatchedCount: number
}): StatementWorkflowLabel {
  const status = statement.status
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'completed') return 'Completed'
  if (status === 'reviewed') return 'Ready for Approval'
  if (status === 'matched') {
    return statementQueueReviewCount(statement) > 0 ? 'Review Required' : 'Ready to Submit'
  }
  if (
    status === 'pending' ||
    status === 'mapping' ||
    status === 'staged' ||
    status === 'matching'
  ) {
    return 'Checking…'
  }
  return statementQueueReviewCount(statement) > 0 ? 'Review Required' : 'Ready to Submit'
}

export function statementWorkflowSortRank(label: StatementWorkflowLabel): number {
  switch (label) {
    case 'Review Required':
      return 0
    case 'Ready for Approval':
      return 1
    case 'Ready to Submit':
      return 2
    case 'Checking…':
      return 3
    case 'Completed':
      return 4
    case 'Cancelled':
      return 5
    default:
      return 9
  }
}

export function statementWorkflowClass(label: StatementWorkflowLabel): string {
  switch (label) {
    case 'Review Required':
      return 'bg-orange-50 text-orange-800 ring-orange-600/20'
    case 'Ready for Approval':
      return 'bg-alza-blue-50 text-alza-blue-800 ring-alza-blue-600/20'
    case 'Ready to Submit':
      return 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'
    case 'Checking…':
      return 'bg-amber-50 text-amber-800 ring-amber-600/20'
    case 'Completed':
      return 'bg-slate-100 text-slate-600 ring-slate-500/20'
    case 'Cancelled':
      return 'bg-slate-100 text-slate-500 ring-slate-500/20'
    default:
      return 'bg-slate-100 text-slate-600 ring-slate-500/20'
  }
}

export function formatReconciliationMatchLabel(row: {
  matchStatus?: string | null
  resolutionNotes?: string | null
  rowSource?: string | null
}): string {
  if (row.matchStatus === 'skipped' && isPreviouslyConfirmedSkip(row.resolutionNotes)) {
    return 'Already Processed'
  }
  if (row.rowSource === 'missing' && (row.matchStatus === 'exception' || !row.matchStatus)) {
    return 'Missing'
  }
  return formatReconciliationStatus(row.matchStatus)
}

export function reconciliationMatchLabelClass(row: {
  matchStatus?: string | null
  resolutionNotes?: string | null
  rowSource?: string | null
}): string {
  const label = formatReconciliationMatchLabel(row)
  if (label === 'Already Processed') return 'bg-slate-100 text-slate-600 ring-slate-500/20'
  if (label === 'Matched' || label === 'Confirmed') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
  if (label === 'Needs Review' || label === 'Missing' || label === 'Underpaid' || label === 'Overpaid') {
    return 'bg-orange-50 text-orange-800 ring-orange-600/20'
  }
  return reconciliationStatusClass(row.matchStatus)
}

export function reconciliationStatusClass(status: string | null | undefined): string {
  const raw = String(status ?? '').toLowerCase()
  const label = formatReconciliationStatus(raw)
  if (label === 'Already Processed' || raw === 'already_processed') {
    return 'bg-slate-100 text-slate-600 ring-slate-500/20'
  }
  switch (raw) {
    case 'completed':
    case 'auto_matched':
    case 'confirmed':
    case 'exact_match':
    case 'high':
    case 'resolved':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
    case 'matched':
    case 'reviewed':
    case 'manual_matched':
    case 'acknowledged':
      return 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20'
    case 'matching':
    case 'staged':
    case 'mapping':
    case 'pending':
    case 'medium':
      return 'bg-amber-50 text-amber-700 ring-amber-600/20'
    case 'exception':
    case 'underpaid':
    case 'overpaid':
    case 'missing_from_statement':
    case 'zero_amount':
    case 'unmatched':
    case 'unmatched_row':
    case 'low':
      return 'bg-orange-50 text-orange-800 ring-orange-600/20'
    case 'cancelled':
    case 'skipped':
    case 'ignored':
      return 'bg-slate-100 text-slate-600 ring-slate-500/20'
    default:
      if (label === 'Needs Review' || label === 'Missing') {
        return 'bg-orange-50 text-orange-800 ring-orange-600/20'
      }
      if (label === 'Matched') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      return 'bg-slate-100 text-slate-600 ring-slate-500/20'
  }
}

export function runReconciliationPresentationChecks(): Array<{
  id: string
  name: string
  passed: boolean
  detail: string
}> {
  const cases: Array<{ id: string; name: string; got: string; want: string }> = [
    { id: 'p1', name: 'auto_matched displays Matched', got: formatReconciliationStatus('auto_matched'), want: 'Matched' },
    { id: 'p2', name: 'manual_matched displays Matched', got: formatReconciliationStatus('manual_matched'), want: 'Matched' },
    { id: 'p3', name: 'confirmed displays Confirmed', got: formatReconciliationStatus('confirmed'), want: 'Confirmed' },
    { id: 'p4', name: 'exception displays Needs Review', got: formatReconciliationStatus('exception'), want: 'Needs Review' },
    { id: 'p5', name: 'unmatched displays Needs Review', got: formatReconciliationStatus('unmatched'), want: 'Needs Review' },
    { id: 'p6', name: 'missing_from_statement displays Missing', got: formatReconciliationStatus('missing_from_statement'), want: 'Missing' },
    { id: 'p7', name: 'underpaid displays Underpaid', got: formatReconciliationStatus('underpaid'), want: 'Underpaid' },
    { id: 'p8', name: 'overpaid displays Overpaid', got: formatReconciliationStatus('overpaid'), want: 'Overpaid' },
    {
      id: 'p9',
      name: 'skipped with prior receipt displays Already Processed',
      got: formatReconciliationMatchLabel({
        matchStatus: 'skipped',
        resolutionNotes: 'Receipt already confirmed for this transaction',
      }),
      want: 'Already Processed',
    },
    {
      id: 'p10',
      name: 'other skipped stays Skipped',
      got: formatReconciliationMatchLabel({
        matchStatus: 'skipped',
        resolutionNotes: 'Duplicate match to same transaction within this statement',
      }),
      want: 'Skipped',
    },
    {
      id: 'p11',
      name: 'CSR cannot confirm reconciliation receipts',
      got: String(canConfirmReconciliationReceipts('csr')),
      want: 'false',
    },
    {
      id: 'p12',
      name: 'Owner can confirm reconciliation receipts',
      got: String(canConfirmReconciliationReceipts('owner')),
      want: 'true',
    },
    {
      id: 'p13',
      name: 'Producer cannot access Reconciliation',
      got: String(canAccessReconciliation('producer')),
      want: 'false',
    },
    {
      id: 'p14',
      name: 'CSR cannot complete statements (configure/complete gate)',
      got: String(canConfigureReconciliation('csr')),
      want: 'false',
    },
    {
      id: 'p15',
      name: 'changed amount on already processed shows variance note',
      got: buildAlreadyProcessedResolutionNotes(100, 115, 0.01).notes.includes(
        'Commission was already recorded at',
      )
        ? 'has-variance-note'
        : 'missing',
      want: 'has-variance-note',
    },
    {
      id: 'p16',
      name: 'same amount already processed has no variance discrepancy',
      got: buildAlreadyProcessedResolutionNotes(100, 100, 0.01).discrepancyType ?? 'null',
      want: 'null',
    },
    {
      id: 'p17',
      name: 'matched + review > 0 → Review Required',
      got: statementWorkflowLabel({
        status: 'matched',
        exceptionCount: 3,
        unmatchedCount: 0,
      }),
      want: 'Review Required',
    },
    {
      id: 'p18',
      name: 'matched + review = 0 → Ready to Submit',
      got: statementWorkflowLabel({
        status: 'matched',
        exceptionCount: 0,
        unmatchedCount: 0,
      }),
      want: 'Ready to Submit',
    },
    {
      id: 'p19',
      name: 'reviewed → Ready for Approval',
      got: statementWorkflowLabel({
        status: 'reviewed',
        exceptionCount: 0,
        unmatchedCount: 0,
      }),
      want: 'Ready for Approval',
    },
    {
      id: 'p20',
      name: 'carrier-only source label',
      got: statementSourceLabel({ carrier: 'CNA', mga: null }),
      want: 'Carrier · CNA',
    },
    {
      id: 'p21',
      name: 'mga-only source label',
      got: statementSourceLabel({ carrier: null, mga: 'ISC' }),
      want: 'MGA · ISC',
    },
    {
      id: 'p22',
      name: 'dual-party older statement still labeled',
      got: statementSourceLabel({ carrier: 'CNA', mga: 'ISC' }),
      want: 'Carrier · CNA · MGA · ISC',
    },
  ]
  return cases.map((c) => ({
    id: c.id,
    name: c.name,
    passed: c.got === c.want,
    detail: `got ${c.got} want ${c.want}`,
  }))
}

export function runReconciliationPass2SafetyChecks(): Array<{
  id: string
  name: string
  passed: boolean
  detail: string
}> {
  const cases: Array<{ id: string; name: string; passed: boolean; detail: string }> = []

  cases.push({
    id: 'A',
    name: 'Owner complete gate exists in client (canConfigureReconciliation)',
    passed: canConfigureReconciliation('owner') && !canConfigureReconciliation('csr'),
    detail: `owner=${canConfigureReconciliation('owner')} csr=${canConfigureReconciliation('csr')}`,
  })

  cases.push({
    id: 'C',
    name: 'CSR cannot confirm reconciliation receipts',
    passed: !canConfirmReconciliationReceipts('csr'),
    detail: `csr=${canConfirmReconciliationReceipts('csr')}`,
  })

  cases.push({
    id: 'D',
    name: 'Global occupancy includes auto_matched and manual_matched only',
    passed:
      isGlobalUnconfirmedOccupancyStatus('auto_matched') &&
      isGlobalUnconfirmedOccupancyStatus('manual_matched') &&
      !isGlobalUnconfirmedOccupancyStatus('exception') &&
      !isGlobalUnconfirmedOccupancyStatus('skipped'),
    detail: 'exception excluded from occupancy statuses',
  })

  cases.push({
    id: 'H',
    name: 'Exception on another statement does not count as global occupancy status',
    passed: !isGlobalUnconfirmedOccupancyStatus('exception'),
    detail: 'exception not in GLOBAL_UNCONFIRMED_OCCUPANCY_STATUSES',
  })

  const summary = computeStatementPresentationSummary([
    { rowSource: 'import', matchStatus: 'skipped', resolutionNotes: 'Receipt already confirmed for this transaction' },
    { rowSource: 'import', matchStatus: 'skipped', resolutionNotes: 'Receipt already confirmed for this transaction' },
    { rowSource: 'import', matchStatus: 'auto_matched' },
    { rowSource: 'import', matchStatus: 'exception' },
    { rowSource: 'import', matchStatus: 'exception' },
  ])
  cases.push({
    id: 'F-summary',
    name: 'Tue A+B+C presentation summary (2 processed, 1 matched, 2 review)',
    passed:
      summary.imported === 5 &&
      summary.alreadyProcessed === 2 &&
      summary.matched === 1 &&
      summary.needsReview === 2,
    detail: JSON.stringify(summary),
  })

  const crossNote =
    'Already matched on another statement and awaiting receipt confirmation.'
  cases.push({
    id: 'G-label',
    name: 'Cross-statement occupancy uses plain agency note',
    passed: isCrossStatementOccupancyNote(crossNote),
    detail: crossNote,
  })

  cases.push({
    id: 'I',
    name: 'Same confirmed amount -> Already Processed label',
    passed:
      formatReconciliationMatchLabel({
        matchStatus: 'skipped',
        resolutionNotes: 'Receipt already confirmed for this transaction',
      }) === 'Already Processed',
    detail: formatReconciliationMatchLabel({
      matchStatus: 'skipped',
      resolutionNotes: 'Receipt already confirmed for this transaction',
    }),
  })

  const changed = buildAlreadyProcessedResolutionNotes(937.5, 950, 0.01)
  cases.push({
    id: 'J',
    name: 'Different confirmed amount -> Already Processed + overpaid variance',
    passed:
      formatReconciliationMatchLabel({
        matchStatus: 'skipped',
        resolutionNotes: changed.notes,
      }) === 'Already Processed' && changed.discrepancyType === 'overpaid',
    detail: `${changed.discrepancyType} ${changed.variance}`,
  })

  const cancelClass = classifyStatementVsRecordedAmount(-350, -350, 0.01)
  cases.push({
    id: 'K',
    name: 'Signed cancellation exact match classification',
    passed: cancelClass.discrepancyType === 'exact_match' && cancelClass.variance === 0,
    detail: `variance=${cancelClass.variance}`,
  })

  return cases
}

export async function hashFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000) return null
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000
  const d = new Date(utc)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export function parseIsoDate(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number') return excelSerialToIso(value)
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    let y = Number(m[3])
    if (y < 100) y += 2000
    const month = a > 12 ? b : a
    const day = a > 12 ? a : b
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return Number.isNaN(new Date(iso).getTime()) ? null : iso
  }
  const asNum = Number(s)
  if (Number.isFinite(asNum) && asNum > 20000) return excelSerialToIso(asNum)
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const normalized = headers.map((h) => ({
    raw: h,
    key: h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  }))
  const pick = (needles: string[], field: ReconciliationFieldKey) => {
    if (mapping[field]) return
    const hit = normalized.find((h) => needles.some((n) => h.key === n || h.key.includes(n)))
    if (hit) mapping[field] = hit.raw
  }
  pick(['policy number', 'policy no', 'policy #', 'policynumber', 'policy'], 'policy_number')
  pick(['commission', 'commission amount', 'comm amt', 'agency commission'], 'commission_amount')
  pick(['client', 'insured', 'client name', 'insured name'], 'client_name')
  pick(['premium', 'premium amount', 'written premium'], 'premium_amount')
  pick(['transaction date', 'date', 'effective date', 'entry date'], 'transaction_date')
  pick(['transaction type', 'type', 'trans type', 'txn type'], 'transaction_type')
  pick(['carrier', 'carrier name', 'company'], 'carrier_name')
  pick(['mga', 'mga name', 'broker'], 'mga_name')
  pick(['description', 'desc', 'remarks', 'notes'], 'description')
  pick(['reference', 'invoice', 'external', 'statement ref'], 'external_reference')
  return mapping
}

export function applyColumnMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
): Array<{
  rowIndex: number
  rawData: Record<string, unknown>
  policyNumber: string | null
  clientName: string | null
  commissionAmount: number | null
  premiumAmount: number | null
  transactionDate: string | null
  transactionType: string | null
  carrierName: string | null
  mgaName: string | null
  description: string | null
  externalReference: string | null
}> {
  const get = (row: Record<string, unknown>, field: ReconciliationFieldKey): unknown => {
    const header = mapping[field]
    if (!header) return null
    return row[header]
  }
  return rows.map((row, rowIndex) => {
    const policy = String(get(row, 'policy_number') ?? '').trim() || null
    const typeRaw = String(get(row, 'transaction_type') ?? '').trim() || null
    return {
      rowIndex,
      rawData: row,
      policyNumber: policy,
      clientName: String(get(row, 'client_name') ?? '').trim() || null,
      commissionAmount: parseMoney(get(row, 'commission_amount')),
      premiumAmount: parseMoney(get(row, 'premium_amount')),
      transactionDate: parseIsoDate(get(row, 'transaction_date')),
      transactionType: mapStatementTransactionType(typeRaw) ?? typeRaw,
      carrierName: String(get(row, 'carrier_name') ?? '').trim() || null,
      mgaName: String(get(row, 'mga_name') ?? '').trim() || null,
      description: String(get(row, 'description') ?? '').trim() || null,
      externalReference: String(get(row, 'external_reference') ?? '').trim() || null,
    }
  })
}

async function requireOps() {
  return rejectUnlessRole(canAccessReconciliation, 'You do not have permission to access reconciliation.')
}

export async function fetchReconciliationStatements(): Promise<{
  data: ReconciliationStatement[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('reconciliation_statements')
    .select(STATEMENT_SELECT)
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []).map((r) => mapStatement(r as Record<string, unknown>)), error: null }
}

export async function fetchReconciliationStatement(id: string): Promise<{
  data: ReconciliationStatement | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('reconciliation_statements')
    .select(STATEMENT_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: null }
  return { data: mapStatement(data as Record<string, unknown>), error: null }
}

export async function fetchReconciliationRows(statementId: string): Promise<{
  data: ReconciliationStatementRow[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('reconciliation_statement_rows')
    .select(ROW_SELECT)
    .eq('statement_id', statementId)
    .order('row_source', { ascending: true })
    .order('row_index', { ascending: true })
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), error: null }
}

export async function fetchExceptionRows(): Promise<{
  data: Array<ReconciliationStatementRow & { statement?: ReconciliationStatement }>
  error: string | null
}> {
  const { data, error } = await supabase
    .from('reconciliation_statement_rows')
    .select(
      `${ROW_SELECT}, reconciliation_statements ( ${STATEMENT_SELECT} )`,
    )
    .in('match_status', ['exception', 'unmatched', 'auto_matched', 'manual_matched'])
    .eq('resolution_status', 'open')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return { data: [], error: error.message }
  return {
    data: (data ?? [])
      .map((raw) => {
        const row = raw as Record<string, unknown>
        const stmtEmbed = firstEmbed(
          row.reconciliation_statements as Record<string, unknown> | Record<string, unknown>[] | null,
        )
        return {
          ...mapRow(row),
          statement: stmtEmbed ? mapStatement(stmtEmbed) : undefined,
        }
      })
      .filter((row) =>
        row.matchStatus === 'exception' ||
        row.matchStatus === 'unmatched' ||
        (row.discrepancyType && row.discrepancyType !== 'exact_match'),
      ),
    error: null,
  }
}

export async function fetchColumnMappings(params?: {
  carrierId?: string | null
  mgaId?: string | null
}): Promise<{ data: ColumnMappingRecord[]; error: string | null }> {
  let q = supabase
    .from('reconciliation_column_mappings')
    .select('id, name, carrier, mga, carrier_id, mga_id, mapping')
    .order('name')
  if (params?.carrierId) q = q.eq('carrier_id', params.carrierId)
  if (params?.mgaId) q = q.eq('mga_id', params.mgaId)
  const { data, error } = await q
  if (error) return { data: [], error: error.message }
  return {
    data: (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      carrier: (row.carrier as string | null) ?? null,
      mga: (row.mga as string | null) ?? null,
      carrierId: (row.carrier_id as string | null) ?? null,
      mgaId: (row.mga_id as string | null) ?? null,
      mapping: asRecord(row.mapping) as ColumnMapping,
    })),
    error: null,
  }
}

export async function saveColumnMapping(input: {
  id?: string
  name: string
  mapping: ColumnMapping
  carrier?: string | null
  mga?: string | null
  carrierId?: string | null
  mgaId?: string | null
  overwrite?: boolean
}): Promise<{
  data: ColumnMappingRecord | null
  error: string | null
  needsOverwriteConfirm?: ColumnMappingRecord
}> {
  const authz = await requireOps()
  if (!authz.ok) return { data: null, error: authz.message }
  const agency = await fetchAgencyProfile()
  if (!agency.data?.id) return { data: null, error: 'Agency profile is required before saving mappings.' }
  const name = input.name.trim()
  if (!name) return { data: null, error: 'Mapping name is required.' }

  const payload = {
    agency_profile_id: agency.data.id,
    name,
    mapping: input.mapping,
    carrier: input.carrier ?? null,
    mga: input.mga ?? null,
    carrier_id: input.carrierId ?? null,
    mga_id: input.mgaId ?? null,
    updated_at: new Date().toISOString(),
  }

  const { data: existingByName } = await supabase
    .from('reconciliation_column_mappings')
    .select('id, name, carrier, mga, carrier_id, mga_id, mapping')
    .eq('agency_profile_id', agency.data.id)
    .eq('name', name)
    .maybeSingle()

  const existing = existingByName
    ? {
        id: String(existingByName.id),
        name: String(existingByName.name ?? ''),
        carrier: (existingByName.carrier as string | null) ?? null,
        mga: (existingByName.mga as string | null) ?? null,
        carrierId: (existingByName.carrier_id as string | null) ?? null,
        mgaId: (existingByName.mga_id as string | null) ?? null,
        mapping: asRecord(existingByName.mapping) as ColumnMapping,
      }
    : null

  function sameParty(row: ColumnMappingRecord) {
    return (row.carrierId || null) === (payload.carrier_id || null) && (row.mgaId || null) === (payload.mga_id || null)
  }

  function partyLabel(row: { carrier: string | null; mga: string | null }) {
    return row.carrier || row.mga || 'an unspecified carrier/MGA'
  }

  if (existing && input.id && existing.id !== input.id) {
    return {
      data: null,
      error: `A mapping named “${name}” already exists for ${partyLabel(existing)}. Choose a different name.`,
    }
  }

  if (!input.id && existing && !sameParty(existing)) {
    return {
      data: null,
      error: `A mapping named “${name}” already exists for ${partyLabel(existing)}. Choose a different name so this ${payload.carrier || payload.mga || 'statement'} mapping is not mixed with another party.`,
    }
  }

  if (!input.id && existing && sameParty(existing) && !input.overwrite) {
    return { data: null, error: null, needsOverwriteConfirm: existing }
  }

  const targetId = input.id || (existing && sameParty(existing) ? existing.id : null)
  const query = targetId
    ? supabase.from('reconciliation_column_mappings').update(payload).eq('id', targetId)
    : supabase.from('reconciliation_column_mappings').insert(payload)

  const { data, error } = await query
    .select('id, name, carrier, mga, carrier_id, mga_id, mapping')
    .single()

  if (error) {
    const duplicate =
      error.code === '23505' ||
      error.message.toLowerCase().includes('duplicate') ||
      error.message.toLowerCase().includes('unique')
    if (duplicate) {
      return {
        data: null,
        error: `A mapping named “${name}” already exists. Choose a different name.`,
      }
    }
    return { data: null, error: error.message }
  }

  await recordActivity({
    action: 'reconciliation_mapping_saved',
    entityType: 'reconciliation',
    entityId: data.id as string,
    recordReference: payload.name,
    newValue: { name: payload.name, mapping: input.mapping, updated: Boolean(targetId) },
  })
  return {
    data: {
      id: String(data.id),
      name: String(data.name),
      carrier: (data.carrier as string | null) ?? null,
      mga: (data.mga as string | null) ?? null,
      carrierId: (data.carrier_id as string | null) ?? null,
      mgaId: (data.mga_id as string | null) ?? null,
      mapping: asRecord(data.mapping) as ColumnMapping,
    },
    error: null,
  }
}

export async function deleteColumnMapping(id: string): Promise<{ error: string | null }> {
  const authz = await rejectUnlessRole(
    canConfigureReconciliation,
    'Only Owner or Admin may delete saved mappings.',
  )
  if (!authz.ok) return { error: authz.message }
  const { error } = await supabase.from('reconciliation_column_mappings').delete().eq('id', id)
  return { error: error?.message ?? null }
}

async function invokeFunction(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let detail = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const payload = (await ctx.json()) as { message?: string }
        if (payload?.message) detail = payload.message
      }
    } catch {
      /* keep */
    }
    return { data: null, error: detail }
  }
  if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
    return { data, error: String((data as { message?: string }).message || 'Request failed.') }
  }
  return { data, error: null }
}

export async function runReconciliationMatching(
  statementId: string,
  options: boolean | { rerun?: boolean; detectMissing?: boolean } = false,
) {
  const authz = await requireOps()
  if (!authz.ok) return { data: null, error: authz.message }
  const opts = typeof options === 'boolean' ? { rerun: options } : options
  await recordActivity({
    action: 'reconciliation_matching_started',
    entityType: 'reconciliation',
    entityId: statementId,
    recordReference: statementId,
  })
  return invokeFunction('run-reconciliation-matching', {
    statementId,
    rerun: Boolean(opts.rerun),
    ...(typeof opts.detectMissing === 'boolean' ? { detectMissing: opts.detectMissing } : {}),
  })
}

export async function confirmReconciliationReceipts(statementId: string, rowIds?: string[]) {
  const authz = await rejectUnlessRole(
    canConfirmReconciliationReceipts,
    'Only Owner or Admin may confirm agency commission receipts.',
  )
  if (!authz.ok) return { data: null, error: authz.message }
  return invokeFunction('confirm-reconciliation-receipts', { statementId, rowIds })
}

export async function importReconciliationStatement(input: {
  file: File
  mapping: ColumnMapping
  carrier: string | null
  mga: string | null
  carrierId: string | null
  mgaId: string | null
  periodStart: string
  periodEnd: string
  statementDate?: string | null
  roundingTolerance?: number
  detectMissing?: boolean
  contentHash?: string
}): Promise<{ data: ReconciliationStatement | null; error: string | null }> {
  const authz = await requireOps()
  if (!authz.ok) return { data: null, error: authz.message }
  if (!input.mapping.policy_number || !input.mapping.commission_amount) {
    return { data: null, error: 'Map policy number and commission amount before importing.' }
  }
  if (!input.periodStart || !input.periodEnd) {
    return { data: null, error: 'Statement period start and end are required.' }
  }
  if (input.periodStart > input.periodEnd) {
    return { data: null, error: 'Period start must be on or before period end.' }
  }
  if (!input.carrier && !input.mga && !input.carrierId && !input.mgaId) {
    return { data: null, error: 'Select a carrier or MGA.' }
  }

  const agency = await fetchAgencyProfile()
  if (!agency.data?.id) {
    return { data: null, error: 'Agency profile is required before importing statements.' }
  }

  const parsed = await parseStatementFile(input.file)
  const mapped = applyColumnMapping(parsed.rows, input.mapping)
  if (!mapped.length) return { data: null, error: 'The file has no data rows.' }

  const fileHash = input.contentHash ?? (await hashFileSha256(input.file))
  const role = await loadCurrentAppRole()

  const insertPayload = {
    agency_profile_id: agency.data.id,
    carrier: input.carrier,
    mga: input.mga,
    carrier_id: input.carrierId,
    mga_id: input.mgaId,
    statement_date: input.statementDate || input.periodEnd,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    file_name: input.file.name,
    file_hash: fileHash,
    row_count: mapped.length,
    status: 'staged',
    rounding_tolerance: input.roundingTolerance ?? 0.01,
    detect_missing: Boolean(input.detectMissing),
    uploaded_by: role.profileId,
    updated_at: new Date().toISOString(),
  }

  let statementId: string | null = null
  const { data: inserted, error: insertError } = await supabase
    .from('reconciliation_statements')
    .insert(insertPayload)
    .select(STATEMENT_SELECT)
    .single()

  if (insertError) {
    const duplicate =
      insertError.code === '23505' ||
      insertError.message.toLowerCase().includes('file_hash') ||
      insertError.message.toLowerCase().includes('duplicate')
    if (duplicate) {
      const { data: existing } = await supabase
        .from('reconciliation_statements')
        .select(STATEMENT_SELECT)
        .eq('file_hash', fileHash)
        .eq('agency_profile_id', agency.data.id)
        .maybeSingle()
      if (existing && Number(existing.row_count ?? 0) === 0) {
        statementId = String(existing.id)
      } else {
        return { data: null, error: DUPLICATE_FILE_MESSAGE }
      }
    } else {
      return { data: null, error: insertError.message }
    }
  } else {
    statementId = String(inserted.id)
  }

  if (!statementId) return { data: null, error: 'Unable to create statement.' }

  const storagePath = `${agency.data.id}/${statementId}/${input.file.name}`
  const { error: uploadError } = await supabase.storage
    .from('reconciliation-statements')
    .upload(storagePath, input.file, { upsert: true })
  if (uploadError) {
    // Keep the statement row; matching can still proceed without the audit file.
    console.warn('Statement file storage upload failed:', uploadError.message)
  } else {
    await supabase
      .from('reconciliation_statements')
      .update({ file_storage_path: storagePath, updated_at: new Date().toISOString() })
      .eq('id', statementId)
  }

  const payloads = mapped.map((row) => ({
    statement_id: statementId,
    row_source: 'import',
    row_index: row.rowIndex,
    raw_data: row.rawData,
    policy_number: row.policyNumber,
    client_name: row.clientName,
    commission_amount: row.commissionAmount,
    premium_amount: row.premiumAmount,
    transaction_date: row.transactionDate,
    transaction_type: row.transactionType,
    carrier_name: row.carrierName,
    mga_name: row.mgaName,
    description: row.description,
    external_reference: row.externalReference,
    match_status: 'pending',
  }))

  const batchSize = 150
  for (let i = 0; i < payloads.length; i += batchSize) {
    const chunk = payloads.slice(i, i + batchSize)
    const { error: rowError } = await supabase.from('reconciliation_statement_rows').insert(chunk)
    if (rowError) return { data: null, error: rowError.message }
  }

  await recordActivity({
    action: 'reconciliation_import',
    entityType: 'reconciliation',
    entityId: statementId,
    recordReference: input.file.name,
    newValue: { rowCount: mapped.length, carrier: input.carrier, mga: input.mga },
  })

  const matchResult = await runReconciliationMatching(statementId)
  if (matchResult.error) {
    return {
      data: mapStatement((inserted ?? { id: statementId }) as Record<string, unknown>),
      error: `Statement imported, but matching failed: ${matchResult.error}`,
    }
  }

  const refreshed = await fetchReconciliationStatement(statementId)
  return { data: refreshed.data, error: refreshed.error }
}

export async function updateStatementStatus(
  id: string,
  status: StatementStatus,
): Promise<{ error: string | null }> {
  const authz = await requireOps()
  if (!authz.ok) return { error: authz.message }
  if (status === 'completed') {
    const cfg = await rejectUnlessRole(
      canConfigureReconciliation,
      'Only Owner or Admin may complete a statement.',
    )
    if (!cfg.ok) return { error: cfg.message }
    const { data: unconfirmed, error: unconfirmedError } = await supabase
      .from('reconciliation_statement_rows')
      .select('id')
      .eq('statement_id', id)
      .in('match_status', ['auto_matched', 'manual_matched'])
      .is('receipt_id', null)
      .limit(1)
    if (unconfirmedError) return { error: unconfirmedError.message }
    if (unconfirmed?.length) {
      return {
        error: 'Confirm matched commission receipts before completing this statement.',
      }
    }
  }
  if (status === 'cancelled') {
    const current = await fetchReconciliationStatement(id)
    if (current.data?.status === 'completed') {
      const cfg = await rejectUnlessRole(
        canConfigureReconciliation,
        'Only Owner or Admin may cancel a completed statement.',
      )
      if (!cfg.ok) return { error: cfg.message }
    }
  }
  const { error } = await supabase
    .from('reconciliation_statements')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  if (status === 'cancelled' || status === 'completed') {
    await recordActivity({
      action: status === 'cancelled' ? 'reconciliation_cancelled' : 'reconciliation_completed',
      entityType: 'reconciliation',
      entityId: id,
      recordReference: id,
      newValue: { status },
    })
  }
  return { error: null }
}

export async function updateStatementTolerance(
  id: string,
  roundingTolerance: number,
): Promise<{ error: string | null }> {
  const authz = await rejectUnlessRole(
    canConfigureReconciliation,
    'Only Owner or Admin may change rounding tolerance.',
  )
  if (!authz.ok) return { error: authz.message }
  const value = roundMoney(roundingTolerance)
  if (value < 0) return { error: 'Tolerance cannot be negative.' }
  const { error } = await supabase
    .from('reconciliation_statements')
    .update({ rounding_tolerance: value, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error?.message ?? null }
}

export interface OccupyingMatch {
  statementId: string
  statementFileName: string
  rowId: string
  matchStatus: string
  receiptConfirmed: boolean
}

export async function manualMatchRow(params: {
  rowId: string
  transactionId: string
  expectedCommission: number
  commissionAmount: number | null
  roundingTolerance: number
}): Promise<{ error: string | null; occupancy?: OccupyingMatch }> {
  const authz = await requireOps()
  if (!authz.ok) return { error: authz.message }

  const { data: txnGuard } = await supabase
    .from('transactions')
    .select('id, agency_commission_confirmed, agency_commission_receipt_id, transaction_number')
    .eq('id', params.transactionId)
    .maybeSingle()
  if (txnGuard?.agency_commission_confirmed || txnGuard?.agency_commission_receipt_id) {
    return {
      error: `Transaction ${txnGuard.transaction_number || params.transactionId} already has a confirmed agency commission receipt and cannot be matched again.`,
      occupancy: {
        statementId: '',
        statementFileName: '',
        rowId: '',
        matchStatus: 'confirmed',
        receiptConfirmed: true,
      },
    }
  }

  const { data: existingReceipt } = await supabase
    .from('agency_commission_receipts')
    .select('id')
    .eq('transaction_id', params.transactionId)
    .limit(1)
    .maybeSingle()
  if (existingReceipt) {
    return {
      error: 'This transaction already has an agency commission receipt and cannot be matched again.',
      occupancy: {
        statementId: '',
        statementFileName: '',
        rowId: '',
        matchStatus: 'confirmed',
        receiptConfirmed: true,
      },
    }
  }

  const { data: existing } = await supabase
    .from('reconciliation_statement_rows')
    .select(
      `
      id, statement_id, match_status, row_source, receipt_id,
      reconciliation_statements ( id, file_name )
    `,
    )
    .eq('matched_transaction_id', params.transactionId)
    .neq('id', params.rowId)
    .eq('row_source', 'import')
    .in('match_status', ['auto_matched', 'manual_matched', 'confirmed', 'exception'])
    .limit(1)
    .maybeSingle()

  if (existing) {
    const stmt = firstEmbed(
      existing.reconciliation_statements as
        | { id?: string; file_name?: string }
        | { id?: string; file_name?: string }[]
        | null,
    )
    const receiptConfirmed = existing.match_status === 'confirmed' || Boolean(existing.receipt_id)
    const fileName = stmt?.file_name || 'another statement'
    const occupancy: OccupyingMatch = {
      statementId: String(existing.statement_id || stmt?.id || ''),
      statementFileName: String(fileName),
      rowId: String(existing.id),
      matchStatus: String(existing.match_status),
      receiptConfirmed,
    }
    if (receiptConfirmed) {
      return {
        error: `This transaction already has a confirmed receipt on “${fileName}” and cannot be matched again.`,
        occupancy,
      }
    }
    return {
      error: `This transaction is already matched on “${fileName}” (${formatReconciliationStatus(String(existing.match_status))}). Unmatch that row first, then retry. Confirmed receipts cannot be reassigned.`,
      occupancy,
    }
  }
  const { data: targetRow } = await supabase
    .from('reconciliation_statement_rows')
    .select('id, statement_id')
    .eq('id', params.rowId)
    .maybeSingle()
  const classified = classifySignedVariance({
    commissionAmount: params.commissionAmount,
    expectedCommission: params.expectedCommission,
    roundingTolerance: params.roundingTolerance,
  })
  const { error } = await supabase
    .from('reconciliation_statement_rows')
    .update({
      matched_transaction_id: params.transactionId,
      match_status: 'manual_matched',
      match_confidence: 'medium',
      expected_commission: params.expectedCommission,
      variance: classified.variance,
      discrepancy_type: classified.discrepancyType,
      resolution_status: 'resolved',
      resolved_by: authz.profileId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.rowId)
  if (error) return { error: error.message }
  if (targetRow?.statement_id) {
    await supabase
      .from('reconciliation_statement_rows')
      .update({
        match_status: 'skipped',
        resolution_status: 'ignored',
        resolution_notes: 'Cleared because an imported statement row was matched to this transaction.',
        updated_at: new Date().toISOString(),
      })
      .eq('statement_id', targetRow.statement_id)
      .eq('row_source', 'missing')
      .eq('matched_transaction_id', params.transactionId)
  }
  await recordActivity({
    action: 'reconciliation_manual_match',
    entityType: 'reconciliation',
    entityId: params.rowId,
    transactionId: params.transactionId,
    newValue: { transactionId: params.transactionId },
  })
  return { error: null }
}

export async function unmatchRow(rowId: string): Promise<{ error: string | null }> {
  const authz = await requireOps()
  if (!authz.ok) return { error: authz.message }
  const { data: current } = await supabase
    .from('reconciliation_statement_rows')
    .select('match_status, receipt_id')
    .eq('id', rowId)
    .maybeSingle()
  if (current?.match_status === 'confirmed' || current?.receipt_id) {
    return { error: 'Cannot unmatch a row after the receipt has been confirmed.' }
  }
  const { error } = await supabase
    .from('reconciliation_statement_rows')
    .update({
      matched_transaction_id: null,
      match_status: 'unmatched',
      match_confidence: 'none',
      expected_commission: null,
      variance: null,
      discrepancy_type: 'unmatched_row',
      resolution_status: 'open',
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
  if (error) return { error: error.message }
  await recordActivity({
    action: 'reconciliation_manual_unmatch',
    entityType: 'reconciliation',
    entityId: rowId,
  })
  return { error: null }
}

export async function resolveStatementRow(params: {
  rowId: string
  resolutionStatus: 'acknowledged' | 'resolved' | 'ignored' | 'open'
  notes?: string
  skip?: boolean
}): Promise<{ error: string | null }> {
  const authz = await requireOps()
  if (!authz.ok) return { error: authz.message }
  const patch: Record<string, unknown> = {
    resolution_status: params.resolutionStatus,
    resolution_notes: params.notes?.trim() || null,
    resolved_by: authz.profileId,
    resolved_at: params.resolutionStatus === 'open' ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (params.skip) {
    patch.match_status = 'skipped'
    patch.resolution_status = 'ignored'
  } else if (params.resolutionStatus === 'resolved') {
    const { data: current } = await supabase
      .from('reconciliation_statement_rows')
      .select('match_status, matched_transaction_id, receipt_id, row_source')
      .eq('id', params.rowId)
      .maybeSingle()
    if (
      current?.row_source === 'import' &&
      current.matched_transaction_id &&
      !current.receipt_id &&
      current.match_status === 'exception'
    ) {
      patch.match_status = 'manual_matched'
    }
  }
  const { error } = await supabase.from('reconciliation_statement_rows').update(patch).eq('id', params.rowId)
  if (error) return { error: error.message }
  await recordActivity({
    action: 'reconciliation_exception_resolved',
    entityType: 'reconciliation',
    entityId: params.rowId,
    newValue: {
      resolutionStatus: params.skip ? 'ignored' : params.resolutionStatus,
      notes: params.notes ?? null,
      skipped: Boolean(params.skip),
    },
  })
  return { error: null }
}

export async function searchMatchTransactions(query: string): Promise<{
  data: Array<{
    id: string
    transactionNumber: string
    type: string
    date: string | null
    policyNumber: string
    clientName: string
    carrier: string | null
    mga: string | null
    expectedCommission: number
    confirmed: boolean
  }>
  error: string | null
}> {
  const q = query.trim()
  let txnQuery = supabase
    .from('transactions')
    .select(
      `
      id, transaction_number, transaction_type, transaction_date, expected_amount,
      agency_commission_amount, carrier, mga, agency_commission_confirmed,
      clients ( business_name ),
      policies ( policy_number )
    `,
    )
    .is('voided_at', null)
    .is('archived_at', null)
    .limit(40)

  if (q) {
    txnQuery = txnQuery.or(
      `transaction_number.ilike.%${q}%,carrier.ilike.%${q}%,mga.ilike.%${q}%`,
    )
  }

  const { data, error } = await txnQuery
  if (error) return { data: [], error: error.message }

  let extra: typeof data = []
  if (q) {
    const { data: policies } = await supabase
      .from('policies')
      .select('id, policy_number')
      .ilike('policy_number', `%${q}%`)
      .limit(20)
    const ids = (policies ?? []).map((p) => p.id as string)
    if (ids.length) {
      const { data: byPolicy } = await supabase
        .from('transactions')
        .select(
          `
          id, transaction_number, transaction_type, transaction_date, expected_amount,
          agency_commission_amount, carrier, mga, agency_commission_confirmed,
          clients ( business_name ),
          policies ( policy_number )
        `,
        )
        .in('policy_id', ids)
        .is('voided_at', null)
        .is('archived_at', null)
        .limit(40)
      extra = byPolicy ?? []
    }
  }

  const merged = [...(data ?? []), ...extra]
  const seen = new Set<string>()
  const rows = merged
    .filter((row) => {
      const id = String(row.id)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map((row) => {
      const policy = firstEmbed(row.policies as { policy_number?: string } | { policy_number?: string }[] | null)
      const client = firstEmbed(row.clients as { business_name?: string } | { business_name?: string }[] | null)
      return {
        id: String(row.id),
        transactionNumber: String(row.transaction_number ?? ''),
        type: String(row.transaction_type ?? ''),
        date: (row.transaction_date as string | null) ?? null,
        policyNumber: String(policy?.policy_number ?? ''),
        clientName: String(client?.business_name ?? ''),
        carrier: (row.carrier as string | null) ?? null,
        mga: (row.mga as string | null) ?? null,
        expectedCommission:
          parseMoney(row.expected_amount) ?? parseMoney(row.agency_commission_amount) ?? 0,
        confirmed: Boolean(row.agency_commission_confirmed),
      }
    })

  return { data: rows, error: null }
}

export function formatSignedCurrency(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  return formatCurrency(amount)
}

export function openExceptions(rows: ReconciliationStatementRow[]): ReconciliationStatementRow[] {
  return rows.filter(
    (r) =>
      (r.matchStatus === 'exception' || r.matchStatus === 'unmatched') && r.resolutionStatus === 'open',
  )
}
