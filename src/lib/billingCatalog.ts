/**
 * ALZA Flow Subscription & Billing catalog (display/selection).
 * Razorpay Plan IDs are NEVER stored here — only logical plan keys / SKUs.
 */

export type BillingProductKey = 'alza_flow' | 'alza_flow_pay'

export type BillingUserBandKey =
  | 'users_1_3'
  | 'users_4_10'
  | 'users_11_25'
  | 'users_26_50'
  | 'users_51_100'
  | 'users_100_plus'

export type BillingInterval = 'monthly' | 'annual'

/** Server-side logical plan keys for ALZA Flow checkout only (not Flow Pay). */
export type BillingCheckoutSku =
  | 'flow_1_3_monthly'
  | 'flow_1_3_annual'
  | 'flow_4_10_monthly'
  | 'flow_4_10_annual'
  | 'flow_11_25_monthly'
  | 'flow_11_25_annual'
  | 'flow_26_50_monthly'
  | 'flow_26_50_annual'

export type LegacyBillingPlanKey = 'essential' | 'professional'

export type BillingCheckoutBandKey = Extract<
  BillingUserBandKey,
  'users_1_3' | 'users_4_10' | 'users_11_25' | 'users_26_50'
>

export interface BillingProductOption {
  key: BillingProductKey
  name: string
  startsAtMonthly: number
  startsAtLabel: string
  comingSoon: boolean
  purchasable: boolean
}

export interface BillingUserBandOption {
  key: BillingUserBandKey
  label: string
  /** Soft seat upper bound when known (null for custom). */
  includedUsersMax: number | null
  checkoutEligible: boolean
  customPricing: boolean
  monthly: number | null
  annual: number | null
  plusPricing: boolean
  contactAlza: boolean
}

export interface BillingPriceQuote {
  product: BillingProductKey
  productName: string
  userBand: BillingUserBandKey
  bandLabel: string
  interval: BillingInterval | null
  sku: BillingCheckoutSku | null
  checkoutEligible: boolean
  customPricing: boolean
  plusPricing: boolean
  contactAlza: boolean
  amount: number | null
  monthlyAmount: number | null
  annualAmount: number | null
  annualListValue: number | null
  annualSavings: number | null
  displayPrice: string
  intervalLabel: string
  summaryLines: string[]
}

const BAND_SKU_PART: Record<BillingCheckoutBandKey, string> = {
  users_1_3: '1_3',
  users_4_10: '4_10',
  users_11_25: '11_25',
  users_26_50: '26_50',
}

export const BILLING_PRODUCTS: BillingProductOption[] = [
  {
    key: 'alza_flow',
    name: 'ALZA Flow',
    startsAtMonthly: 399,
    startsAtLabel: 'Starts at $399/month',
    comingSoon: false,
    purchasable: true,
  },
  {
    key: 'alza_flow_pay',
    name: 'ALZA Flow Pay',
    startsAtMonthly: 499,
    startsAtLabel: 'Starts at $499/month',
    comingSoon: true,
    purchasable: false,
  },
]

const FLOW_BANDS: BillingUserBandOption[] = [
  {
    key: 'users_1_3',
    label: '1–3 users',
    includedUsersMax: 3,
    checkoutEligible: true,
    customPricing: false,
    monthly: 399,
    annual: 3990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_4_10',
    label: '4–10 users',
    includedUsersMax: 10,
    checkoutEligible: true,
    customPricing: false,
    monthly: 599,
    annual: 5990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_11_25',
    label: '11–25 users',
    includedUsersMax: 25,
    checkoutEligible: true,
    customPricing: false,
    monthly: 899,
    annual: 8990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_26_50',
    label: '26–50 users',
    includedUsersMax: 50,
    checkoutEligible: true,
    customPricing: false,
    monthly: 1099,
    annual: 10990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_51_100',
    label: '51–100 users',
    includedUsersMax: 100,
    checkoutEligible: false,
    customPricing: true,
    monthly: 1499,
    annual: null,
    plusPricing: true,
    contactAlza: true,
  },
  {
    key: 'users_100_plus',
    label: '100+ / complex',
    includedUsersMax: null,
    checkoutEligible: false,
    customPricing: true,
    monthly: null,
    annual: null,
    plusPricing: false,
    contactAlza: true,
  },
]

