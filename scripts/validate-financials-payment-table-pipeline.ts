/**
 * Financials Producer Payments table pipeline (no network).
 * Mirrors: mapBatch → filter → sort → tbody (filteredBatches).
 * Run: npx tsx scripts/validate-financials-payment-table-pipeline.ts
 */

import { mapCreatedAtValue } from '../src/lib/createdFirstSort.ts'
import {
  DEFAULT_PRODUCER_PAYMENT_SORT,
  buildProducerPaymentRenderedRows,
  isProducerPaymentHeaderActive,
  mapProducerPaymentCreatedAt,
  nextProducerPaymentSort,
  producerPaymentHeaderDirection,
  type ProducerPaymentSortableRow,
} from '../src/lib/producerPaymentTable.ts'

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

function mapLikeFinancials(row: {
  created_at: string | null
  batch_number: string
  producer?: string
  payment_date: string | null
  gross_commission?: number
  net_payment?: number
  status?: string
  payment_method?: string | null
  payment_reference?: string | null
}): ProducerPaymentSortableRow {
  return {
    createdAt: mapProducerPaymentCreatedAt(row.created_at),
    batchNumber: row.batch_number?.trim() || '—',
    producer: row.producer?.trim() || '—',
    paymentDate: row.payment_date,
    grossCommission: row.gross_commission ?? 1,
    netPayment: row.net_payment ?? 1,
    status: row.status ?? 'draft',
    paymentMethod: row.payment_method?.trim() || '—',
    paymentReference: row.payment_reference?.trim() || '—',
  }
}

/**
 * Server order before Phase-1 harden: payment_date DESC, nulls last.
 * This is exactly the Preview failure ordering.
 */
const serverOrderedRaw = [
  {
    created_at: '2026-08-10T10:00:00.000Z',
    batch_number: 'PPB-2026-000014',
    producer: 'Avery',
    payment_date: '2026-08-24',
    status: 'paid',
    payment_method: 'ach',
  },
  {
    created_at: '2026-08-09T10:00:00.000Z',
    batch_number: 'PPB-2026-000013',
    producer: 'Avery',
    payment_date: '2026-08-22',
    status: 'paid',
    payment_method: 'ach',
  },
  {
    created_at: '2026-07-01T10:00:00.000Z',
    batch_number: 'PPB-2026-000004',
    producer: 'Avery',
    payment_date: '2026-07-15',
    status: 'paid',
    payment_method: 'ach',
  },
  {
    created_at: '2026-08-25T18:00:00.000Z',
    batch_number: 'PPB-2026-000015',
    producer: 'Avery',
    payment_date: null,
    status: 'draft',
    payment_method: null,
  },
]

console.log('Map created_at → createdAt (never null)')
{
  assert(mapProducerPaymentCreatedAt(null) === '', 'null created_at → empty string')
  assert(mapProducerPaymentCreatedAt('2026-08-25T18:00:00.000Z') === '2026-08-25T18:00:00.000Z', 'iso preserved')
  assert(mapCreatedAtValue(null) === mapProducerPaymentCreatedAt(null), 'same helper as transactions')
  const mapped = serverOrderedRaw.map(mapLikeFinancials)
  assert(
    mapped.every((row) => typeof row.createdAt === 'string'),
    'every mapped row has string createdAt',
  )
}

