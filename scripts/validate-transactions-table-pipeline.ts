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
import {
  buildTransactionsPageKpis,
  deriveCommission,
  isOperationallyPendingTransaction,
  missingColumnNameFromError,
} from '../src/lib/commission.ts'
import {
  isPolicyTermUpdatingType,
  resolvePersistedTransactionDates,
  transactionDateSemantics,
  validateTransactionDateInputs,
} from '../src/lib/transactionDateSemantics.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

console.log('Transactions page KPIs exclude voided from amount totals, keep history count')
{
  const kpis = buildTransactionsPageKpis([
    {
      amount: 100,
      type: 'new_policy_premium',
      archived: false,
      voidedAt: null,
      producerPaymentStatus: 'not_ready',
      paidDate: null,
    },
    {
      amount: 814,
      type: 'new_policy_premium',
      archived: false,
      voidedAt: null,
      producerPaymentStatus: 'ready',
      paidDate: null,
    },
    {
      amount: 99999,
      type: 'new_policy_premium',
      archived: false,
      voidedAt: '2026-08-31T05:16:04.230482+00',
      producerPaymentStatus: 'not_ready',
      paidDate: null,
    },
    {
      amount: -200,
      type: 'cancellation_premium',
      archived: false,
      voidedAt: '2026-08-31T00:00:00.000Z',
      producerPaymentStatus: 'not_ready',
      paidDate: null,
    },
  ])
  assert(kpis.total === 4, 'Total Transactions counts visible history including voided')
  assert(kpis.netVolume === 914, 'Net Premium Volume is live $914 not $100,713')
  assert(kpis.returnPremiumTotal === 0, 'voided cancellation is not a live Return Premium')
  assert(kpis.pendingCount === 2, 'Pending is 2 live unpaid, not 4')
  assert(
    !isOperationallyPendingTransaction({
      archived: false,
      voidedAt: '2026-08-31T05:16:04.230482+00',
      producerPaymentStatus: 'not_ready',
    }),
    '2AG-B-TRX-VOIDED would not be pending even with not_ready status',
  )
}

console.log('Transaction-type date matrix')
{
  const nb = transactionDateSemantics('new_policy_premium')
  const renewal = transactionDateSemantics('renewal_premium')
  const endo = transactionDateSemantics('endorsement_premium')
  const audit = transactionDateSemantics('audit_premium')
  const cancel = transactionDateSemantics('cancellation_premium')
  const legacy = transactionDateSemantics('return_premium')
  assert(nb.policyTerm === 'editable_required' && nb.updatesPolicyTerm, 'NB policy term editable and persisted')
  assert(nb.snapshotTxnDatesFromPolicyTerm && !nb.showTxnEffective, 'NB does not require a second date pair')
  assert(renewal.policyEffectiveLabel === 'New Policy Effective Date', 'Renewal labels the new term')
  assert(renewal.updatesPolicyTerm && renewal.snapshotTxnDatesFromPolicyTerm, 'Renewal updates policy term')
  assert(endo.policyTerm === 'read_only' && !endo.updatesPolicyTerm, 'Endorsement does not change policy term')
  assert(endo.showTxnEffective && endo.txnEffectiveRequired, 'Endorsement requires transaction effective date')
  assert(audit.policyTerm === 'read_only' && !audit.updatesPolicyTerm, 'Audit does not change policy term')
  assert(audit.showTxnEffective && audit.showTxnExpiration && !audit.txnEffectiveRequired, 'Audit dates optional')
  assert(cancel.policyTerm === 'read_only' && !cancel.updatesPolicyTerm, 'Cancellation does not overwrite policy term')
  assert(cancel.txnEffectiveLabel === 'Cancellation Effective Date', 'Cancellation captures txn-level effective date')
  assert(legacy.policyTerm === 'read_only' && !legacy.updatesPolicyTerm, 'Legacy return premium does not change term')
  assert(isPolicyTermUpdatingType('new_policy_premium') && isPolicyTermUpdatingType('renewal_premium'), 'term-updating types')
  assert(!isPolicyTermUpdatingType('endorsement_premium') && !isPolicyTermUpdatingType('cancellation_premium'), 'non-term types')
  assert(
    validateTransactionDateInputs({
      type: 'new_policy_premium',
      policyEffectiveDate: '',
      policyExpirationDate: '2027-08-31',
      transactionEffectiveDate: '',
      transactionExpirationDate: '',
    })?.includes('required'),
    'NB requires policy effective date',
  )
  assert(
    validateTransactionDateInputs({
      type: 'new_policy_premium',
      policyEffectiveDate: '2026-08-31',
      policyExpirationDate: '2027-08-31',
      transactionEffectiveDate: '',
      transactionExpirationDate: '',
    }) === null,
    'NB valid term',
  )
  const snap = resolvePersistedTransactionDates({
    type: 'new_policy_premium',
    policyEffectiveDate: '2026-08-31',
    policyExpirationDate: '2027-08-31',
    transactionEffectiveDate: '1999-01-01',
    transactionExpirationDate: '1999-12-31',
  })
  assert(snap.transactionEffectiveDate === '2026-08-31', 'NB snapshots policy effective, not a second entry')
  assert(snap.transactionExpirationDate === '2027-08-31', 'NB snapshots policy expiration')
}

console.log('UAT BUG 005 commission math')
{
  const derived = deriveCommission({
    commissionType: 'percentage',
    baseAmount: 1000,
    agencyCommissionPercentage: 10,
    agencyCommissionAmount: null,
    brokerFee: 100,
    producerSplitPercentage: 50,
  })
  assert(derived.agencyCommissionAmount === 100, '10% of $1000 = $100')
  assert(derived.brokerFee === 100, 'broker fee $100')
  assert(derived.commissionPool === 200, 'pool $200')
  assert(derived.producerCommissionAmount === 100, '50% of pool = $100')
  assert(derived.agencyNetCommission === 100, 'agency net $100')
}

console.log('Insert schema-cache error parser + createTransaction compat')
{
  assert(
    missingColumnNameFromError({
      code: 'PGRST204',
      message: "Could not find the 'agency_commission_percentage' column of 'transactions' in the schema cache",
    }) === 'agency_commission_percentage',
    'parses PostgREST schema-cache missing column',
  )
  assert(
    missingColumnNameFromError({
      code: '42703',
      message: 'column transactions.description does not exist',
    }) === 'description',
    'parses table-qualified missing column',
  )
  const commissionSrc = readFileSync(resolve('src/lib/commission.ts'), 'utf8')
  assert(commissionSrc.includes('insertTransactionCompat'), 'create path retries missing insert columns')
  assert(commissionSrc.includes('isPolicyTermUpdatingType'), 'create path updates policy term only for NB/Renewal')
  assert(commissionSrc.includes("update({ archived_at:"), 'failed policy-term update archives the new transaction')
  const modalSrc = readFileSync(resolve('src/components/transactions/AddTransactionModal.tsx'), 'utf8')
  assert(modalSrc.includes('transactionDateSemantics'), 'Add Transaction uses the date matrix')
  assert(modalSrc.includes('policyEffectiveDate'), 'Add Transaction can edit policy term for NB/Renewal')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
