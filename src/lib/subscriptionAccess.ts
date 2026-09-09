/**
 * Commercial workspace gate. Not a security boundary — RLS remains authoritative.
 * Open only for status "active" and an in-period (or open-ended) subscription.
 */

export type SubscriptionGateState = 'LOADING' | 'ACTIVE' | 'RESTRICTED' | 'ERROR'

export type RestrictedReason =
  | 'none'
  | 'pending'
  | 'cancelled'
  | 'expired'
  | 'past_due'
  | 'unavailable'
  | 'other'

export type SubscriptionAccessDecision = {
  open: boolean
  reason: RestrictedReason
}

const PENDING_STATUSES = new Set([
  'created',
  'authenticated',
  'pending',
  'paused',
  'halted',
  'trialing',
  'unpaid',
  'incomplete',
  'incomplete_expired',
])

export function calendarDatePrefix(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  return match ? match[1] : null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function utcCalendarDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function localCalendarDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Period end is a calendar date. Compare against the earlier of local and UTC
 * "today" so a timezone conversion cannot expire the workspace a day early.
 * Null/blank end means open-ended.
 */
export function isSubscriptionInPeriod(
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const end = calendarDatePrefix(currentPeriodEnd)
  if (!currentPeriodEnd || String(currentPeriodEnd).trim() === '') return true
  if (!end) return false
  const utcToday = utcCalendarDate(now)
  const localToday = localCalendarDate(now)
  const earliestToday = utcToday < localToday ? utcToday : localToday
  return end >= earliestToday
}

export function evaluateSubscriptionAccess(input: {
  status: string | null | undefined
  currentPeriodEnd?: string | null
  now?: Date
}): SubscriptionAccessDecision {
  const status = String(input.status ?? '').trim().toLowerCase()
  if (!status) return { open: false, reason: 'none' }
  if (status === 'cancelled' || status === 'canceled' || status === 'completed') {
    return { open: false, reason: 'cancelled' }
  }
  if (status === 'past_due') return { open: false, reason: 'past_due' }
  if (status !== 'active') {
    return { open: false, reason: PENDING_STATUSES.has(status) ? 'pending' : 'other' }
  }
  if (!isSubscriptionInPeriod(input.currentPeriodEnd, input.now)) {
    return { open: false, reason: 'expired' }
  }
  return { open: true, reason: 'none' }
}

export function customerFacingRestriction(reason: RestrictedReason): {
  heading: string
  body: string
  stateLabel: string
} {
  if (reason === 'cancelled') {
    return {
      heading: 'Your ALZA Flow subscription is not active',
      body: 'Operational access is paused because this subscription is no longer active. ALZA can restore the workspace once subscription setup is complete.',
      stateLabel: 'Subscription cancelled',
    }
  }
  if (reason === 'expired') {
    return {
      heading: 'Your ALZA Flow subscription period has ended',
      body: 'Operational access is paused because the current subscription period has ended. ALZA can restore the workspace once subscription setup is complete.',
      stateLabel: 'Subscription expired',
    }
  }
  if (reason === 'past_due') {
    return {
      heading: 'Your ALZA Flow subscription needs attention',
      body: 'Operational access is paused until subscription setup is brought current. ALZA will enable the workspace once that is complete.',
      stateLabel: 'Payment attention needed',
    }
  }
  if (reason === 'unavailable') {
    return {
      heading: 'Your ALZA Flow workspace is being activated',
      body: 'We could not confirm subscription status just now. Operational access stays closed until activation is confirmed. You can check again, open Subscription & Billing, or contact Help & Support.',
      stateLabel: 'Status temporarily unavailable',
    }
  }
  return {
    heading: 'Your ALZA Flow workspace is being activated',
    body: 'Your account has been created successfully. ALZA will enable your workspace once your subscription setup is complete.',
    stateLabel: reason === 'pending' ? 'Activation in progress' : 'Not activated yet',
  }
}

export function isAllowedWhileRestricted(pathname: string): boolean {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/'
  return (
    path === '/admin/subscription-billing' ||
    path === '/support' ||
    path.startsWith('/support/') ||
    path === '/help' ||
    path.startsWith('/help/')
  )
}