console.log('Default Financials pipeline: PPB-2026-000015 renders first')
{
  const mapped = serverOrderedRaw.map(mapLikeFinancials)
  assert(
    mapped.map((r) => r.batchNumber).join(',') ===
      'PPB-2026-000014,PPB-2026-000013,PPB-2026-000004,PPB-2026-000015',
    'input reproduces server payment_date DESC nulls-last order',
  )

  const { sorted } = buildProducerPaymentRenderedRows(mapped, {
    filter: {
      search: '',
      statusFilter: 'all',
      producerFilter: 'all',
      matchesYearAndRange: () => true,
    },
    sort: DEFAULT_PRODUCER_PAYMENT_SORT,
  })

  assert(sorted[0]?.batchNumber === 'PPB-2026-000015', 'rendered first row is PPB-2026-000015')
  assert(sorted[0]?.paymentDate === null, 'first row still has payment_date NULL')
  assert(
    sorted.map((r) => r.batchNumber).join(',') ===
      'PPB-2026-000015,PPB-2026-000014,PPB-2026-000013,PPB-2026-000004',
    'full default order is created_at DESC then batch_number',
  )
  console.log('  rendered:', sorted.map((r) => r.batchNumber).join(' → '))
}

console.log('Year filter uses createdAt (not paymentDate) so unpaid drafts stay visible')
{
  const mapped = serverOrderedRaw.map(mapLikeFinancials)
  const { sorted } = buildProducerPaymentRenderedRows(mapped, {
    filter: {
      matchesYearAndRange: (value) => (value ?? '').slice(0, 4) === '2026',
    },
  })
  assert(
    sorted.some((r) => r.batchNumber === 'PPB-2026-000015'),
    'PPB-2026-000015 with null payment_date still passes year=2026 via createdAt',
  )
  assert(sorted[0]?.batchNumber === 'PPB-2026-000015', 'year-filtered default still newest created first')
}

console.log('Payment Date click: ASC nulls first, DESC nulls last')
{
  const mapped = serverOrderedRaw.map(mapLikeFinancials)
  const ascSort = nextProducerPaymentSort(DEFAULT_PRODUCER_PAYMENT_SORT, 'paymentDate')
  assert(ascSort.key === 'paymentDate' && ascSort.direction === 'asc', 'first Payment Date click is ASC')
  const asc = buildProducerPaymentRenderedRows(mapped, { sort: ascSort }).sorted
  assert(asc[0]?.batchNumber === 'PPB-2026-000015', 'Payment Date ASC → NULL first')
  assert(asc[0]?.paymentDate === null, 'first ASC row has null paymentDate')

  const descSort = nextProducerPaymentSort(ascSort, 'paymentDate')
  assert(descSort.key === 'paymentDate' && descSort.direction === 'desc', 'second click is DESC')
  const desc = buildProducerPaymentRenderedRows(mapped, { sort: descSort }).sorted
  assert(desc[desc.length - 1]?.batchNumber === 'PPB-2026-000015', 'Payment Date DESC → NULL last')
  assert(desc[0]?.paymentDate !== null, 'Payment Date DESC → real dates first')
}

console.log('Default header: Batch shows active createdAt DESC arrow')
{
  assert(
    isProducerPaymentHeaderActive(DEFAULT_PRODUCER_PAYMENT_SORT, 'batchNumber'),
    'Batch header active under default createdAt sort',
  )
  assert(
    !isProducerPaymentHeaderActive(DEFAULT_PRODUCER_PAYMENT_SORT, 'paymentDate'),
    'Payment Date not active by default',
  )
  assert(
    producerPaymentHeaderDirection(DEFAULT_PRODUCER_PAYMENT_SORT, 'batchNumber') === 'desc',
    'Batch shows DESC arrow for default createdAt',
  )
}

console.log('Postgres-style created_at still wins over older ISO rows')
{
  const mapped = [
    {
      created_at: '2026-08-10T10:00:00.000Z',
      batch_number: 'PPB-2026-000014',
      payment_date: '2026-08-24',
      status: 'paid',
    },
    {
      created_at: '2026-08-25 18:00:00+00',
      batch_number: 'PPB-2026-000015',
      payment_date: null,
      status: 'draft',
    },
  ].map(mapLikeFinancials)
  const { sorted } = buildProducerPaymentRenderedRows(mapped)
  assert(sorted[0]?.batchNumber === 'PPB-2026-000015', 'space timestamptz newest still first')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
