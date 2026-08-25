/** Client-side Producer Payments table sort. Uses underlying values, not labels. */

import { compareNewestCreatedThenCode, mapCreatedAtValue } from './createdFirstSort'

export type ProducerPaymentSortKey =
  | 'createdAt'
  | 'batchNumber'
  | 'producer'
  | 'paymentDate'
  | 'grossCommission'
  | 'netPayment'
  | 'status'
  | 'paymentMethod'

export type SortDirection = 'asc' | 'desc'

export interface ProducerPaymentSort {
  key: ProducerPaymentSortKey
  direction: SortDirection
}

/** Newest created batch first; batch number is the stable tie-breaker. */
export const DEFAULT_PRODUCER_PAYMENT_SORT: ProducerPaymentSort = {
  key: 'createdAt',
  direction: 'desc',
}

/** Header keys shown on the Producer Payments table (no dedicated Created column). */
export const PRODUCER_PAYMENT_TABLE_SORT_KEYS: readonly ProducerPaymentSortKey[] = [
  'batchNumber',
  'producer',
  'paymentDate',
  'grossCommission',
  'netPayment',
  'status',
  'paymentMethod',
] as const

export interface ProducerPaymentSortableRow {
  createdAt: string
  batchNumber: string
  producer: string
  paymentDate: string | null
  grossCommission: number
  netPayment: number
  status: string
  paymentMethod: string
  paymentReference?: string
}

export function nextProducerPaymentSort(
  current: ProducerPaymentSort,
  clicked: ProducerPaymentSortKey,
): ProducerPaymentSort {
  if (current.key === clicked) {
    return { key: clicked, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key: clicked, direction: 'asc' }
}

/**
 * Default sort is createdAt DESC, but the table has no Created column.
 * Surface that state on the Batch header so the active arrow is visible.
 */
export function isProducerPaymentHeaderActive(
  sort: ProducerPaymentSort,
  headerKey: ProducerPaymentSortKey,
): boolean {
  if (sort.key === headerKey) return true
  return headerKey === 'batchNumber' && sort.key === 'createdAt'
}

export function producerPaymentHeaderDirection(
  sort: ProducerPaymentSort,
  headerKey: ProducerPaymentSortKey,
): SortDirection {
  if (isProducerPaymentHeaderActive(sort, headerKey)) return sort.direction
  return 'asc'
}

function cmpString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function cmpNumber(a: number, b: number): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** paymentDate: nulls last on desc, nulls first on asc. */
function cmpNullableDate(a: string | null, b: string | null, direction: SortDirection): number {
  const aVal = (a ?? '').trim()
  const bVal = (b ?? '').trim()
  const aEmpty = !aVal
  const bEmpty = !bVal
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return direction === 'asc' ? -1 : 1
  if (bEmpty) return direction === 'asc' ? 1 : -1
  return cmpString(aVal, bVal)
}

function compareKey(
  a: ProducerPaymentSortableRow,
  b: ProducerPaymentSortableRow,
  key: ProducerPaymentSortKey,
  direction: SortDirection,
): number {
  switch (key) {
    case 'createdAt':
      // Date.parse (not localeCompare) — Postgres timestamptz strings must rank by time.
      return compareNewestCreatedThenCode(a.createdAt, b.createdAt, a.batchNumber, b.batchNumber) *
        (direction === 'asc' ? -1 : 1)
    case 'batchNumber':
      return cmpString(a.batchNumber, b.batchNumber)
    case 'producer':
      return cmpString(a.producer, b.producer)
    case 'paymentDate':
      return cmpNullableDate(a.paymentDate, b.paymentDate, direction)
    case 'grossCommission':
      return cmpNumber(a.grossCommission, b.grossCommission)
    case 'netPayment':
      return cmpNumber(a.netPayment, b.netPayment)
    case 'status':
      return cmpString(a.status, b.status)
    case 'paymentMethod': {
      const method = cmpString(a.paymentMethod, b.paymentMethod)
      if (method !== 0) return method
      return cmpString(a.paymentReference ?? '', b.paymentReference ?? '')
    }
    default:
      return 0
  }
}

export function sortProducerPaymentBatches<T extends ProducerPaymentSortableRow>(
  rows: T[],
  sort: ProducerPaymentSort = DEFAULT_PRODUCER_PAYMENT_SORT,
): T[] {
  const copy = [...rows]
  const dir = sort.direction === 'asc' ? 1 : -1
  copy.sort((a, b) => {
    if (sort.key === 'createdAt') {
      // compareKey already encodes direction + batch_number tie-break via compareNewestCreatedThenCode.
      return compareKey(a, b, 'createdAt', sort.direction)
    }
    let result = compareKey(a, b, sort.key, sort.direction)
    if (sort.key === 'paymentDate') {
      // cmpNullableDate already encodes direction for empties; only flip non-empty order.
      const aEmpty = !(a.paymentDate ?? '').trim()
      const bEmpty = !(b.paymentDate ?? '').trim()
      if (!aEmpty && !bEmpty) result *= dir
    } else {
      result *= dir
    }
    if (result !== 0) return result
    return compareNewestCreatedThenCode(a.createdAt, b.createdAt, a.batchNumber, b.batchNumber)
  })
  return copy
}

export interface ProducerPaymentFilterInput {
  search?: string
  statusFilter?: string
  producerFilter?: string
  /** ISO date or timestamptz used for year/range matching (Financials uses createdAt). */
  matchesYearAndRange: (dateValue: string | null | undefined) => boolean
}

const ALL = 'all'

/** Same filter Financials applies before sorting Producer Payments. */
export function filterProducerPaymentBatches<T extends ProducerPaymentSortableRow>(
  rows: T[],
  input: ProducerPaymentFilterInput,
): T[] {
  const query = (input.search ?? '').trim().toLowerCase()
  const statusFilter = input.statusFilter ?? ALL
  const producerFilter = input.producerFilter ?? ALL
  return rows.filter((row) => {
    if (statusFilter !== ALL && row.status !== statusFilter) return false
    if (producerFilter !== ALL && row.producer !== producerFilter) return false
    // Year/range must use createdAt — paymentDate is NULL for unpaid/newest drafts.
    if (!input.matchesYearAndRange(row.createdAt)) return false
    if (!query) return true
    return (
      row.batchNumber.toLowerCase().includes(query) ||
      row.producer.toLowerCase().includes(query) ||
      (row.paymentReference ?? '').toLowerCase().includes(query)
    )
  })
}

/**
 * Financials Producer Payments tbody pipeline: filter → sort.
 * Call with rows already mapped (including mapCreatedAtValue on created_at).
 */
export function buildProducerPaymentRenderedRows<T extends ProducerPaymentSortableRow>(
  mappedRows: T[],
  options?: {
    filter?: ProducerPaymentFilterInput
    sort?: ProducerPaymentSort
  },
): { filtered: T[]; sorted: T[] } {
  const filtered = options?.filter
    ? filterProducerPaymentBatches(mappedRows, options.filter)
    : mappedRows
  const sorted = sortProducerPaymentBatches(
    filtered,
    options?.sort ?? DEFAULT_PRODUCER_PAYMENT_SORT,
  )
  return { filtered, sorted }
}

/** Map DB created_at onto sortable string (never null/undefined). */
export function mapProducerPaymentCreatedAt(value: unknown): string {
  return mapCreatedAtValue(value)
}
