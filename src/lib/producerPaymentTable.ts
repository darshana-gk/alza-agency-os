/** Client-side Producer Payments table sort. Uses underlying values, not labels. */

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
      return cmpString(a.createdAt, b.createdAt)
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
    const created = cmpString(a.createdAt, b.createdAt)
    if (created !== 0) return -created
    return -cmpString(a.batchNumber, b.batchNumber)
  })
  return copy
}
