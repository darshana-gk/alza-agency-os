/**
 * Phase 2 — public pricing + plan_key intent preservation (offline).
 * Does NOT call Razorpay. Does NOT touch Production.
 *
 * Run: npx tsx scripts/validate-pricing-intent-phase2.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  billingUserBands,
  checkoutSkuFor,
  parseCheckoutSku,
  quoteBillingSelection,
  recommendUserBand,
} from '../src/lib/billingCatalog.ts'
import {
  billingPathForPlan,
  purchaseIntentFromSearchParams,
  resolvePurchaseIntent,
  signupPathForPlan,
} from '../src/lib/purchaseIntent.ts'

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

function assertEq<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (got ${String(actual)}, expected ${String(expected)})`)
}

const EXPECTED: Record<
  string,
  { band: string; interval: string; amount: number; display: string }
> = {
  flow_1_3_monthly: { band: 'users_1_3', interval: 'monthly', amount: 399, display: '$399 / month' },
  flow_1_3_annual: { band: 'users_1_3', interval: 'annual', amount: 3990, display: '$3,990 / year' },
  flow_4_10_monthly: { band: 'users_4_10', interval: 'monthly', amount: 599, display: '$599 / month' },
  flow_4_10_annual: { band: 'users_4_10', interval: 'annual', amount: 5990, display: '$5,990 / year' },
  flow_11_25_monthly: {
    band: 'users_11_25',
    interval: 'monthly',
    amount: 899,
    display: '$899 / month',
  },
  flow_11_25_annual: {
    band: 'users_11_25',
    interval: 'annual',
    amount: 8990,
    display: '$8,990 / year',
  },
  flow_26_50_monthly: {
    band: 'users_26_50',
    interval: 'monthly',
    amount: 1099,
    display: '$1,099 / month',
  },
  flow_26_50_annual: {
    band: 'users_26_50',
    interval: 'annual',
    amount: 10990,
    display: '$10,990 / year',
  },
}

console.log('A. All 8 SKU prices + plan_key round-trip')
{
  assertEq(BILLING_CHECKOUT_SKUS.length, 8, 'exactly 8 checkout SKUs')
  for (const sku of BILLING_CHECKOUT_SKUS) {
    const expected = EXPECTED[sku]
    assert(Boolean(expected), `${sku} expected table`)
    const parsed = parseCheckoutSku(sku)
    assert(parsed != null, `${sku} parses`)
    assertEq(parsed!.userBand, expected.band as typeof parsed.userBand, `${sku} band`)
    assertEq(parsed!.interval, expected.interval as typeof parsed.interval, `${sku} interval`)
    const rebuilt = checkoutSkuFor(parsed!.product, parsed!.userBand, parsed!.interval)
    assertEq(rebuilt, sku, `${sku} rebuilds`)
    const quote = quoteBillingSelection({
      product: 'alza_flow',
      userBand: parsed!.userBand,
      interval: parsed!.interval,
    })
    assertEq(quote.sku, sku, `${sku} quote.sku`)
    assertEq(quote.amount, expected.amount, `${sku} amount`)
    assertEq(quote.displayPrice, expected.display, `${sku} displayPrice`)
    assert(quote.checkoutEligible, `${sku} checkout eligible`)

    const fromKey = resolvePurchaseIntent({ planKey: sku })
    assertEq(fromKey?.planKey, sku, `${sku} resolve from plan_key`)
    assertEq(fromKey?.userBand, expected.band, `${sku} resolve band`)
    assertEq(fromKey?.interval, expected.interval, `${sku} resolve interval`)

    const params = new URLSearchParams(`plan_key=${sku}`)
    const fromParams = purchaseIntentFromSearchParams(params)
    assertEq(fromParams?.planKey, sku, `${sku} from search params`)

    assertEq(signupPathForPlan(sku), `/signup?plan_key=${sku}`, `${sku} signup path`)
    assertEq(
      billingPathForPlan(sku),
      `/admin/subscription-billing?plan_key=${sku}`,
      `${sku} billing path`,
    )
  }
}

console.log('B. Contact-only bands never yield checkout plan_key')
{
  for (const band of ['users_51_100', 'users_100_plus'] as const) {
    for (const interval of ['monthly', 'annual'] as const) {
      const q = quoteBillingSelection({ product: 'alza_flow', userBand: band, interval })
      assertEq(q.sku, null, `${band} ${interval} no sku`)
      assertEq(q.checkoutEligible, false, `${band} ${interval} not checkout`)
      assert(q.contactAlza, `${band} ${interval} contact ALZA`)
    }
  }
  const pay = quoteBillingSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assertEq(pay.sku, null, 'Flow Pay no sku')
  assertEq(pay.checkoutEligible, false, 'Flow Pay not checkout')
  assertEq(pay.displayPrice, 'Coming Soon', 'Flow Pay Coming Soon')
}

console.log('C. Explicit intent beats recommendUserBand')
{
  // Owner-only agency with 1 user would recommend 1–3; explicit 11–25 annual must win.
  const recommended = recommendUserBand(1)
  assertEq(recommended, 'users_1_3', 'recommend for 1 user is 1–3')
  const explicit = resolvePurchaseIntent({ planKey: 'flow_11_25_annual' })
  assert(explicit != null, 'explicit intent resolves')
  assertEq(explicit!.userBand, 'users_11_25', 'explicit band is 11–25 not recommended')
  assertEq(explicit!.interval, 'annual', 'explicit annual')
  assert(explicit!.userBand !== recommended, 'explicit differs from recommendation')
}

console.log('D. Pricing page + App route wiring present')
{
  const root = resolve(process.cwd())
  const pricing = readFileSync(resolve(root, 'src/pages/Pricing.tsx'), 'utf8')
  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
  const signup = readFileSync(resolve(root, 'src/pages/Signup.tsx'), 'utf8')
  const billing = readFileSync(resolve(root, 'src/pages/admin/SubscriptionBilling.tsx'), 'utf8')
  assert(existsSync(resolve(root, 'src/pages/Pricing.tsx')), 'Pricing.tsx exists')
  assert(app.includes('/pricing') && app.includes('PricingPage'), 'App routes /pricing')
  assert(pricing.includes('Get Started'), 'Pricing has Get Started')
  assert(pricing.includes('Coming Soon'), 'Pricing Flow Pay Coming Soon')
  assert(pricing.includes('Contact ALZA'), 'Pricing Contact ALZA')
  assert(pricing.includes('Waitlist only'), 'Flow Pay waitlist only')
  assert(signup.includes('purchaseIntentFromSearchParams'), 'Signup uses purchase intent')
  assert(signup.includes('plan_key'), 'Signup preserves plan_key to billing')
  assert(billing.includes('purchaseIntentFromSearchParams'), 'Billing hydrates plan_key')
  assert(billing.includes('resolvePurchaseIntent'), 'Billing uses stored plan_key')
  const bands = billingUserBands('alza_flow')
  assertEq(bands.filter((b) => b.checkoutEligible).length, 4, '4 self-serve bands')
  assertEq(bands.filter((b) => b.contactAlza).length, 2, '2 contact bands')
}

console.log('')
console.log(`Phase 2 pricing intent: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
