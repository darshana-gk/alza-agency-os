/**
 * Local validation for Producer Payment Batch V1 (no network, no migration apply).
 * Run: npx tsx scripts/validate-producer-payment-v1.ts
 *
 * Does not import src/lib/commission.ts (that module constructs a Supabase client).
 * Display/validation helpers below mirror the production functions and are
 * cross-checked against source so they cannot silently drift.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  formatPaymentChannelLabel,
  isProducerPayoutSchedule,
  nextPlannedPayoutDate,
  PAYOUT_SCHEDULE_DB_FIELDS,
  payoutScheduleIsPlanningOnly,
} from '../src/lib/producerPayoutSchedule.ts'

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

function readRepo(rel: string): string {
  return readFileSync(resolve(rel), 'utf8')
}

const CREATE_SQL = readRepo(
  'supabase/migrations/20260823150000_create_producer_payment_batch_auth_current_user_has_role.sql',
)
const CONFIRM_SQL = readRepo(
  'supabase/migrations/20260823140000_producer_payment_confirm_outside_alza_flow.sql',
)
const METHODS_SQL = readRepo('supabase/migrations/20260817223000_expand_producer_payment_methods.sql')
const COMMISSION_TS = readRepo('src/lib/commission.ts')
const PERMISSIONS_TS = readRepo('src/lib/permissions.ts')
const ACTIVITY_TS = readRepo('src/lib/activityPresentation.ts')
const AGENCY_TS = readRepo('src/lib/agency.ts')
const AGENCY_SETTINGS = readRepo('src/pages/admin/AgencySettings.tsx')
const FINANCIALS = readRepo('src/pages/Financials.tsx')
const SCHEDULE_TS = readRepo('src/lib/producerPayoutSchedule.ts')

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`)
  if (start < 0) return ''
  const next = source.indexOf('\nexport async function ', start + 1)
  return next < 0 ? source.slice(start) : source.slice(start, next)
}

const CONFIRM_CLIENT = functionBody(COMMISSION_TS, 'confirmProducerPaid')
const CREATE_CLIENT = functionBody(COMMISSION_TS, 'createProducerPaymentBatch')

const CONFIRM_METHODS = [
  { value: 'ach', label: 'ACH / Bank Transfer' },
  { value: 'check', label: 'Check' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'wire', label: 'Wire' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
] as const

function formatLabel(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatBatchStatusLabel(status: string | null | undefined, paymentChannel?: string | null): string {
  const normalized = (status ?? '').toLowerCase().trim()
  if (normalized === 'draft') return 'Ready to Pay'
  if (normalized === 'paid') {
    const channel = (paymentChannel ?? '').trim()
    if (channel === 'alza_flow_pay') return 'Paid via ALZA Flow Pay'
    if (channel === 'outside_alza_flow') return 'Paid Outside ALZA Flow'
    return 'Paid (Historical)'
  }
  if (!normalized) return 'Unknown'
  return formatLabel(normalized)
}

function formatProducerPaymentMethodLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw || raw === '—') return '—'
  const all = [
    ...CONFIRM_METHODS,
    { value: 'venmo', label: 'Venmo' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'wire', label: 'Wire' },
  ]
  const match = all.find((m) => m.value === raw)
  if (match) return match.label
  if (raw.toLowerCase() === 'manual') return 'Manual'
  if (raw.toLowerCase() === 'ach_bank_transfer') return 'ACH / Bank Transfer'
  return formatLabel(raw)
}

function isValidProducerPaymentConfirmMethod(value: string | null | undefined): boolean {
  return CONFIRM_METHODS.some((m) => m.value === (value ?? '').trim())
}

function validateConfirmPaidOutsideAlzaFlowInput(input: {
  paymentDate?: string | null
  paymentMethod?: string | null
  paymentReference?: string | null
  notes?: string | null
}): string | null {
  if (!(input.paymentDate ?? '').trim()) return 'Payment date is required.'
  if (!isValidProducerPaymentConfirmMethod(input.paymentMethod)) return 'Payment method is required.'
  return null
}

function getTransactionWorkflowStatus(tx: {
  archived: boolean
  producerPaymentStatus: string
  paidDate: string | null
  paymentBatchId: string | null
}): string {
  if (tx.archived) return 'Archived'
  if (tx.producerPaymentStatus === 'paid' || Boolean(tx.paidDate)) return 'Paid Outside ALZA Flow'
  if (tx.paymentBatchId) return 'Batch Created'
  if (tx.producerPaymentStatus === 'ready') return 'Ready for Payment'
  return 'Awaiting Receipt'
}

function canManageProducerPayments(role: string): boolean {
  return role === 'owner' || role === 'admin'
}

// ---------------------------------------------------------------------------
// A–G schedule
// ---------------------------------------------------------------------------
assert(isProducerPayoutSchedule('weekly'), 'A: weekly is a valid schedule')
assertEq(
  nextPlannedPayoutDate({ schedule: 'weekly', anchorDate: '2026-08-17', fromDate: '2026-08-23' }),
  '2026-08-24',
  'A: weekly next date uses anchor weekday (Mon) on/after fromDate',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'weekly', anchorDate: '2026-08-24', fromDate: '2026-08-24' }),
  '2026-08-24',
  'A: weekly includes today when it matches weekday',
)

assert(isProducerPayoutSchedule('biweekly'), 'B: biweekly is a valid schedule')
assertEq(
  nextPlannedPayoutDate({ schedule: 'biweekly', anchorDate: '2026-08-10', fromDate: '2026-08-23' }),
  '2026-08-24',
  'B: biweekly +14d from anchor until >= fromDate',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'biweekly', anchorDate: '2026-08-24', fromDate: '2026-08-10' }),
  '2026-08-24',
  'B: biweekly before anchor returns the anchor',
)

assert(isProducerPayoutSchedule('semi_monthly'), 'C: semi-monthly is a valid schedule')
assertEq(
  nextPlannedPayoutDate({ schedule: 'semi_monthly', fromDate: '2026-08-01' }),
  '2026-08-01',
  'C: semi-monthly on the 1st stays on the 1st',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'semi_monthly', fromDate: '2026-08-02' }),
  '2026-08-15',
  'C: semi-monthly between 2–15 returns the 15th',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'semi_monthly', fromDate: '2026-08-23' }),
  '2026-09-01',
  'C: semi-monthly after the 15th returns the 1st of next month',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'semi_monthly', fromDate: '2026-08-23', anchorDate: null }),
  '2026-09-01',
  'C: semi-monthly does not require an anchor date',
)

assert(isProducerPayoutSchedule('monthly'), 'D: monthly is a valid schedule')
assertEq(
  nextPlannedPayoutDate({ schedule: 'monthly', anchorDate: '2026-01-31', fromDate: '2026-08-23' }),
  '2026-08-31',
  'D: monthly clamps to end of month',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'monthly', anchorDate: '2026-08-10', fromDate: '2026-08-23' }),
  '2026-09-10',
  'D: monthly after the day-of-month rolls to next month',
)

assert(isProducerPayoutSchedule('custom'), 'E: custom is a valid schedule')
assertEq(
  nextPlannedPayoutDate({
    schedule: 'custom',
    anchorDate: '2026-08-01',
    fromDate: '2026-08-23',
  }),
  null,
  'E: custom schedule is notes-only and has no calculated next date',
)

assert(payoutScheduleIsPlanningOnly() === true, 'F: schedule helper is planning-only')
assert(
  PAYOUT_SCHEDULE_DB_FIELDS.every(
    (field) =>
      !field.includes('paid') &&
      !field.includes('batch') &&
      !field.includes('ready') &&
      !field.includes('confirm'),
  ),
  'F: schedule DB fields are not financial-status fields',
)
assert(
  !AGENCY_TS.includes('createProducerPaymentBatch') &&
    !AGENCY_TS.includes('confirmProducerPaid') &&
    !AGENCY_TS.includes('producer_payment_status') &&
    !AGENCY_SETTINGS.includes('createProducerPaymentBatch') &&
    !AGENCY_SETTINGS.includes('confirmProducerPaid') &&
    AGENCY_SETTINGS.includes('Planning only'),
  'F: schedule save path never creates batches or marks ready/paid',
)
assert(
  !SCHEDULE_TS.includes('supabase') && !SCHEDULE_TS.includes('producer_payment_batches'),
  'F: schedule calculator has no payment side effects',
)

assert(
  nextPlannedPayoutDate({ schedule: 'weekly', fromDate: '2026-08-23' }) === null,
  'G: weekly without anchor is not deterministically calculable',
)
assert(
  nextPlannedPayoutDate({ schedule: 'monthly', fromDate: '2026-08-23' }) === null,
  'G: monthly without anchor is not deterministically calculable',
)
assertEq(
  nextPlannedPayoutDate({ schedule: 'semi_monthly', fromDate: '2026-08-15' }),
  '2026-08-15',
  'G: next planned payout is calculable for semi-monthly without anchor',
)

// ---------------------------------------------------------------------------
// H–J, AC create batch never marks paid
// ---------------------------------------------------------------------------
assert(
  /INSERT INTO public\.producer_payment_batches[\s\S]*'draft'/.test(CREATE_SQL),
  'H: create RPC inserts batch as draft',
)
assert(
  CREATE_SQL.includes('SET payment_batch_id = v_batch_id') &&
    /producer_payment_status\s*=\s*'ready'/.test(CREATE_SQL) &&
    !/SET[\s\S]*producer_payment_status\s*=\s*'paid'/.test(CREATE_SQL),
  'I: create RPC links transactions while they remain ready (does not set paid)',
)
assert(
  CREATE_SQL.includes('t.paid_date IS NULL') &&
    /INSERT INTO public\.producer_payment_batches[\s\S]*NULL,\s*\n\s*NULL,\s*\n\s*NULL/.test(CREATE_SQL),
  'J: create RPC inserts paid_date NULL and requires linked txs unpaid',
)
assert(
  !CREATE_SQL.includes("producer_payment_status = 'paid'") &&
    !CREATE_SQL.includes("status = 'paid'") &&
    !/paid_date\s*=\s*p_/.test(CREATE_SQL) &&
    !/paid_date\s*=\s*now\s*\(/.test(CREATE_SQL),
  'AC: create batch SQL never marks the batch or transactions paid',
)
assert(
  CREATE_CLIENT.includes('create_producer_payment_batch_with_recoveries') &&
    !CREATE_CLIENT.includes("producer_payment_status: 'paid'"),
  'AC: client create wrapper does not mark paid itself',
)

// ---------------------------------------------------------------------------
// K–N confirmation modal validation
// ---------------------------------------------------------------------------
assertEq(
  validateConfirmPaidOutsideAlzaFlowInput({ paymentDate: '', paymentMethod: 'ach' }),
  'Payment date is required.',
  'K: confirmation requires payment date',
)
assertEq(
  validateConfirmPaidOutsideAlzaFlowInput({ paymentDate: '2026-08-23', paymentMethod: '' }),
  'Payment method is required.',
  'L: confirmation requires payment method',
)
assertEq(
  validateConfirmPaidOutsideAlzaFlowInput({
    paymentDate: '2026-08-23',
    paymentMethod: 'venmo',
  }),
  'Payment method is required.',
  'L: new confirms reject historical Venmo (not in confirm list)',
)
assertEq(
  validateConfirmPaidOutsideAlzaFlowInput({
    paymentDate: '2026-08-23',
    paymentMethod: 'check',
  }),
  null,
  'M/N: reference and notes are optional',
)
assertEq(
  validateConfirmPaidOutsideAlzaFlowInput({
    paymentDate: '2026-08-23',
    paymentMethod: 'wire',
    paymentReference: 'CHK-99',
    notes: 'Paid Friday',
  }),
  null,
  'M/N: optional reference and notes are accepted when supplied',
)
assert(
  FINANCIALS.includes('placeholder="Optional"') &&
    FINANCIALS.includes('Payment Reference') &&
    FINANCIALS.includes('Notes'),
  'M/N: modal shows optional reference and notes',
)
assert(
  COMMISSION_TS.includes("return 'Payment date is required.'") &&
    COMMISSION_TS.includes("return 'Payment method is required.'") &&
    COMMISSION_TS.includes("'Ready to Pay'") &&
    COMMISSION_TS.includes("'Paid (Historical)'") &&
    COMMISSION_TS.includes("'Paid Outside ALZA Flow'") &&
    COMMISSION_TS.includes("'Ready for Payment'") &&
    COMMISSION_TS.includes("'Batch Created'") &&
    COMMISSION_TS.includes("value: 'venmo', label: 'Venmo'") &&
    COMMISSION_TS.includes("manual: 'Manual'"),
  'Display/validation helpers match commission.ts source',
)

assert(
  CONFIRM_METHODS.map((m) => m.value).join(',') === 'ach,check,zelle,wire,cash,other',
  'Confirm methods are ACH, Check, Zelle, Wire, Cash, Other',
)

// ---------------------------------------------------------------------------
// O–S confirm RPC atomic paid + audit
// ---------------------------------------------------------------------------
assert(CONFIRM_SQL.includes('CREATE OR REPLACE FUNCTION public.confirm_producer_paid_outside_alza_flow'), 'O: RPC exists')
assert(CONFIRM_SQL.includes("status = 'paid'"), 'O: RPC updates batch to paid')
assert(
  CONFIRM_SQL.includes("producer_payment_status = 'paid'") &&
    CONFIRM_SQL.includes('paid_amount') &&
    CONFIRM_SQL.includes('paid_date = p_payment_date') &&
    CONFIRM_SQL.includes('GET DIAGNOSTICS v_updated_count = ROW_COUNT') &&
    CONFIRM_SQL.includes('v_updated_count <> v_item_count'),
  'P: RPC updates every linked transaction in the same function and fails if any miss',
)
assert(
  CONFIRM_SQL.includes('confirmed_by = v_actor') &&
    CONFIRM_SQL.includes('u.auth_user_id = v_uid') &&
    /SELECT\s+u\.id\s+INTO\s+v_actor/.test(CONFIRM_SQL) &&
    !CONFIRM_SQL.includes('p_confirmed_by') &&
    !CONFIRM_CLIENT.includes('confirmed_by') &&
    !/confirmed_by\s*=\s*v_uid/.test(CONFIRM_SQL) &&
    !/confirmed_by\s*=\s*auth\.uid\s*\(/.test(CONFIRM_SQL),
  'Q: confirmed_by stores public.users.id looked up from auth.uid() via users.auth_user_id, never auth.uid() itself',
)
assert(
  CONFIRM_SQL.includes('v_confirmed_at := now()') &&
    CONFIRM_SQL.includes('confirmed_at = v_confirmed_at') &&
    !CONFIRM_SQL.includes('p_confirmed_at') &&
    !CONFIRM_CLIENT.includes('confirmed_at:'),
  'R: confirmed_at is generated by the database, not browser time',
)
assert(
  CONFIRM_SQL.includes("payment_channel = 'outside_alza_flow'") &&
    CONFIRM_SQL.includes("'alza_flow_pay'") &&
    COMMISSION_TS.includes("PAYMENT_CHANNEL_OUTSIDE_ALZA_FLOW = 'outside_alza_flow'") &&
    COMMISSION_TS.includes("PAYMENT_CHANNEL_ALZA_FLOW_PAY = 'alza_flow_pay'") &&
    !FINANCIALS.includes('Pay with ALZA Flow Pay') &&
    !FINANCIALS.includes('confirm_producer_paid_alza_flow'),
  'S: payment_channel is outside_alza_flow; ALZA Flow Pay money movement is not exposed',
)
assert(
  CONFIRM_CLIENT.includes('CONFIRM_PRODUCER_PAID_RPC') &&
    COMMISSION_TS.includes("CONFIRM_PRODUCER_PAID_RPC = 'confirm_producer_paid_outside_alza_flow'"),
  'Client confirmProducerPaid calls the RPC',
)
assert(
  !CONFIRM_CLIENT.includes(".from('producer_payment_batches')") &&
    !CONFIRM_CLIENT.includes(".from('transactions')"),
  'Client confirmProducerPaid does not independently update batch or transactions',
)

// ---------------------------------------------------------------------------
// T–U permissions
// ---------------------------------------------------------------------------
assert(!canManageProducerPayments('csr'), 'T: CSR cannot confirm')
assert(
  PERMISSIONS_TS.includes('export function canMutateFinancialPayments') &&
    PERMISSIONS_TS.includes('export function canManageProducerPayments') &&
    /export function canManageProducerPayments[\s\S]*return isAdminDirectoryRole/.test(PERMISSIONS_TS) &&
    /export function canMutateFinancialPayments[\s\S]*return isAdminDirectoryRole/.test(PERMISSIONS_TS) &&
    /export function isAdminDirectoryRole[\s\S]*roles.includes\('owner'\)[\s\S]*roles.includes\('admin'\)/.test(
      PERMISSIONS_TS,
    ),
  'T: CSR/Producer are excluded because confirm gates on Owner/Admin only',
)
assert(!canManageProducerPayments('producer'), 'U: Producer cannot confirm')
assert(canManageProducerPayments('owner') && canManageProducerPayments('admin'), 'Owner/Admin can confirm')
assert(
  CONFIRM_SQL.includes("current_user_has_role('owner')") &&
    CONFIRM_SQL.includes("current_user_has_role('admin')"),
  'Confirm RPC authorization uses current_user_has_role (users.role + user_roles)',
)
assert(
  CREATE_SQL.includes("current_user_has_role('owner')") &&
    CREATE_SQL.includes("current_user_has_role('admin')") &&
    !CREATE_SQL.includes("lower(COALESCE(u.role, '')) IN ('owner', 'admin')"),
  'Create RPC authorization uses current_user_has_role (users.role + user_roles), not users.role only',
)

// ---------------------------------------------------------------------------
// V–X duplicate / concurrent / rollback
// ---------------------------------------------------------------------------
assert(
  CONFIRM_SQL.includes("lower(COALESCE(b.status, '')) = 'draft'") &&
    CONFIRM_SQL.includes('already been confirmed'),
  'V: duplicate confirmation is blocked when batch is no longer draft',
)
assert(
  CONFIRM_SQL.includes('FOR UPDATE') && CONFIRM_SQL.includes("AND b.voided_at IS NULL"),
  'W: concurrent confirmation serializes on FOR UPDATE and draft-only UPDATE',
)
assert(
  CONFIRM_SQL.includes('LANGUAGE plpgsql') &&
    CONFIRM_SQL.includes('Rolling back to prevent a partial-paid batch') &&
    CONFIRM_SQL.includes('RAISE EXCEPTION'),
  'X: any required-update failure raises inside the function transaction (no partial-paid state)',
)

// ---------------------------------------------------------------------------
// Y–Z legacy display / methods
// ---------------------------------------------------------------------------
assertEq(formatBatchStatusLabel('paid', null), 'Paid (Historical)', 'Y: legacy paid batch with null channel is Paid (Historical)')
assertEq(
  formatBatchStatusLabel('paid', 'outside_alza_flow'),
  'Paid Outside ALZA Flow',
  'Y: outside-ALZA paid batch label',
)
assertEq(formatBatchStatusLabel('draft'), 'Ready to Pay', 'Y: draft batch is Ready to Pay')
assertEq(formatPaymentChannelLabel(null, 'paid'), '—', 'Y: null channel is not displayed as Outside ALZA Flow')
assertEq(
  getTransactionWorkflowStatus({
    archived: false,
    producerPaymentStatus: 'paid',
    paidDate: '2026-01-01',
    paymentBatchId: 'batch',
  }),
  'Paid Outside ALZA Flow',
  'Y: paid transactions display Paid Outside ALZA Flow',
)
assertEq(
  getTransactionWorkflowStatus({
    archived: false,
    producerPaymentStatus: 'ready',
    paidDate: null,
    paymentBatchId: 'batch',
  }),
  'Batch Created',
  'Y: batched unpaid txs display Batch Created',
)
assertEq(
  getTransactionWorkflowStatus({
    archived: false,
    producerPaymentStatus: 'ready',
    paidDate: null,
    paymentBatchId: null,
  }),
  'Ready for Payment',
  'Y: ready unbatched txs display Ready for Payment',
)

assertEq(formatProducerPaymentMethodLabel('venmo'), 'Venmo', 'Z: Venmo still displays')
assertEq(formatProducerPaymentMethodLabel('paypal'), 'PayPal', 'Z: PayPal still displays')
assertEq(formatProducerPaymentMethodLabel('manual'), 'Manual', 'Z: legacy manual still displays')
assert(
  COMMISSION_TS.includes("value: 'venmo', label: 'Venmo'") &&
    COMMISSION_TS.includes("value: 'paypal', label: 'PayPal'") &&
    METHODS_SQL.includes("'venmo'::text") &&
    METHODS_SQL.includes("'paypal'::text") &&
    METHODS_SQL.includes("'manual'::text") &&
    !CONFIRM_SQL.includes("DROP CONSTRAINT IF EXISTS producer_payment_batches_payment_method_check"),
  'Z: historical Venmo/PayPal/manual remain compatible; confirm migration does not drop method CHECKs',
)
assert(!isValidProducerPaymentConfirmMethod('venmo'), 'Z: new confirm UI does not offer Venmo')
assert(!isValidProducerPaymentConfirmMethod('paypal'), 'Z: new confirm UI does not offer PayPal')

// ---------------------------------------------------------------------------
// AA recoveries unchanged on confirm
// ---------------------------------------------------------------------------
assert(
  CREATE_SQL.includes('producer_commission_recoveries') &&
    CREATE_SQL.includes('producer_recovery_allocations'),
  'AA: recoveries still apply at batch create',
)
assert(
  !/UPDATE\s+public\.producer_commission_recoveries/i.test(CONFIRM_SQL) &&
    !/INSERT\s+INTO\s+public\.producer_commission_recoveries/i.test(CONFIRM_SQL) &&
    !/INSERT\s+INTO\s+public\.producer_recovery_allocations/i.test(CONFIRM_SQL) &&
    CONFIRM_SQL.includes('Confirm does NOT touch producer_commission_recoveries'),
  'AA: confirm RPC does not mutate recoveries',
)

// ---------------------------------------------------------------------------
// AB Activity History
// ---------------------------------------------------------------------------
assert(
  ACTIVITY_TS.includes("case 'producer_payout_confirm':") &&
    ACTIVITY_TS.includes("'Producer payment confirmed outside ALZA Flow'") &&
    ACTIVITY_TS.includes('Payment Channel') &&
    ACTIVITY_TS.includes("humanActivityValue('paymentChannel'") &&
    ACTIVITY_TS.includes("humanActivityValue('paymentDate'") &&
    ACTIVITY_TS.includes("humanActivityValue('paymentMethod'") &&
    ACTIVITY_TS.includes("humanActivityValue('paymentReference'") &&
    ACTIVITY_TS.includes("'confirmedBy'") &&
    ACTIVITY_TS.includes("'transactionIds'") &&
    ACTIVITY_TS.includes('looksLikeUuid') &&
    CONFIRM_CLIENT.includes("action: 'producer_payout_confirm'") &&
    CONFIRM_CLIENT.includes('paymentChannel') &&
    !CONFIRM_CLIENT.includes('transactionIds'),
  'AB: producer_payout_confirm is preserved with channel/date/method/reference and no customer-facing IDs',
)

// ---------------------------------------------------------------------------
// UI / migration safety extras
// ---------------------------------------------------------------------------
assert(FINANCIALS.includes('Confirm Paid Outside ALZA Flow'), 'UI: confirm action renamed')
assert(FINANCIALS.includes('Confirm Payment'), 'UI: final button is Confirm Payment')
assert(
  FINANCIALS.includes(
    'Confirm only after the producer has actually been paid. ALZA Flow does not process this payment.',
  ),
  'UI: required warning copy',
)
assert(FINANCIALS.includes('Ready for Payment'), 'UI: Ready for Payment heading')
assert(
  FINANCIALS.includes('Producer commissions that are ready to be included in a payment batch.'),
  'UI: Ready for Payment supporting description',
)
assert(!FINANCIALS.includes('Ready for Payout'), 'UI: Ready for Payout heading is gone')
assert(
  COMMISSION_TS.includes("return 'Paid (Historical)'") &&
    FINANCIALS.includes('formatBatchStatusLabel(row.status, row.paymentChannel)'),
  'UI: historical paid batches use Paid (Historical) via formatBatchStatusLabel',
)
assert(
  CONFIRM_SQL.includes('ADD COLUMN IF NOT EXISTS confirmed_at') &&
    CONFIRM_SQL.includes('ADD COLUMN IF NOT EXISTS payment_channel') &&
    CONFIRM_SQL.includes('ADD COLUMN IF NOT EXISTS producer_payout_schedule') &&
    !CONFIRM_SQL.includes('DROP TABLE') &&
    CONFIRM_SQL.includes('Do not backfill historical confirmers') &&
    CONFIRM_SQL.includes('historical paid batches are NOT backfilled') &&
    !/UPDATE\s+public\.producer_payment_batches[\s\S]*SET[\s\S]*confirmed_by/.test(
      CONFIRM_SQL.slice(0, CONFIRM_SQL.indexOf('CREATE OR REPLACE FUNCTION')),
    ) &&
    !/confirmed_by\s*=\s*'/.test(CONFIRM_SQL),
  'Migration is additive and does not backfill historical confirmers',
)
assert(!FINANCIALS.includes('Unpay') && !CONFIRM_SQL.includes('unpay'), 'V1 has no Unpay action')

const CONFIRMED_BY_DDL_END = CONFIRM_SQL.indexOf('CREATE OR REPLACE FUNCTION public.confirm_producer_paid_outside_alza_flow')
const CONFIRMED_BY_DDL = CONFIRMED_BY_DDL_END > 0 ? CONFIRM_SQL.slice(0, CONFIRMED_BY_DDL_END) : CONFIRM_SQL
const missingStart = CONFIRMED_BY_DDL.indexOf('IF v_typname IS NULL THEN')
const uuidStart = CONFIRMED_BY_DDL.indexOf("ELSIF v_typname = 'uuid' THEN")
const textStart = CONFIRMED_BY_DDL.indexOf("ELSIF v_typname IN ('text', 'varchar', 'bpchar', 'citext') THEN")
const unsupportedStart = CONFIRMED_BY_DDL.indexOf(
  "'producer_payment_batches.confirmed_by has unsupported type",
)
const MISSING_BRANCH =
  missingStart >= 0 && uuidStart > missingStart ? CONFIRMED_BY_DDL.slice(missingStart, uuidStart) : ''
const UUID_BRANCH = uuidStart >= 0 && textStart > uuidStart ? CONFIRMED_BY_DDL.slice(uuidStart, textStart) : ''
const TEXT_BRANCH =
  textStart >= 0 && unsupportedStart > textStart ? CONFIRMED_BY_DDL.slice(textStart, unsupportedStart) : ''

assert(
  MISSING_BRANCH.includes('ADD COLUMN confirmed_by uuid') &&
    !MISSING_BRANCH.includes('ADD COLUMN IF NOT EXISTS confirmed_by') &&
    !MISSING_BRANCH.includes('ALTER COLUMN confirmed_by TYPE'),
  '1: missing confirmed_by adds uuid (not a no-op IF NOT EXISTS on a legacy text column)',
)
assert(
  TEXT_BRANCH.includes("ALTER COLUMN confirmed_by TYPE uuid") &&
    TEXT_BRANCH.includes("USING NULLIF(btrim(confirmed_by::text), '')::uuid") &&
    TEXT_BRANCH.includes('RAISE EXCEPTION') &&
    TEXT_BRANCH.includes('not a valid UUID'),
  '2: existing TEXT confirmed_by uses guarded conversion to uuid',
)
assert(
  UUID_BRANCH.length > 0 &&
    UUID_BRANCH.includes('NULL;') &&
    !UUID_BRANCH.includes('ALTER COLUMN confirmed_by TYPE') &&
    !UUID_BRANCH.includes('USING NULLIF') &&
    !UUID_BRANCH.includes('DROP COLUMN'),
  '3: existing UUID confirmed_by is left unchanged (no destructive conversion)',
)
assert(
  TEXT_BRANCH.includes('RAISE EXCEPTION') &&
    TEXT_BRANCH.includes('not discarded or rewritten') &&
    TEXT_BRANCH.includes('Conversion aborted') &&
    !/USING\s+NULL\s*;/.test(TEXT_BRANCH) &&
    !/confirmed_by\s*=\s*NULL/.test(TEXT_BRANCH) &&
    TEXT_BRANCH.includes('invalid_text_representation') &&
    TEXT_BRANCH.includes("USING NULLIF(btrim(confirmed_by::text), '')::uuid"),
  '4: invalid non-null text cannot be silently discarded; conversion RAISES and stops',
)
assert(
  CONFIRMED_BY_DDL.includes('FOREIGN KEY (confirmed_by) REFERENCES public.users (id)') &&
    CONFIRMED_BY_DDL.includes("t.typname = 'uuid'") &&
    CONFIRMED_BY_DDL.includes('must be uuid before adding FK') &&
    CONFIRMED_BY_DDL.includes("c.conname = 'producer_payment_batches_confirmed_by_fkey'") &&
    CONFIRMED_BY_DDL.includes("src.attname = 'confirmed_by'") &&
    CONFIRMED_BY_DDL.includes("dst.attname = 'id'") &&
    CONFIRMED_BY_DDL.includes("c.confrelid = 'public.users'::regclass") &&
    !CONFIRMED_BY_DDL.includes('DROP CONSTRAINT') &&
    CONFIRMED_BY_DDL.includes('IF NOT v_named_fk AND NOT v_matching_fk THEN'),
  '5: FK target is public.users(id); creation is idempotent and does not drop unrelated constraints',
)
assert(
  CONFIRM_SQL.includes('confirmed_by = v_actor') &&
    /SELECT\s+u\.id\s+INTO\s+v_actor/.test(CONFIRM_SQL) &&
    CONFIRM_SQL.includes('u.auth_user_id = v_uid') &&
    CONFIRM_SQL.includes('v_uid uuid := auth.uid()') &&
    !/confirmed_by\s*=\s*v_uid/.test(CONFIRM_SQL),
  '6: RPC stores public.users.id, not auth.uid()',
)
assert(
  CONFIRM_SQL.includes('Do not backfill historical confirmers') &&
    CONFIRM_SQL.includes('historical paid batches are NOT backfilled') &&
    !/UPDATE\s+public\.producer_payment_batches[\s\S]{0,400}confirmed_by\s*=\s*v_actor/.test(
      CONFIRMED_BY_DDL,
    ),
  '7: no historical confirmer backfill',
)
assert(
  !CREATE_SQL.includes("producer_payment_status = 'paid'") &&
    !CREATE_SQL.includes("status = 'paid'") &&
    /INSERT INTO public\.producer_payment_batches[\s\S]*'draft'/.test(CREATE_SQL),
  '8: create batch still never marks paid',
)
assert(
  CONFIRM_SQL.includes('LANGUAGE plpgsql') &&
    CONFIRM_SQL.includes('GET DIAGNOSTICS v_updated_count = ROW_COUNT') &&
    CONFIRM_SQL.includes('v_updated_count <> v_item_count') &&
    CONFIRM_SQL.includes('Rolling back to prevent a partial-paid batch') &&
    CONFIRM_SQL.includes('FOR UPDATE'),
  '9: confirm remains atomic',
)

console.log(`Producer Payment V1 validation: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
