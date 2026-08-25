/** Transactions browse-table pipeline: filter already applied → sort → paginate. */

import { compareNewestCreatedThenCode } from './createdFirstSort'
import { sortRows, type TableSortState } from './tableSort'

export type TransactionTableSortKey =
  | 'createdAt'
  | 'clientName'
  | 'policyEffectiveDate'
  | 'amount'
  | 'agencyCommission'
  | 'producer'
  | 'workflow'

export const TRANSACTION_TABLE_SORT_KEYS: readonly TransactionTableSortKey[] = [
  'createdAt',
  'clientName',
  'policyEffectiveDate',
  'amount',
  'agencyCommission',
  'producer',
  'workflow',
] as const

export const DEFAULT_TRANSACTION_TABLE_SORT: TableSortState<TransactionTableSortKey> = {
  key: 'createdAt',
  direction: 'desc',
}

export const TRANSACTION_PAGE_SIZE = 10

export interface TransactionTableRow {
  createdAt: string
  transactionNumber: string
  transactionDate: string
  clientName: string
  policyEffectiveDate: string
  amount: number
  agencyCommissionAmount: number
  producer: string
}

const SORT_TYPES: Partial<Record<TransactionTableSortKey, 'string' | 'number' | 'date'>> = {
  createdAt: 'date',
  policyEffectiveDate: 'date',
  amount: 'number',
  agencyCommission: 'number',
}

export function transactionTableAccessors<T extends TransactionTableRow>(
  workflow: (row: T) => string,
) {
  return {
    createdAt: (tx: T) => tx.createdAt,
    clientName: (tx: T) => tx.clientName,
    policyEffectiveDate: (tx: T) => tx.policyEffectiveDate,
    amount: (tx: T) => tx.amount,
    agencyCommission: (tx: T) => tx.agencyCommissionAmount,
    producer: (tx: T) => tx.producer,
    workflow,
  }
}

/** Same sort the Transactions page feeds to the rendered <tbody>. */
export function sortTransactionTableRows<T extends TransactionTableRow>(
  rows: T[],
  sort: TableSortState<TransactionTableSortKey> = DEFAULT_TRANSACTION_TABLE_SORT,
  workflow: (row: T) => string = () => '',
): T[] {
  return sortRows(
    rows,
    sort,
    transactionTableAccessors(workflow),
    SORT_TYPES,
    (a, b) =>
      compareNewestCreatedThenCode(
        a.createdAt,
        b.createdAt,
        a.transactionNumber,
        b.transactionNumber,
      ),
  )
}

export function paginateTransactionTableRows<T>(
  rows: T[],
  page: number,
  pageSize: number = TRANSACTION_PAGE_SIZE,
) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * pageSize
  return {
    rows: rows.slice(start, start + pageSize),
    totalPages,
    currentPage,
    rangeStart: rows.length === 0 ? 0 : start + 1,
    rangeEnd: Math.min(currentPage * pageSize, rows.length),
  }
}

/** Raw mapped rows → sort → paginate. Filter is the caller's responsibility. */
export function buildTransactionsRenderedPage<T extends TransactionTableRow>(
  mappedRows: T[],
  options?: {
    filter?: (row: T) => boolean
    sort?: TableSortState<TransactionTableSortKey>
    page?: number
    pageSize?: number
    workflow?: (row: T) => string
  },
) {
  const filtered = options?.filter ? mappedRows.filter(options.filter) : mappedRows
  const sorted = sortTransactionTableRows(
    filtered,
    options?.sort ?? DEFAULT_TRANSACTION_TABLE_SORT,
    options?.workflow ?? (() => ''),
  )
  const page = paginateTransactionTableRows(
    sorted,
    options?.page ?? 1,
    options?.pageSize ?? TRANSACTION_PAGE_SIZE,
  )
  return { filtered, sorted, ...page }
}
