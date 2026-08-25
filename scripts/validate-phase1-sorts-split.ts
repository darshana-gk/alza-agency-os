/**
 * Phase 1 consolidation checks (no network).
 * Run: npx tsx scripts/validate-phase1-sorts-split.ts
 */

import {
  compareNewestCreatedThenCode,
  sortNewestCreatedThenCode,
} from '../src/lib/createdFirstSort.ts'
import {
  DEFAULT_PRODUCER_PAYMENT_SORT,
  nextProducerPaymentSort,
  sortProducerPaymentBatches,
  type ProducerPaymentSortableRow,
} from '../src/lib/producerPaymentTable.ts'
import {
  PRODUCER_SPLIT_REQUIRED_MESSAGE,
  validateProducerSplitPercentage,
} from '../src/lib/producerSplitValidation.ts'

const PAGE_SIZE = 10

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

function assertEq<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`)
}

const batches: ProducerPaymentSortableRow[] = [
  {
    createdAt: '2026-01-10T10:00:00.000Z',
    batchNumber: 'PPB-2026-000012',
    producer: 'Avery',
    paymentDate: '2026-08-20',
    grossCommission: 100,
    netPayment: 90,
    status: 'paid',
    paymentMethod: 'ach',
  },
  {
    createdAt: '2026-03-15T10:00:00.000Z',
    batchNumber: 'PPB-2026-000013',
    producer: 'Avery',
    paymentDate: '2026-08-22',
    grossCommission: 100,
    netPayment: 90,
    status: 'paid',
    paymentMethod: 'ach',
  },
  {
    createdAt: '2026-06-01T10:00:00.000Z',
    batchNumber: 'PPB-2026-000014',
    producer: 'Blake',
    paymentDate: '2026-08-24',
    grossCommission: 100,
    netPayment: 90,
    status: 'paid',
    paymentMethod: 'check',
  },
  {
    createdAt: '2025-12-01T10:00:00.000Z',
    batchNumber: 'PPB-2026-000010',
    producer: 'Casey',
    paymentDate: null,
    grossCommission: 50,
    netPayment: 50,
    status: 'draft',
    paymentMethod: '',
  },
  {
    createdAt: '2026-08-24T18:00:00.000Z',
    batchNumber: 'PPB-2026-000015',
    producer: 'Avery',
    paymentDate: null,
    grossCommission: 75,
    netPayment: 75,
    status: 'draft',
    paymentMethod: '',
  },
  {
    createdAt: '2026-08-24T18:00:00.000Z',
    batchNumber: 'PPB-2026-000016',
    producer: 'Avery',
    paymentDate: null,
    grossCommission: 10,
    netPayment: 10,
    status: 'draft',
    paymentMethod: '',
  },
]

console.log('Producer Payments default + Payment Date nulls + tie-break')
{
  assertEq(DEFAULT_PRODUCER_PAYMENT_SORT.key, 'createdAt', 'default sort key is createdAt')
  assertEq(DEFAULT_PRODUCER_PAYMENT_SORT.direction, 'desc', 'default sort direction is desc')

  const sorted = sortProducerPaymentBatches(batches)
  assertEq(sorted[0]?.batchNumber, 'PPB-2026-000016', '1-6: same created_at ties on batch_number DESC')
  assertEq(sorted[1]?.batchNumber, 'PPB-2026-000015', '3: newest draft with null payment_date is at top group')
  assert(
    sorted.findIndex((b) => b.batchNumber === 'PPB-2026-000015') <
      sorted.findIndex((b) => b.status === 'paid'),
    'newest null-date draft appears above historical paid batches',
  )

  const asc = sortProducerPaymentBatches(batches, { key: 'paymentDate', direction: 'asc' })
  assert(
    asc.slice(0, 3).every((b) => !b.paymentDate) && asc.slice(3).every((b) => Boolean(b.paymentDate)),
    '4: Payment Date ASC puts null dates first',
  )

  const desc = sortProducerPaymentBatches(batches, { key: 'paymentDate', direction: 'desc' })
  assert(
    desc.slice(0, 3).every((b) => Boolean(b.paymentDate)) &&
      desc.slice(3).every((b) => !b.paymentDate),
    '5: Payment Date DESC puts null dates last',
  )
  assertEq(desc[0]?.batchNumber, 'PPB-2026-000014', 'DESC: latest real payment date first')

  const firstClick = nextProducerPaymentSort(DEFAULT_PRODUCER_PAYMENT_SORT, 'paymentDate')
  assertEq(firstClick.key, 'paymentDate', 'Payment Date remains explicitly sortable')
  assertEq(firstClick.direction, 'asc', 'first Payment Date click is ASC')
}

console.log('Transactions created_at then transaction_number; filter → sort → paginate')
{
  const txns = [
    {
      createdAt: '2026-08-01T10:00:00.000Z',
      transactionNumber: 'TXN-2026-000099',
      transactionDate: '2026-08-24',
      producer: 'Avery',
    },
    {
      createdAt: '2026-08-24T19:00:00.000Z',
      transactionNumber: 'TXN-2026-000100',
      transactionDate: '2026-01-01',
      producer: 'Avery',
    },
    {
      createdAt: '2026-08-24T19:00:00.000Z',
      transactionNumber: 'TXN-2026-000101',
      transactionDate: '2026-02-01',
      producer: 'Blake',
    },
  ]
  const sorted = sortNewestCreatedThenCode(
    txns,
    (t) => t.createdAt,
    (t) => t.transactionNumber,
  )
  assertEq(sorted[0]?.transactionNumber, 'TXN-2026-000101', '7/8: newest created_at, then number DESC')
  assertEq(sorted[1]?.transactionNumber, 'TXN-2026-000100', '8: same created_at ties on transaction_number DESC')
  assert(
    sorted[0]?.transactionDate === '2026-02-01',
    '9: older transaction_date does not push a newly created record down',
  )
  assertEq(
    compareNewestCreatedThenCode(
      '2026-08-24T19:00:00.000Z',
      '2026-08-01T10:00:00.000Z',
      'TXN-OLD',
      'TXN-NEW-DATE',
    ) < 0,
    true,
    '9: created_at beats transaction_date identity',
  )

  const extras = Array.from({ length: 12 }, (_, i) => ({
    createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
    transactionNumber: `TXN-2026-0000${String(10 + i).padStart(2, '0')}`,
    transactionDate: '2026-12-31',
    producer: 'Avery',
  }))
  const all = [...txns, ...extras]
  const filtered = all.filter((t) => t.producer === 'Avery')
  const sortedFiltered = sortNewestCreatedThenCode(
    filtered,
    (t) => t.createdAt,
    (t) => t.transactionNumber,
  )
  assert(
    sortedFiltered.every((t) => t.producer === 'Avery'),
    '10: filter applied before sort',
  )
  const page1 = sortedFiltered.slice(0, PAGE_SIZE)
  const page2 = sortedFiltered.slice(PAGE_SIZE, PAGE_SIZE * 2)
  assertEq(page1[0]?.transactionNumber, 'TXN-2026-000100', '10: pagination keeps newest filtered row on page 1')
  assert(page2.length > 0, '10: remaining filtered rows land on later pages')
  assert(
    !page2.some((t) => t.transactionNumber === 'TXN-2026-000100'),
    '10: newest filtered row is not pushed onto page 2',
  )
}

console.log('Producer Split validation')
{
  const invalid: Array<string | number | null | undefined> = [
    '',
    '   ',
    '100.01',
    '101',
    '-1',
    'abc',
    null,
    undefined,
  ]
  const valid = ['0', '0.01', '50', '100', 0, 0.01, 50, 100]

  assertEq(validateProducerSplitPercentage(''), PRODUCER_SPLIT_REQUIRED_MESSAGE, '11: blank invalid')
  assertEq(validateProducerSplitPercentage('   '), PRODUCER_SPLIT_REQUIRED_MESSAGE, '12: whitespace invalid')
  assertEq(validateProducerSplitPercentage('0'), null, '13: 0 valid')
  assertEq(validateProducerSplitPercentage('0.01'), null, '14: 0.01 valid')
  assertEq(validateProducerSplitPercentage('50'), null, '15: 50 valid')
  assertEq(validateProducerSplitPercentage('100'), null, '16: 100 valid')
  assertEq(validateProducerSplitPercentage('100.01'), PRODUCER_SPLIT_REQUIRED_MESSAGE, '17: 100.01 invalid')
  assertEq(validateProducerSplitPercentage('101'), PRODUCER_SPLIT_REQUIRED_MESSAGE, '18: 101 invalid')
  assertEq(validateProducerSplitPercentage('-1'), PRODUCER_SPLIT_REQUIRED_MESSAGE, '19: -1 invalid')
  assertEq(validateProducerSplitPercentage('abc'), PRODUCER_SPLIT_REQUIRED_MESSAGE, '20: nonnumeric invalid')

  for (const v of valid) {
    assert(validateProducerSplitPercentage(v) === null, `valid case ${JSON.stringify(v)}`)
  }
  for (const v of invalid) {
    assert(validateProducerSplitPercentage(v) === PRODUCER_SPLIT_REQUIRED_MESSAGE, `invalid case ${JSON.stringify(v)}`)
  }

  assert(
    validateProducerSplitPercentage('') !== null && validateProducerSplitPercentage(0) === null,
    'blank is not coerced to valid 0',
  )
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
