import type { SubscriptionAccessRefreshResult, SubscriptionGateState } from './subscriptionAccess'

export const ONBOARDING_HANDOFF_PATH = '/onboarding' as const

export const ONBOARDING_HANDOFF_REFRESH_FAILED_MESSAGE =
  'Workspace access could not be confirmed yet. Stay on Subscription & Billing and try Start Onboarding again.'

export const ONBOARDING_HANDOFF_STILL_RESTRICTED_MESSAGE =
  'Your subscription is recorded, but workspace access is not open yet. Stay on this page and try Start Onboarding again.'

export type OnboardingHandoffStayReason =
  | 'billing_not_active'
  | 'gate_restricted'
  | 'gate_refresh_failed'
  | 'already_handed_off'
  | 'in_flight'

export type OnboardingHandoffDecision =
  | { action: 'navigate'; path: typeof ONBOARDING_HANDOFF_PATH }
  | { action: 'stay'; reason: OnboardingHandoffStayReason; message: string | null }

export function billingAllowsOnboardingHandoff(status: string | null | undefined): boolean {
  return String(status ?? '').trim().toLowerCase() === 'active'
}

export function decideOnboardingHandoff(input: {
  billingStatus: string | null | undefined
  gateState: SubscriptionGateState | null | undefined
  refreshFailed?: boolean
  alreadyHandedOff?: boolean
  inFlight?: boolean
}): OnboardingHandoffDecision {
  if (input.alreadyHandedOff) {
    return { action: 'stay', reason: 'already_handed_off', message: null }
  }
  if (input.inFlight) {
    return { action: 'stay', reason: 'in_flight', message: null }
  }
  if (!billingAllowsOnboardingHandoff(input.billingStatus)) {
    return { action: 'stay', reason: 'billing_not_active', message: null }
  }
  if (
    input.refreshFailed ||
    !input.gateState ||
    input.gateState === 'ERROR' ||
    input.gateState === 'LOADING'
  ) {
    return {
      action: 'stay',
      reason: 'gate_refresh_failed',
      message: ONBOARDING_HANDOFF_REFRESH_FAILED_MESSAGE,
    }
  }
  if (input.gateState !== 'ACTIVE') {
    return {
      action: 'stay',
      reason: 'gate_restricted',
      message: ONBOARDING_HANDOFF_STILL_RESTRICTED_MESSAGE,
    }
  }
  return { action: 'navigate', path: ONBOARDING_HANDOFF_PATH }
}

/**
 * Billing status active is necessary but not sufficient.
 * Navigate only after the subscription-access refresh reports ACTIVE.
 */
export async function confirmOnboardingHandoff(input: {
  billingStatus: string | null | undefined
  refreshGate: () => Promise<SubscriptionAccessRefreshResult | null | undefined>
  alreadyHandedOff?: boolean
  inFlight?: boolean
}): Promise<OnboardingHandoffDecision> {
  if (input.alreadyHandedOff) {
    return { action: 'stay', reason: 'already_handed_off', message: null }
  }
  if (input.inFlight) {
    return { action: 'stay', reason: 'in_flight', message: null }
  }
  if (!billingAllowsOnboardingHandoff(input.billingStatus)) {
    return { action: 'stay', reason: 'billing_not_active', message: null }
  }

  let gateState: SubscriptionGateState | null = null
  let refreshFailed = false
  try {
    const result = await input.refreshGate()
    if (!result) {
      refreshFailed = true
    } else {
      gateState = result.state
    }
  } catch {
    refreshFailed = true
  }

  return decideOnboardingHandoff({
    billingStatus: input.billingStatus,
    gateState,
    refreshFailed,
  })
}
