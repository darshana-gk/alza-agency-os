/**
 * Subscription access gate decision checks. No Production. No secrets.
 */
import {
  customerFacingRestriction,
  evaluateSubscriptionAccess,
  isAllowedWhileRestricted,
  isSubscriptionInPeriod,
} from '../src/lib/subscriptionAccess.ts'

let failed = 0

function assert(cond: boolean, label: string) {
  if (!cond) {
    failed += 1
    console.error('FAIL', label)
    return
  }
  console.log('PASS', label)
}

const noonUtc = new Date('2026-09-09T12:00:00.000Z')

assert(evaluateSubscriptionAccess({ status: null }).open === false, 'no status closed')
assert(evaluateSubscriptionAccess({ status: '' }).open === false, 'empty status closed')
assert(evaluateSubscriptionAccess({ status: 'created' }).reason === 'pending', 'created pending')
assert(evaluateSubscriptionAccess({ status: 'authenticated' }).open === false, 'authenticated closed')
assert(evaluateSubscriptionAccess({ status: 'pending' }).open === false, 'pending closed')
assert(evaluateSubscriptionAccess({ status: 'halted' }).open === false, 'halted closed')
assert(evaluateSubscriptionAccess({ status: 'cancelled' }).reason === 'cancelled', 'cancelled')
assert(evaluateSubscriptionAccess({ status: 'canceled' }).reason === 'cancelled', 'canceled')
assert(evaluateSubscriptionAccess({ status: 'completed' }).reason === 'cancelled', 'completed closed')
assert(evaluateSubscriptionAccess({ status: 'paused' }).open === false, 'paused closed')
assert(evaluateSubscriptionAccess({ status: 'trialing' }).open === false, 'trialing closed')
assert(evaluateSubscriptionAccess({ status: 'past_due' }).reason === 'past_due', 'past_due')
assert(evaluateSubscriptionAccess({ status: 'unpaid' }).open === false, 'unpaid closed')
assert(evaluateSubscriptionAccess({ status: 'incomplete' }).open === false, 'incomplete closed')
assert(evaluateSubscriptionAccess({ status: 'incomplete_expired' }).open === false, 'incomplete_expired closed')
assert(evaluateSubscriptionAccess({ status: 'future_unknown' }).reason === 'other', 'unknown status closed')

assert(
  evaluateSubscriptionAccess({
    status: 'active',
    currentPeriodEnd: null,
    now: noonUtc,
  }).open === true,
  'active null end open',
)
assert(
  evaluateSubscriptionAccess({
    status: 'active',
    currentPeriodEnd: '2026-09-09T00:00:00+00',
    now: noonUtc,
  }).open === true,
  'active end today open',
)
assert(
  evaluateSubscriptionAccess({
    status: 'active',
    currentPeriodEnd: '2026-09-10',
    now: noonUtc,
  }).open === true,
  'active future end open',
)
assert(
  evaluateSubscriptionAccess({
    status: 'active',
    currentPeriodEnd: '2026-09-08T00:00:00+00',
    now: noonUtc,
  }).reason === 'expired',
  'active expired closed',
)

assert(
  isSubscriptionInPeriod('2026-09-09T00:00:00.000Z', new Date('2026-09-09T23:30:00.000Z')),
  'calendar date not expired early by late UTC',
)

assert(isAllowedWhileRestricted('/admin/subscription-billing'), 'billing allowed')
assert(isAllowedWhileRestricted('/support'), 'support allowed')
assert(isAllowedWhileRestricted('/support?c=1'), 'support query allowed')
assert(isAllowedWhileRestricted('/help'), 'help allowed')
assert(!isAllowedWhileRestricted('/'), 'dashboard blocked')
assert(!isAllowedWhileRestricted('/clients'), 'clients blocked')
assert(!isAllowedWhileRestricted('/onboarding'), 'onboarding blocked')
assert(!isAllowedWhileRestricted('/admin/users'), 'users blocked')
assert(!isAllowedWhileRestricted('/admin/agencies'), 'agencies not customer-allowed')

const noneCopy = customerFacingRestriction('none')
assert(noneCopy.heading === 'Your ALZA Flow workspace is being activated', 'activation heading')
assert(noneCopy.body.includes('subscription setup is complete'), 'activation body')
assert(!noneCopy.stateLabel.toLowerCase().includes('incomplete'), 'no raw incomplete label')
assert(customerFacingRestriction('cancelled').heading !== noneCopy.heading, 'cancelled copy differs')
assert(customerFacingRestriction('expired').heading !== noneCopy.heading, 'expired copy differs')
assert(customerFacingRestriction('past_due').heading !== noneCopy.heading, 'past_due copy differs')
assert(customerFacingRestriction('unavailable').stateLabel.includes('temporarily unavailable'), 'error copy')

if (failed) {
  console.error(`subscription access gate validator FAIL ${failed}`)
  process.exit(1)
}
console.log('SUBSCRIPTION_ACCESS_GATE_VALIDATOR PASS')
