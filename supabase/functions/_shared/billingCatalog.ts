/**
 * Server-side ALZA Flow checkout mapping.
 * Plan IDs come only from Edge Function secrets — never hardcoded / never from browser amounts.
 */

export const BILLING_CHECKOUT_SKUS = [
  'flow_1_3_monthly',
  'flow_1_3_annual',
  'flow_4_10_monthly',
  'flow_4_10_annual',
  'flow_11_25_monthly',
  'flow_11_25_annual',
  'flow_26_50_monthly',
  'flow_26_50_annual',
] as const

export type BillingCheckoutSku = (typeof BILLING_CHECKOUT_SKUS)[number]
export type BillingProductKey = 'alza_flow' | 'alza_flow_pay'
export type BillingCheckoutBandKey = 'users_1_3' | 'users_4_10' | 'users_11_25' | 'users_26_50'
export type BillingInterval = 'monthly' | 'annual'
export type LegacyBillingPlanKey = 'essential' | 'professional'

const BAND_SKU_PART: Record<BillingCheckoutBandKey, string> = {
  users_1_3: '1_3',
  users_4_10: '4_10',
  users_11_25: '11_25',
  users_26_50: '26_50',
}

const SKU_TO_BAND: Record<string, BillingCheckoutBandKey> = {
  '1_3': 'users_1_3',
  '4_10': 'users_4_10',
  '11_25': 'users_11_25',
  '26_50': 'users_26_50',
}

export function isBillingCheckoutSku(value: string | null | undefined): value is BillingCheckoutSku {
  return (BILLING_CHECKOUT_SKUS as readonly string[]).includes(String(value ?? ''))
}

export function isLegacyBillingPlanKey(value: string | null | undefined): value is LegacyBillingPlanKey {
  return value === 'essential' || value === 'professional'
}

export function isKnownPlanKey(value: string | null | undefined): boolean {
  return isLegacyBillingPlanKey(value) || isBillingCheckoutSku(value)
}

export function razorpayPlanEnvName(sku: string): string {
  return `RAZORPAY_PLAN_${sku.toUpperCase()}`
}

export function checkoutSkuFor(
  product: BillingProductKey,
  band: BillingCheckoutBandKey,
  interval: BillingInterval,
): BillingCheckoutSku | null {
  if (product !== 'alza_flow') return null
  return `flow_${BAND_SKU_PART[band]}_${interval}` as BillingCheckoutSku
}

export function razorpayTotalCount(interval: BillingInterval): number {
  return interval === 'annual' ? 10 : 120
}

export function parseCheckoutSku(sku: string | null | undefined): {
  product: BillingProductKey
  userBand: BillingCheckoutBandKey
  interval: BillingInterval
} | null {
  const v = String(sku ?? '').trim().toLowerCase()
  const match = /^flow_(1_3|4_10|11_25|26_50)_(monthly|annual)$/.exec(v)
  if (!match) return null
  const userBand = SKU_TO_BAND[match[1]]
  if (!userBand) return null
  return { product: 'alza_flow', userBand, interval: match[2] as BillingInterval }
}

export function parseCheckoutSelection(body: Record<string, unknown>):
  | {
      sku: BillingCheckoutSku
      product: BillingProductKey
      userBand: BillingCheckoutBandKey
      interval: BillingInterval
    }
  | { error: string } {
  const planRaw = typeof body.plan === 'string' ? body.plan.trim().toLowerCase() : ''
  if (planRaw === 'essential' || planRaw === 'professional') {
    return {
      error:
        'Essential and Professional plans are no longer available for new subscriptions. Choose ALZA Flow.',
    }
  }

  const productRaw =
    typeof body.product === 'string' ? body.product.trim().toLowerCase() : planRaw.startsWith('flow_') ? 'alza_flow' : ''
  if (productRaw === 'alza_flow_pay') {
    return { error: 'ALZA Flow Pay is Coming Soon and cannot be purchased yet.' }
  }

  const skuDirect = isBillingCheckoutSku(planRaw) ? planRaw : null
  if (skuDirect) {
    const parsed = parseCheckoutSku(skuDirect)
    if (!parsed) return { error: 'Invalid plan selection.' }
    return { sku: skuDirect, ...parsed }
  }

  const product = productRaw === 'alza_flow' ? 'alza_flow' : null
  const userBand = String(body.userBand ?? body.user_band ?? '').trim() as BillingCheckoutBandKey
  const interval = String(body.interval ?? body.billing_interval ?? '').trim() as BillingInterval
  if (
    product !== 'alza_flow' ||
    !(userBand in BAND_SKU_PART) ||
    (interval !== 'monthly' && interval !== 'annual')
  ) {
    return {
      error: 'Choose ALZA Flow with a checkout-eligible user band and Monthly or Annual billing.',
    }
  }

  const sku = checkoutSkuFor(product, userBand, interval)
  if (!sku) return { error: 'Invalid plan selection.' }
  return { sku, product, userBand, interval }
}

/**
 * Resolve Razorpay plan id from Edge secrets only.
 * Missing secret → explicit error (no fake checkout).
 */
export function resolveRazorpayPlanIdForSku(sku: BillingCheckoutSku):
  | { sku: BillingCheckoutSku; planId: string; envName: string }
  | { error: string } {
  const envName = razorpayPlanEnvName(sku)
  const planId = (Deno.env.get(envName) ?? '').trim()
  if (!planId) {
    return {
      error:
        'Online subscription activation is being finalized. Contact ALZA. (Missing server plan configuration.)',
    }
  }
  return { sku, planId, envName }
}
