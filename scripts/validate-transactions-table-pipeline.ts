/**
 * Integration-level Transactions table pipeline (no network).
 * Mirrors the rendered tbody source: map → filter → sort → paginate.
 * Run: npx tsx scripts/validate-transactions-table-pipeline.ts
 */

import { mapCreatedAtValue } from '../src/lib/createdFirstSort.ts'
import { nextTableSort } from '../src/lib/tableSort.ts'
import {
  DEFAULT_TRANSACTION_TABLE_SORT,
  TRANSACTION_PAGE_SIZE,
  TRANSACTION_TABLE_SORT_KEYS,
  buildTransactionsRenderedPage,
  transactionTableAccessors,
  type TransactionTableRow,
} from '../src/lib/transactionsTable.ts'

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.error(`FAIL: ${message}`)
}

function mapLikeProduction(row: {
  created_at: string | null
  transaction_number: string
  transaction_date: string
  producer?: string
  amount?: number
  client?: string
  policy_effective?: string
}): TransactionTableRow {
  return {
    createdAt: mapCreatedAtValue(row.created_at),
    transactionNumber: row.transaction_number ?? '',
    transactionDate: row.transaction_date,
    clientName: row.client ?? 'Alpha',
    policyEffectiveDate: row.policy_effective ?? '2026-01-01',
    amount: row.amount ?? 100,
    agencyCommissionAmount: 10,
    producer: row.producer ?? 'Avery',
  }
}

const newestCreatedOldDate = 'TXN-2026-000201'
const olderCreatedNewDate = 'TXN-2026-000200'
const middleCreated = 'TXN-2026-000150'

const rawRows = [
  {
    created_at: '2026-01-10T10:00:00.000Z',
    transaction_number: olderCreatedNewDate,
    transaction_date: '2026-08-24',
    amount: 50,
    client: 'Alpha',
  },
  {
    created_at: '2026-08-20T10:00:00.000Z',
    transaction_number: middleCreated,
    transaction_date: '2026-08-20',
    amount: 75,
    client: 'Midtown',
  },
  {
    created_at: '2026-08-25T18:00:00.000Z',
    transaction_number: newestCreatedOldDate,
    transaction_date: '2024-02-01',
    amount: 25,
    client: 'Zulu Newest',
  },
  {
    created_at: null,
    transaction_number: 'TXN-2025-000001',
    transaction_date: '2026-12-31',
    amount: 999,
    client: 'Null Created',
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    created_at: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
    transaction_number: `TXN-2026-0000${String(10 + i).padStart(2, '0')}`,
    transaction_date: '2026-12-01',
    producer: i % 2 === 0 ? 'Avery' : 'Blake',
    amount: i + 1,
    client: `Client ${i}`,
  })),
]

console.log('Map created_at → createdAt')
{
  const mapped = rawRows.map(mapLikeProduction)
  const newest = mapped.find((tx) => tx.transactionNumber === newestCreatedOldDate)
  const missing = mapped.find((tx) => tx.transactionNumber === 'TXN-2025-000001')
  assert(newest?.createdAt === '2026-08-25T18:00:00.000Z', 'newest created_at is mapped onto createdAt')
  assert(newest?.transactionDate === '2024-02-01', 'newest row keeps older transaction_date')
  assert(missing?.createdAt === '', 'null created_at maps to empty string, not undefined')
  assert(
    mapped.every((tx) => typeof tx.createdAt === 'string'),
    'every mapped row has a string createdAt',
  )
}

