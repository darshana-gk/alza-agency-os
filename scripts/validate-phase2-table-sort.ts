/**
 * Phase 2 table-sort helper checks (no network).
 * Run: npx tsx scripts/validate-phase2-table-sort.ts
 */

import { compareNewestCreatedThenCode, sortNewestCreatedThenCode } from '../src/lib/createdFirstSort.ts'
import {
  DEFAULT_PRODUCER_PAYMENT_SORT,
  sortProducerPaymentBatches,
} from '../src/lib/producerPaymentTable.ts'
import {
  DIRECTORY_NAME_SORT,
  compareIsoDate,
  compareNumber,
  compareSortValues,
  nextTableSort,
  sortRows,
  type TableSortState,
} from '../src/lib/tableSort.ts'

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

console.log('Directory name ASC default')
{
  assert(DIRECTORY_NAME_SORT.key === 'name' && DIRECTORY_NAME_SORT.direction === 'asc', 'name ASC directory default')
  const rows = [
    { name: 'Zulu Agency' },
    { name: 'Alpha Agency' },
    { name: 'midtown' },
  ]
  const sorted = sortRows(rows, DIRECTORY_NAME_SORT, { name: (r) => r.name })
  assertEqNames(sorted.map((r) => r.name), ['Alpha Agency', 'midtown', 'Zulu Agency'], 'name ASC is case-insensitive')
}

console.log('Numeric ASC/DESC')
{
  const rows = [{ n: 10 }, { n: 2 }, { n: 30 }]
  const asc = sortRows(rows, { key: 'n', direction: 'asc' }, { n: (r) => r.n }, { n: 'number' })
  const desc = sortRows(rows, { key: 'n', direction: 'desc' }, { n: (r) => r.n }, { n: 'number' })
  assert(asc.map((r) => r.n).join(',') === '2,10,30', 'numeric ASC')
  assert(desc.map((r) => r.n).join(',') === '30,10,2', 'numeric DESC')
  assert(compareNumber(2, 10) < 0, 'compareNumber 2 < 10')
}

console.log('ISO date ASC/DESC + nullable date rules')
{
  assert(compareIsoDate('2026-01-01', '2026-08-01', 'asc') < 0, 'ISO date ASC')
  assert(compareIsoDate('2026-08-01', '2026-01-01', 'desc') < 0, 'ISO date DESC newest first when desc')
  assert(compareIsoDate(null, '2026-01-01', 'asc') < 0, 'nullable date ASC: null first')
  assert(compareIsoDate(null, '2026-01-01', 'desc') > 0, 'nullable date DESC: null last')
  assert(compareSortValues(null, '2026-01-01', 'asc', 'date') < 0, 'compareSortValues date ASC null first')
  assert(compareSortValues(null, '2026-01-01', 'desc', 'date') > 0, 'compareSortValues date DESC null last')
}

console.log('Filter → sort → paginate')
{
  const rows = [
    { name: 'Avery', amount: 3 },
    { name: 'Blake', amount: 1 },
    { name: 'Avery', amount: 2 },
    { name: 'Casey', amount: 9 },
    { name: 'Avery', amount: 8 },
  ]
  const filtered = rows.filter((r) => r.name === 'Avery')
  const sorted = sortRows(filtered, { key: 'amount', direction: 'asc' }, { amount: (r) => r.amount }, { amount: 'number' })
  const page1 = sorted.slice(0, 2)
  assert(filtered.every((r) => r.name === 'Avery'), 'filter before sort')
  assert(page1.map((r) => r.amount).join(',') === '2,3', 'paginate after sort')
}

console.log('Actions column cannot trigger sorting')
{
  const sortableKeys = ['name', 'email', 'status'] as const
  type UserSortKey = (typeof sortableKeys)[number]
  const accessors: Record<UserSortKey, (row: { name: string }) => string> = {
    name: (r) => r.name,
    email: (r) => r.name,
    status: (r) => r.name,
  }
  assert(!('actions' in accessors), 'Actions is not a sortable accessor')
  assert(!(sortableKeys as readonly string[]).includes('actions'), 'Actions is not a sort key')
  const current: TableSortState<UserSortKey> = { key: 'name', direction: 'asc' }
  const next = nextTableSort(current, 'email')
  assert(next.key === 'email' && next.direction === 'asc', 'first click on a new column is ASC')
  const toggled = nextTableSort(next, 'email')
  assert(toggled.direction === 'desc', 'second click is DESC')
}

console.log('Phase 1 transaction/payment defaults unchanged')
{
  assert(DEFAULT_PRODUCER_PAYMENT_SORT.key === 'createdAt', 'payments default createdAt')
  assert(DEFAULT_PRODUCER_PAYMENT_SORT.direction === 'desc', 'payments default desc')
  const batches = [
    {
      createdAt: '2026-08-24T18:00:00.000Z',
      batchNumber: 'PPB-2026-000015',
      producer: 'Avery',
      paymentDate: null,
      grossCommission: 1,
      netPayment: 1,
      status: 'draft',
      paymentMethod: '',
    },
    {
      createdAt: '2026-01-10T10:00:00.000Z',
      batchNumber: 'PPB-2026-000012',
      producer: 'Avery',
      paymentDate: '2026-08-20',
      grossCommission: 1,
      netPayment: 1,
      status: 'paid',
      paymentMethod: 'ach',
    },
  ]
  const sorted = sortProducerPaymentBatches(batches)
  assert(sorted[0]?.batchNumber === 'PPB-2026-000015', 'newest created draft still first')

  const txns = [
    { createdAt: '2026-08-01T10:00:00.000Z', transactionNumber: 'TXN-2026-000099' },
    { createdAt: '2026-08-24T19:00:00.000Z', transactionNumber: 'TXN-2026-000100' },
    { createdAt: '2026-08-24T19:00:00.000Z', transactionNumber: 'TXN-2026-000101' },
  ]
  const txnSorted = sortNewestCreatedThenCode(
    txns,
    (t) => t.createdAt,
    (t) => t.transactionNumber,
  )
  assert(txnSorted[0]?.transactionNumber === 'TXN-2026-000101', 'transactions default created_at then number DESC')
  assert(
    compareNewestCreatedThenCode(
      '2026-08-24T19:00:00.000Z',
      '2026-08-01T10:00:00.000Z',
      'A',
      'B',
    ) < 0,
    'newer created_at still wins',
  )
}

function assertEqNames(actual: string[], expected: string[], message: string) {
  assert(actual.join('|') === expected.join('|'), `${message} (got ${actual.join(', ')})`)
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
