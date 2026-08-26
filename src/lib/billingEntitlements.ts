/**
 * Soft seat / user-band entitlements for ALZA Flow billing.
 * Soft enforcement: warn and guide upgrade — do not hard-block without review.
 */

import {
  billingUserBand,
  formatStoredPlanLabel,
  isBillingCheckoutBandKey,
  isLegacyBillingPlanKey,
  parseCheckoutSku,
  recommendUserBand,
  type BillingCheckoutBandKey,
  type BillingUserBandKey,
} from './billingCatalog'

export type SeatEntitlementResult = {
  ok: boolean
  softBlock: boolean
  userCount: number
  includedUsersMax: number | null
  planBand: BillingUserBandKey | null
  recommendedBand: BillingUserBandKey
  message: string | null
}

function bandMaxFromPlanKey(planKey: string | null | undefined): {
  band: BillingUserBandKey | null
  max: number | null
} {
  if (isLegacyBillingPlanKey(planKey)) {
    // Legacy plans: no hard seat metadata — treat as soft unlimited guidance only.
    return { band: null, max: null }
  }
  const parsed = parseCheckoutSku(planKey)
  if (parsed && isBillingCheckoutBandKey(parsed.userBand)) {
    const band = billingUserBand('alza_flow', parsed.userBand)
    return { band: parsed.userBand, max: band?.includedUsersMax ?? null }
  }
  return { band: null, max: null }
}

/**
 * Evaluate adding one more user against the current subscription seat soft-limit.
 */
export function evaluateSeatEntitlement(input: {
  currentUserCount: number
  planKey?: string | null
  userBandKey?: string | null
  /** When true, evaluating the invite that would increase count by 1. */
  addingUser?: boolean
}): SeatEntitlementResult {
  const current = Math.max(0, Math.floor(input.currentUserCount))
  const nextCount = input.addingUser ? current + 1 : current
  const fromBandKey = isBillingCheckoutBandKey(input.userBandKey)
    ? (input.userBandKey as BillingCheckoutBandKey)
    : null
  const fromPlan = bandMaxFromPlanKey(input.planKey)
  const planBand = fromBandKey ?? fromPlan.band
  const includedUsersMax =
    fromBandKey != null
      ? billingUserBand('alza_flow', fromBandKey)?.includedUsersMax ?? null
      : fromPlan.max
  const recommendedBand = recommendUserBand(nextCount)

  if (includedUsersMax == null) {
    return {
      ok: true,
      softBlock: false,
      userCount: current,
      includedUsersMax: null,
      planBand,
      recommendedBand,
      message: null,
    }
  }

  if (nextCount <= includedUsersMax) {
    return {
      ok: true,
      softBlock: false,
      userCount: current,
      includedUsersMax,
      planBand,
      recommendedBand,
      message: null,
    }
  }

  return {
    ok: false,
    softBlock: true,
    userCount: current,
    includedUsersMax,
    planBand,
    recommendedBand,
    message: `Your current plan includes up to ${includedUsersMax} users. Upgrade to add additional users.`,
  }
}

export function softSeatWarningMessage(result: SeatEntitlementResult): string | null {
  if (!result.softBlock || !result.message) return null
  return result.message
}

export function legacyPlanDisplayNote(planKey: string | null | undefined): string | null {
  const label = formatStoredPlanLabel({ planKey })
  return label.legacy ? 'Legacy Plan — historical compatibility only; new checkout unavailable.' : null
}