console.log('Default pipeline: newest created_at renders first even with older transaction_date')
{
  const mapped = rawRows.map(mapLikeProduction)
  const page = buildTransactionsRenderedPage(mapped)
  assert(page.rows[0]?.transactionNumber === newestCreatedOldDate, 'page 1 row 1 is newest created')
  assert(page.rows[0]?.transactionDate === '2024-02-01', 'that row still has the older transaction_date')
  assert(
    page.sorted.findIndex((tx) => tx.transactionNumber === newestCreatedOldDate) === 0,
    'sorted array (pre-pagination) also has newest created first',
  )
  assert(
    page.sorted.findIndex((tx) => tx.transactionNumber === newestCreatedOldDate) <
      page.sorted.findIndex((tx) => tx.transactionNumber === olderCreatedNewDate),
    'newer created_at beats a later transaction_date',
  )
  assert(
    page.sorted.findIndex((tx) => tx.transactionNumber === 'TXN-2025-000001') >
      page.sorted.findIndex((tx) => tx.transactionNumber === newestCreatedOldDate),
    'null created_at does not push a valid newly-created row down',
  )
  assert(page.rows.length === TRANSACTION_PAGE_SIZE, 'page size is 10')
  assert(
    !page.rows.some((tx) => tx.transactionNumber === 'TXN-2025-000001') ||
      page.sorted[0]?.transactionNumber === newestCreatedOldDate,
    'pagination did not steal the newest-created row from page 1',
  )

  console.log('First 10 rendered default-order rows (synthetic pipeline):')
  for (const [i, tx] of page.rows.entries()) {
    console.log(
      `  ${i + 1}. ${tx.transactionNumber}  created_at=${tx.createdAt || '(null)'}  transaction_date=${tx.transactionDate}`,
    )
  }
}

console.log('Filter → sort → paginate uses the filtered array, not the raw query order')
{
  const mapped = rawRows.map(mapLikeProduction)
  const page = buildTransactionsRenderedPage(mapped, {
    filter: (tx) => tx.producer === 'Avery',
  })
  assert(
    page.filtered.every((tx) => tx.producer === 'Avery'),
    'filter applied before sort',
  )
  assert(page.sorted[0]?.transactionNumber === newestCreatedOldDate, 'filtered default still newest created')
  assert(
    page.sorted.every((tx) => tx.producer === 'Avery'),
    'sort does not reintroduce filtered-out producers',
  )
}

console.log('SortableTh keys match table accessors')
{
  const accessors = transactionTableAccessors(() => 'Ready')
  for (const key of TRANSACTION_TABLE_SORT_KEYS) {
    assert(typeof accessors[key] === 'function', `SortableTh key ${key} has an accessor`)
  }
  assert(!('actions' in accessors), 'Actions is not a sort key')
  assert(
    DEFAULT_TRANSACTION_TABLE_SORT.key === 'createdAt' &&
      DEFAULT_TRANSACTION_TABLE_SORT.direction === 'desc',
    'default SortableTh state is createdAt DESC',
  )
}

console.log('Header click changes the final rendered row order')
{
  const mapped = rawRows.map(mapLikeProduction)
  const before = buildTransactionsRenderedPage(mapped)
  const afterClick = nextTableSort(DEFAULT_TRANSACTION_TABLE_SORT, 'clientName')
  const after = buildTransactionsRenderedPage(mapped, { sort: afterClick })
  assert(afterClick.key === 'clientName' && afterClick.direction === 'asc', 'first Client click is ASC')
  assert(
    after.rows[0]?.transactionNumber !== before.rows[0]?.transactionNumber,
    'clicking Client/Policy changes page 1 row 1',
  )
  assert(after.sorted[0]?.clientName === 'Alpha', 'Client ASC puts Alpha first')
  console.log(
    `Before click: ${before.rows[0]?.transactionNumber}  After Client ASC: ${after.rows[0]?.transactionNumber} (${after.rows[0]?.clientName})`,
  )

  const amountSort = nextTableSort(DEFAULT_TRANSACTION_TABLE_SORT, 'amount')
  const byAmount = buildTransactionsRenderedPage(mapped, { sort: amountSort })
  assert(amountSort.key === 'amount' && amountSort.direction === 'asc', 'first Amount click is ASC')
  assert(byAmount.sorted[0]?.amount === 1, 'Amount ASC uses the numeric accessor, not labels')
}

console.log('Postgres-style created_at still sorts by actual timestamp')
{
  const mapped = [
    {
      created_at: '2026-08-25 12:00:00+00',
      transaction_number: 'TXN-SPACE-NOON',
      transaction_date: '2020-01-01',
    },
    {
      created_at: '2026-08-25T00:00:00.000Z',
      transaction_number: 'TXN-ISO-MIDNIGHT',
      transaction_date: '2026-08-28',
    },
  ].map(mapLikeProduction)
  const page = buildTransactionsRenderedPage(mapped)
  assert(
    page.sorted[0]?.transactionNumber === 'TXN-SPACE-NOON',
    'space-separated noon timestamptz ranks after ISO midnight the same day (Date.parse, not localeCompare)',
  )
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
