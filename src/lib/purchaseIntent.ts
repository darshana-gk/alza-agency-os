/**
 * Canonical purchase intent helpers for public pricing → signup → billing.
 * Prefer plan_key; expand to product / userBand / interval via billingCatalog.
 */

import {
  BILLING_CHECKOUT_SKUS,
  checkoutSkuFor,
  isBillingCheckoutSku,
  isBillingInterval,
  isBillingProductKey,
  isBillingUserBandKey,
  parseCheckoutSku,
  quoteBillingSelection,
  type BillingCheckoutSku,
  type BillingInterval,
  type BillingProductKey,
  type BillingUserBandKey,
} from './billingCatalog'

export type PurchaseIntent = {
  product: BillingProductKey
  userBand: BillingUserBandKey
  interval: BillingInterval
  planKey: BillingCheckoutSku
}

/** Resolve a canonical checkout intent from plan_key and/or product+band+interval. */
export function resolvePurchaseIntent(input: {
  planKey?: string | null
  product?: string | null
  userBand?: string | null
  interval?: string | null
}): PurchaseIntent | null {
  const fromSku = parseCheckoutSku(input.planKey)
  if (fromSku) {
    const planKey = checkoutSkuFor(fromSku.product, fromSku.userBand, fromSku.interval)
    if (!planKey) return null
    return {
      product: fromSku.product,
      userBand: fromSku.userBand,
      interval: fromSku.interval,
      planKey,
    }
  }

  if (
    isBillingProductKey(input.product) &&
    input.product === 'alza_flow' &&
    isBillingUserBandKey(input.userBand) &&
    (input.userBand === 'users_1_3' ||
      input.userBand === 'users_4_10' ||
      input.userBand === 'users_11_25' ||
      input.userBand === 'users_26_50') &&
    isBillingInterval(input.interval)
  ) {
    const planKey = checkoutSkuFor(input.product, input.userBand, input.interval)
    if (!planKey) return null
    return {
      product: input.product,
      userBand: input.userBand,
      interval: input.interval,
      planKey,
    }
  }

  return null
}

export function purchaseIntentFromSearchParams(params: URLSearchParams): PurchaseIntent | null {
  return resolvePurchaseIntent({
    planKey: params.get('plan_key') ?? params.get('planKey'),
    product: params.get('product'),
    userBand: params.get('userBand') ?? params.get('user_band'),
    interval: params.get('interval'),
  })
}

export function signupPathForPlan(planKey: BillingCheckoutSku): string {
  return `/signup?plan_key=${encodeURIComponent(planKey)}`
}

export function billingPathForPlan(planKey: BillingCheckoutSku): string {
  return `/admin/subscription-billing?plan_key=${encodeURIComponent(planKey)}`
}

export function quoteForPlanKey(planKey: BillingCheckoutSku) {
  const parsed = parseCheckoutSku(planKey)
  if (!parsed) return null
  return quoteBillingSelection(parsed)
}

export function allSelfServeCheckoutSkus(): BillingCheckoutSku[] {
  return [...BILLING_CHECKOUT_SKUS]
}

export function assertCheckoutSku(value: string | null | undefined): BillingCheckoutSku | null {
  return isBillingCheckoutSku(value) ? value : null
}
