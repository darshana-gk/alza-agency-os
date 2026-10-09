/**
 * End-of-period cancellation rules. Offline only.
 * Does not call Razorpay, send email, or touch a database.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateSubscriptionAccess } from '../src/lib/subscriptionAccess.ts'
import {
  cancellationConfirmationEmail,
  classifyCycleEndCancelFailure,
  cycleEndCancelRequestBody,
  planCycleEndCancellation,
  reconcileScheduledCancellation,
} from '../supabase/functions/_shared/razorpayCancellation.ts'

const root = resolve(process.cwd())
let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    console.log(`  OK: ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL: ${message}`)
}

function assertEq(actual: unknown, expected: unknown, message: string) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  assert(same, same ? message : `${message} (got ${JSON.stringify(actual)})`)
}

const MONTHLY_END = 1_800_000_000
const ANNUAL_END = 1_831_536_000
const nowDuringPaidPeriod = '2027-01-15T00:00:00.000Z'
const afterMonthlyEnd = '2027-02-15T00:00:00.000Z'

console.log('1. Razorpay cycle-end request')
{
  assertEq(cycleEndCancelRequestBody(), { cancel_at_cycle_end: true }, 'cycle-end cancel uses boolean true')
  assertEq(
    classifyCycleEndCancelFailure('Subscription cannot be cancelled since no billing cycle is going on.'),
    'no_active_cycle',
    'no active cycle is recognized',
  )
  assertEq(
    classifyCycleEndCancelFailure('The subscription is in its final cycle and cannot be cancelled now.'),
    'final_cycle',
    'final cycle is recognized',
  )
}

console.log('2. Monthly and annual paid-through dates come from Razorpay')
{
  const monthly = planCycleEndCancellation({
    remoteStatus: 'active',
    currentEndUnix: MONTHLY_END,
    nowIso: nowDuringPaidPeriod,
  })
  const annual = planCycleEndCancellation({
    remoteStatus: 'active',
    currentEndUnix: ANNUAL_END,
    nowIso: nowDuringPaidPeriod,
  })
  assert(monthly.action === 'schedule' && annual.action === 'schedule', 'both intervals schedule')
  if (monthly.action === 'schedule' && annual.action === 'schedule') {
    assert(monthly.paidThroughIso !== annual.paidThroughIso, 'monthly and annual dates stay distinct')
    assertEq(monthly.paidThroughIso, new Date(MONTHLY_END * 1000).toISOString(), 'monthly date is current_end')
    assertEq(annual.paidThroughIso, new Date(ANNUAL_END * 1000).toISOString(), 'annual date is current_end')
    const guessedMonthly = new Date(Date.parse(nowDuringPaidPeriod) + 30 * 24 * 60 * 60 * 1000).toISOString()
    const guessedAnnual = new Date(Date.parse(nowDuringPaidPeriod) + 365 * 24 * 60 * 60 * 1000).toISOString()
    assert(monthly.paidThroughIso !== guessedMonthly, 'monthly date is not now plus 30 days')
    assert(annual.paidThroughIso !== guessedAnnual, 'annual date is not now plus 365 days')
  }
  assertEq(
    planCycleEndCancellation({ remoteStatus: 'active', currentEndUnix: null, nowIso: nowDuringPaidPeriod }).action,
    'unconfirmed',
    'a missing current_end does not invent a date',
  )
}

console.log('3. Access stays open through the paid-through date and closes after it')
{
  const paidThrough = new Date(MONTHLY_END * 1000).toISOString()
  assertEq(
    evaluateSubscriptionAccess({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: paidThrough,
      now: new Date(nowDuringPaidPeriod),
    }),
    { open: true, reason: 'none' },
    'scheduled cancellation keeps access during the paid period',
  )
  assertEq(
    evaluateSubscriptionAccess({
      status: 'cancelled',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: paidThrough,
      now: new Date(nowDuringPaidPeriod),
    }),
    { open: true, reason: 'none' },
    'a premature cancelled status does not close a still-paid period',
  )
  assertEq(
    evaluateSubscriptionAccess({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: paidThrough,
      now: new Date(afterMonthlyEnd),
    }),
    { open: false, reason: 'expired' },
    'access closes after the paid-through date',
  )
  assertEq(
    evaluateSubscriptionAccess({
      status: 'cancelled',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: paidThrough,
      now: new Date(nowDuringPaidPeriod),
    }),
    { open: false, reason: 'cancelled' },
    'an immediate cancellation still closes access',
  )
  assertEq(
    evaluateSubscriptionAccess({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: null,
      now: new Date(nowDuringPaidPeriod),
    }),
    { open: false, reason: 'unavailable' },
    'a scheduled cancellation without a date does not stay open',
  )
}

console.log('4. Webhooks cannot reopen an expired cancellation or clear a pending one')
{
  const paidThrough = new Date(MONTHLY_END * 1000).toISOString()
  const older = new Date((MONTHLY_END - 86_400) * 1000).toISOString()
  const renewed = new Date(ANNUAL_END * 1000).toISOString()
  assertEq(
    reconcileScheduledCancellation({
      localStatus: 'active',
      localCancelAtPeriodEnd: true,
      localPaidThroughIso: paidThrough,
      remoteStatus: 'active',
      remotePaidThroughIso: paidThrough,
      remoteCancelAtCycleEnd: null,
      nowIso: nowDuringPaidPeriod,
    }).cancelAtPeriodEnd,
    true,
    'a duplicate active webhook keeps the scheduled cancellation',
  )
  assertEq(
    reconcileScheduledCancellation({
      localStatus: 'active',
      localCancelAtPeriodEnd: true,
      localPaidThroughIso: paidThrough,
      remoteStatus: 'cancelled',
      remotePaidThroughIso: paidThrough,
      remoteCancelAtCycleEnd: true,
      nowIso: nowDuringPaidPeriod,
    }).status,
    'active',
    'a cancelled webhook before the paid-through date does not close access',
  )
  assertEq(
    reconcileScheduledCancellation({
      localStatus: 'active',
      localCancelAtPeriodEnd: true,
      localPaidThroughIso: paidThrough,
      remoteStatus: 'cancelled',
      remotePaidThroughIso: paidThrough,
      remoteCancelAtCycleEnd: true,
      nowIso: afterMonthlyEnd,
    }).status,
    'cancelled',
    'the final cancellation webhook closes the subscription after expiry',
  )
  assertEq(
    reconcileScheduledCancellation({
      localStatus: 'active',
      localCancelAtPeriodEnd: true,
      localPaidThroughIso: paidThrough,
      remoteStatus: 'active',
      remotePaidThroughIso: older,
      remoteCancelAtCycleEnd: null,
      nowIso: nowDuringPaidPeriod,
    }).paidThroughIso,
    paidThrough,
    'an older webhook cannot move the paid-through date backward',
  )
  const forwarded = reconcileScheduledCancellation({
    localStatus: 'active',
    localCancelAtPeriodEnd: true,
    localPaidThroughIso: paidThrough,
    remoteStatus: 'active',
    remotePaidThroughIso: renewed,
    remoteCancelAtCycleEnd: null,
    nowIso: nowDuringPaidPeriod,
  })
  assertEq(forwarded.paidThroughIso, renewed, 'a later Razorpay period can move the date forward')
  assertEq(forwarded.cancelAtPeriodEnd, true, 'a later period does not erase the scheduled cancellation')
  assertEq(
    reconcileScheduledCancellation({
      localStatus: 'cancelled',
      localCancelAtPeriodEnd: false,
      localPaidThroughIso: paidThrough,
      remoteStatus: 'active',
      remotePaidThroughIso: renewed,
      remoteCancelAtCycleEnd: null,
      nowIso: afterMonthlyEnd,
    }).status,
    'active',
    'mirror math records the remote status only when the caller chooses to apply it',
  )
}

console.log('5. Pending payment and repeated cancellation')
{
  const pending = planCycleEndCancellation({
    remoteStatus: 'pending',
    currentEndUnix: MONTHLY_END,
    nowIso: nowDuringPaidPeriod,
  })
  assert(pending.action === 'schedule', 'a pending payment with a Razorpay end date can be scheduled')
  if (pending.action === 'schedule') {
    assertEq(pending.statusToStore, 'pending', 'pending status is preserved until Razorpay ends the cycle')
    assertEq(
      evaluateSubscriptionAccess({
        status: 'pending',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: pending.paidThroughIso,
        now: new Date(nowDuringPaidPeriod),
      }).open,
      true,
      'a still-paid pending cancellation keeps access',
    )
  }
  const cancel = readFileSync(resolve(root, 'supabase/functions/cancel-razorpay-subscription/index.ts'), 'utf8')
  assert(cancel.includes('already_scheduled'), 'a repeated request returns the stored schedule')
  assert(cancel.includes('chargeConfirmedStopped: false'), 'the response does not claim a charge was prevented')
  assert(cancel.includes(".eq('agency_profile_id', input.agencyProfileId)"), 'the schedule write is pinned to one agency')
  assert(cancel.includes('requireOwnerOrAdmin'), 'cancellation stays limited to Owner or Admin')
}

console.log('6. Confirmation email copy')
{
  const message = cancellationConfirmationEmail('January 15, 2027')
  assert(message.text.includes('January 15, 2027'), 'the email states the confirmed access date')
  assert(message.text.includes('not automatically refunded'), 'the email says unused time is not refunded')
  assert(message.text.includes('may still complete'), 'the email does not promise an in-flight charge was stopped')
  assert(!message.text.includes('30 days') && !message.text.includes('365'), 'the email does not invent a period length')
  const cancel = readFileSync(resolve(root, 'supabase/functions/cancel-razorpay-subscription/index.ts'), 'utf8')
  assert(cancel.includes('sendCancellationConfirmation'), 'cancellation triggers the confirmation email')
  assert(cancel.includes("status: 'not_configured'"), 'missing email configuration is reported')
}

console.log('')
console.log(`End-of-period cancellation: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