/** Display-only Flow Pay bands — never checkoutEligible. */
const FLOW_PAY_BANDS: BillingUserBandOption[] = [
  {
    key: 'users_1_3',
    label: '1–3 users',
    includedUsersMax: 3,
    checkoutEligible: false,
    customPricing: false,
    monthly: 499,
    annual: 4990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_4_10',
    label: '4–10 users',
    includedUsersMax: 10,
    checkoutEligible: false,
    customPricing: false,
    monthly: 699,
    annual: 6990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_11_25',
    label: '11–25 users',
    includedUsersMax: 25,
    checkoutEligible: false,
    customPricing: false,
    monthly: 999,
    annual: 9990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_26_50',
    label: '26–50 users',
    includedUsersMax: 50,
    checkoutEligible: false,
    customPricing: false,
    monthly: 1299,
    annual: 12990,
    plusPricing: false,
    contactAlza: false,
  },
  {
    key: 'users_51_100',
    label: '51–100 users',
    includedUsersMax: 100,
    checkoutEligible: false,
    customPricing: true,
    monthly: 1799,
    annual: null,
    plusPricing: true,
    contactAlza: true,
  },
  {
    key: 'users_100_plus',
    label: '100+ / complex',
    includedUsersMax: null,
    checkoutEligible: false,
    customPricing: true,
    monthly: null,
    annual: null,
    plusPricing: false,
    contactAlza: true,
  },
]

export const BILLING_INTERVALS: { key: BillingInterval; label: string }[] = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'annual', label: 'Annual' },
]

export const BILLING_CHECKOUT_SKUS: BillingCheckoutSku[] = [
  'flow_1_3_monthly',
  'flow_1_3_annual',
  'flow_4_10_monthly',
  'flow_4_10_annual',
  'flow_11_25_monthly',
  'flow_11_25_annual',
  'flow_26_50_monthly',
  'flow_26_50_annual',
]

export const BILLING_SUPPORT_CONTACT_PATH = '/support?category=billing_subscription&subject=Subscription%20inquiry'

export function formatUsdWhole(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Annual rule: 2 months free / pay for 10 months. */
export function annualPriceFromMonthly(monthly: number): number {
  return monthly * 10
}

export function annualListValueFromMonthly(monthly: number): number {
  return monthly * 12
}

export function annualSavingsFromMonthly(
  monthly: number,
  annual = annualPriceFromMonthly(monthly),
): number {
  return annualListValueFromMonthly(monthly) - annual
}

export function isBillingProductKey(value: string | null | undefined): value is BillingProductKey {
  return value === 'alza_flow' || value === 'alza_flow_pay'
}

export function isBillingUserBandKey(value: string | null | undefined): value is BillingUserBandKey {
  return (
    value === 'users_1_3' ||
    value === 'users_4_10' ||
    value === 'users_11_25' ||
    value === 'users_26_50' ||
    value === 'users_51_100' ||
    value === 'users_100_plus'
  )
}

export function isBillingCheckoutBandKey(
  value: string | null | undefined,
): value is BillingCheckoutBandKey {
  return (
    value === 'users_1_3' ||
    value === 'users_4_10' ||
    value === 'users_11_25' ||
    value === 'users_26_50'
  )
}

export function isBillingInterval(value: string | null | undefined): value is BillingInterval {
  return value === 'monthly' || value === 'annual'
}

export function isBillingCheckoutSku(value: string | null | undefined): value is BillingCheckoutSku {
  return (BILLING_CHECKOUT_SKUS as string[]).includes(String(value ?? ''))
}

export function isLegacyBillingPlanKey(value: string | null | undefined): value is LegacyBillingPlanKey {
  return value === 'essential' || value === 'professional'
}

export function billingProductName(key: BillingProductKey | string | null | undefined): string {
  if (key === 'alza_flow_pay') return 'ALZA Flow Pay'
  if (key === 'alza_flow') return 'ALZA Flow'
  return 'ALZA Flow'
}

export function billingUserBands(product: BillingProductKey): BillingUserBandOption[] {
  return product === 'alza_flow_pay' ? FLOW_PAY_BANDS : FLOW_BANDS
}

export function billingUserBand(
  product: BillingProductKey,
  band: BillingUserBandKey,
): BillingUserBandOption | null {
  return billingUserBands(product).find((item) => item.key === band) ?? null
}

export function recommendUserBand(userCount: number): BillingUserBandKey {
  const n = Number.isFinite(userCount) ? Math.max(0, Math.floor(userCount)) : 0
  if (n <= 3) return 'users_1_3'
  if (n <= 10) return 'users_4_10'
  if (n <= 25) return 'users_11_25'
  if (n <= 50) return 'users_26_50'
  if (n <= 100) return 'users_51_100'
  return 'users_100_plus'
}

export function checkoutSkuFor(
  product: BillingProductKey,
  band: BillingCheckoutBandKey,
  interval: BillingInterval,
): BillingCheckoutSku | null {
  if (product !== 'alza_flow') return null
  return `flow_${BAND_SKU_PART[band]}_${interval}` as BillingCheckoutSku
}

/** Expected Edge secret name — values never in frontend. */
export function razorpayPlanEnvName(sku: BillingCheckoutSku | string): string {
  return `RAZORPAY_PLAN_${String(sku).toUpperCase()}`
}

export function parseCheckoutSku(sku: string | null | undefined): {
  product: BillingProductKey
  userBand: BillingCheckoutBandKey
  interval: BillingInterval
} | null {
  const v = String(sku ?? '').trim().toLowerCase()
  const match = /^flow_(1_3|4_10|11_25|26_50)_(monthly|annual)$/.exec(v)
  if (!match) return null
  const part = match[1]
  const userBand = (
    Object.entries(BAND_SKU_PART).find(([, p]) => p === part)?.[0] ?? null
  ) as BillingCheckoutBandKey | null
  if (!userBand) return null
  return {
    product: 'alza_flow',
    userBand,
    interval: match[2] as BillingInterval,
  }
}

export function quoteBillingSelection(input: {
  product: BillingProductKey
  userBand: BillingUserBandKey
  interval: BillingInterval | null
}): BillingPriceQuote {
  const productName = billingProductName(input.product)
  const band = billingUserBand(input.product, input.userBand)
  const bandLabel = band?.label ?? input.userBand
  const customPricing = Boolean(band?.customPricing)
  const plusPricing = Boolean(band?.plusPricing)
  const contactAlza = Boolean(band?.contactAlza)
  const monthlyAmount = band?.monthly ?? null
  const annualAmount =
    band?.annual ??
    (monthlyAmount != null && !band?.contactAlza ? annualPriceFromMonthly(monthlyAmount) : null)

  if (!band || input.userBand === 'users_100_plus') {
    return {
      product: input.product,
      productName,
      userBand: input.userBand,
      bandLabel,
      interval: null,
      sku: null,
      checkoutEligible: false,
      customPricing: true,
      plusPricing: false,
      contactAlza: true,
      amount: null,
      monthlyAmount: null,
      annualAmount: null,
      annualListValue: null,
      annualSavings: null,
      displayPrice: 'Custom pricing',
      intervalLabel: '',
      summaryLines: ['Custom pricing', 'Contact ALZA'],
    }
  }

  if (input.product === 'alza_flow_pay') {
    const interval = input.interval
    const amount =
      interval === 'annual'
        ? annualAmount
        : interval === 'monthly'
          ? monthlyAmount
          : monthlyAmount
    const plus = plusPricing ? '+' : ''
    return {
      product: input.product,
      productName,
      userBand: input.userBand,
      bandLabel,
      interval,
      sku: null,
      checkoutEligible: false,
      customPricing,
      plusPricing,
      contactAlza,
      amount,
      monthlyAmount,
      annualAmount,
      annualListValue: monthlyAmount != null ? annualListValueFromMonthly(monthlyAmount) : null,
      annualSavings:
        monthlyAmount != null && annualAmount != null
          ? annualSavingsFromMonthly(monthlyAmount, annualAmount)
          : null,
      displayPrice: contactAlza
        ? `${formatUsdWhole(monthlyAmount ?? 0)}${plus}/mo · Contact ALZA`
        : amount == null
          ? 'Coming Soon'
          : interval === 'annual'
            ? `${formatUsdWhole(amount)}${plus}/year`
            : `${formatUsdWhole(amount)}${plus}/month`,
      intervalLabel: interval === 'annual' ? 'Annual' : interval === 'monthly' ? 'Monthly' : '',
      summaryLines: contactAlza
        ? ['Coming Soon', 'Contact ALZA']
        : ['Coming Soon', 'Not purchasable yet'],
    }
  }

  if (contactAlza || input.userBand === 'users_51_100') {
    return {
      product: input.product,
      productName,
      userBand: input.userBand,
      bandLabel,
      interval: input.interval,
      sku: null,
      checkoutEligible: false,
      customPricing: true,
      plusPricing,
      contactAlza: true,
      amount: null,
      monthlyAmount,
      annualAmount: null,
      annualListValue: monthlyAmount != null ? annualListValueFromMonthly(monthlyAmount) : null,
      annualSavings: null,
      displayPrice: `${formatUsdWhole(monthlyAmount ?? 0)}${plusPricing ? '+' : ''}/mo · Contact ALZA`,
      intervalLabel: input.interval === 'annual' ? 'Annual' : input.interval === 'monthly' ? 'Monthly' : '',
      summaryLines: ['Contact ALZA', 'Online checkout not available for this band'],
    }
  }

  const interval = input.interval
  const sku =
    isBillingCheckoutBandKey(input.userBand) && interval && band.checkoutEligible
      ? checkoutSkuFor('alza_flow', input.userBand, interval)
      : null
  const checkoutEligible = Boolean(sku && band.checkoutEligible && interval)

  if (!interval) {
    const starting = monthlyAmount
      ? `${formatUsdWhole(monthlyAmount)}${plusPricing ? '+' : ''}/month`
      : 'Custom pricing'
    return {
      product: input.product,
      productName,
      userBand: input.userBand,
      bandLabel,
      interval: null,
      sku: null,
      checkoutEligible: false,
      customPricing,
      plusPricing,
      contactAlza,
      amount: null,
      monthlyAmount,
      annualAmount,
      annualListValue: monthlyAmount != null ? annualListValueFromMonthly(monthlyAmount) : null,
      annualSavings:
        monthlyAmount != null && annualAmount != null
          ? annualSavingsFromMonthly(monthlyAmount, annualAmount)
          : null,
      displayPrice: starting,
      intervalLabel: '',
      summaryLines: [starting],
    }
  }

  const amount = interval === 'annual' ? annualAmount : monthlyAmount
  const plus = plusPricing ? '+' : ''
  const intervalLabel = interval === 'annual' ? 'year' : 'month'
  const displayPrice = amount == null ? 'Custom pricing' : `${formatUsdWhole(amount)}${plus}/${intervalLabel}`
  const listValue = monthlyAmount != null ? annualListValueFromMonthly(monthlyAmount) : null
  const savings =
    interval === 'annual' && monthlyAmount != null && annualAmount != null
      ? annualSavingsFromMonthly(monthlyAmount, annualAmount)
      : null

  const summaryLines: string[] = []
  if (amount == null) {
    summaryLines.push('Contact ALZA')
  } else if (interval === 'annual') {
    summaryLines.push(displayPrice)
    if (listValue != null) summaryLines.push(`12-month value ${formatUsdWhole(listValue)}`)
    if (savings != null) summaryLines.push(`Save ${formatUsdWhole(savings)}`)
    summaryLines.push('2 months free')
  } else {
    summaryLines.push(displayPrice)
  }

  return {
    product: input.product,
    productName,
    userBand: input.userBand,
    bandLabel,
    interval,
    sku,
    checkoutEligible,
    customPricing,
    plusPricing,
    contactAlza,
    amount,
    monthlyAmount,
    annualAmount,
    annualListValue: listValue,
    annualSavings: savings,
    displayPrice,
    intervalLabel: interval === 'annual' ? 'Annual' : 'Monthly',
    summaryLines,
  }
}

export function quoteCheckoutSelection(input: {
  product: BillingProductKey
  userBand: BillingUserBandKey
  interval: BillingInterval
}): BillingPriceQuote | { error: string } {
  if (input.product === 'alza_flow_pay') {
    return { error: 'ALZA Flow Pay is Coming Soon and cannot be purchased yet.' }
  }
  if (isLegacyBillingPlanKey(input.product as string)) {
    return { error: 'Legacy Essential/Professional plans are not available for new checkout.' }
  }
  const quote = quoteBillingSelection(input)
  if (!quote.checkoutEligible || !quote.sku) {
    return {
      error: quote.contactAlza
        ? 'This user band requires Contact ALZA. Online checkout is not available.'
        : 'Choose ALZA Flow, a checkout-eligible user band, and Monthly or Annual billing.',
    }
  }
  return quote
}

export function formatStoredPlanLabel(input: {
  planKey?: string | null
  productKey?: string | null
  userBandKey?: string | null
  billingInterval?: string | null
}): { title: string; subtitle: string | null; intervalLabel: string; legacy: boolean } {
  if (input.planKey === 'essential') {
    return {
      title: 'ALZA FLOW Essential',
      subtitle: 'Legacy plan',
      intervalLabel: 'Monthly',
      legacy: true,
    }
  }
  if (input.planKey === 'professional') {
    return {
      title: 'ALZA FLOW Professional',
      subtitle: 'Legacy plan',
      intervalLabel: 'Monthly',
      legacy: true,
    }
  }

  const parsed = parseCheckoutSku(input.planKey)
  const productKey = isBillingProductKey(input.productKey)
    ? input.productKey
    : parsed?.product ?? null
  const userBandKey = isBillingUserBandKey(input.userBandKey)
    ? input.userBandKey
    : parsed?.userBand ?? null
  const interval = isBillingInterval(input.billingInterval)
    ? input.billingInterval
    : parsed?.interval ?? null

  if (productKey && userBandKey) {
    const band = billingUserBand(productKey, userBandKey)
    return {
      title: billingProductName(productKey),
      subtitle: band?.label ?? null,
      intervalLabel: interval === 'annual' ? 'Annual' : interval === 'monthly' ? 'Monthly' : '—',
      legacy: false,
    }
  }

  return {
    title: 'ALZA Flow',
    subtitle: null,
    intervalLabel: interval === 'annual' ? 'Annual' : interval === 'monthly' ? 'Monthly' : '—',
    legacy: false,
  }
}

export function shouldShowSubscribe(status: string | null | undefined): boolean {
  const v = (status ?? '').trim().toLowerCase()
  return (
    !v ||
    v === 'incomplete' ||
    v === 'cancelled' ||
    v === 'canceled' ||
    v === 'completed' ||
    v === 'halted'
  )
}

export function canCancelSubscription(status: string | null | undefined): boolean {
  const v = (status ?? '').trim().toLowerCase()
  return (
    v === 'authenticated' ||
    v === 'active' ||
    v === 'pending' ||
    v === 'paused' ||
    v === 'created'
  )
}

/** Legacy Essential/Professional with a live (or pending) Razorpay subscription. */
export function isLegacyActiveSubscription(
  planKey: string | null | undefined,
  status: string | null | undefined,
): boolean {
  return isLegacyBillingPlanKey(planKey) && !shouldShowSubscribe(status)
}

/**
 * New Razorpay checkout is only for agencies without a blocking subscription.
 * Legacy-active must never start a second subscription from the catalog.
 */
export function allowsNewCheckout(
  status: string | null | undefined,
  planKey?: string | null,
): boolean {
  if (!shouldShowSubscribe(status)) return false
  if (isLegacyBillingPlanKey(planKey)) return false
  return true
}

export const BILLING_UPGRADE_CONTACT_PATH =
  '/support?category=billing_subscription&subject=Upgrade%20from%20legacy%20plan'

export type BillingCatalogPrimaryAction = 'subscribe' | 'upgrade_contact' | 'contact_alza' | null

/** Catalog stays visible; this only decides the safe primary CTA. */
export function billingCatalogPrimaryAction(input: {
  status: string | null | undefined
  planKey: string | null | undefined
  product: BillingProductKey
  checkoutEligible: boolean
  contactAlza: boolean
}): BillingCatalogPrimaryAction {
  const legacyActive = isLegacyActiveSubscription(input.planKey, input.status)
  if (legacyActive) {
    return 'upgrade_contact'
  }
  if (!allowsNewCheckout(input.status, input.planKey)) {
    return input.product === 'alza_flow_pay' || input.contactAlza ? 'contact_alza' : null
  }
  if (input.product === 'alza_flow_pay' || input.contactAlza) return 'contact_alza'
  if (input.product === 'alza_flow' && input.checkoutEligible) return 'subscribe'
  return null
}

/** V2 catalog is always shown to Owner/Admin (not gated on subscribe eligibility). */
export function shouldShowBillingCatalog(): boolean {
  return true
}

/** Frontend must never contain secret-like plan id fields. */
export function catalogContainsPlanSecrets(catalogJson: string): boolean {
  return /["']rzp_|["']sk_live|razorpay_plan_id\s*[:=]\s*["'][^"']+["']/i.test(catalogJson)
}
