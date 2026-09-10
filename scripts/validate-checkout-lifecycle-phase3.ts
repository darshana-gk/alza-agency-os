/**
 * Phase 3 — checkout resume + onboarding handoff (offline).
 * Does NOT call Razorpay. Does NOT touch Production.
 *
 * Run: npx tsx scripts/validate-checkout-lifecycle-phase3.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  allowsNewCheckout,
  billingCatalogPrimaryAction,
  billingCheckoutCtaCopy,
  canChangePlanBeforeCheckout,
  canResumeCheckout,
  parseCheckoutSku,
  quoteBillingSelection,
} from '../src/lib/billingCatalog.ts'

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

console.log('A. Resume eligibility matrix')
{
  assert(canResumeCheckout('created', 'sub_TEST123'), 'created + sub_id can resume')
  assert(!canResumeCheckout('created', null), 'created without sub_id cannot resume')
  assert(!canResumeCheckout('created', ''), 'created empty sub_id cannot resume')
  assert(!canResumeCheckout('incomplete', 'sub_TEST123'), 'incomplete cannot resume')
  assert(!canResumeCheckout('active', 'sub_TEST123'), 'active cannot resume')
  assert(!canResumeCheckout('cancelled', 'sub_TEST123'), 'cancelled cannot resume')
  assert(!canResumeCheckout('authenticated', 'sub_TEST123'), 'authenticated does not use Resume CTA')
  assert(!allowsNewCheckout('created'), 'created blocks new checkout')
  assert(allowsNewCheckout('incomplete'), 'incomplete allows new checkout')
  assert(!allowsNewCheckout('active'), 'active blocks new checkout')
}

console.log('B. Primary CTA resume vs subscribe')
{
  const resume = billingCatalogPrimaryAction({
    status: 'created',
    planKey: 'flow_1_3_monthly',
    product: 'alza_flow',
    checkoutEligible: true,
    contactAlza: false,
    productKey: 'alza_flow',
    userBandKey: 'users_1_3',
    billingInterval: 'monthly',
    selectedUserBand: 'users_1_3',
    selectedInterval: 'monthly',
    razorpaySubscriptionId: 'sub_TEST123',
  })
  assertEq(resume, 'resume', 'created same plan → resume CTA')

  const resumeCopy = billingCheckoutCtaCopy({
    status: 'created',
    planKey: 'flow_1_3_monthly',
    productKey: 'alza_flow',
    userBandKey: 'users_1_3',
    billingInterval: 'monthly',
    selectedProduct: 'alza_flow',
    selectedUserBand: 'users_1_3',
    selectedInterval: 'monthly',
    razorpaySubscriptionId: 'sub_TEST123',
  })
  assertEq(resumeCopy, 'Resume Payment', 'CTA copy Resume Payment')

  const incomplete = billingCatalogPrimaryAction({
    status: 'incomplete',
    planKey: 'flow_1_3_monthly',
    product: 'alza_flow',
    checkoutEligible: true,
    contactAlza: false,
    selectedUserBand: 'users_1_3',
    selectedInterval: 'monthly',
    razorpaySubscriptionId: null,
  })
  assertEq(incomplete, 'subscribe', 'incomplete → subscribe')

  const activeSame = billingCatalogPrimaryAction({
    status: 'active',
    planKey: 'flow_1_3_monthly',
    product: 'alza_flow',
    checkoutEligible: true,
    contactAlza: false,
    productKey: 'alza_flow',
    userBandKey: 'users_1_3',
    billingInterval: 'monthly',
    selectedUserBand: 'users_1_3',
    selectedInterval: 'monthly',
    razorpaySubscriptionId: 'sub_LIVE',
  })
  assertEq(activeSame, null, 'active same plan → no purchase CTA')
}

console.log('C. Plan change lock once created')
{
  assert(canChangePlanBeforeCheckout('incomplete'), 'incomplete can change plan')
  assert(!canChangePlanBeforeCheckout('created'), 'created locks plan')
  assert(!canChangePlanBeforeCheckout('active'), 'active locks plan')
  assert(canChangePlanBeforeCheckout('cancelled'), 'cancelled can change plan')
}

console.log('D. All 8 SKU mappings unchanged')
{
  const expectedAmounts: Record<string, number> = {
    flow_1_3_monthly: 399,
    flow_1_3_annual: 3990,
    flow_4_10_monthly: 599,
    flow_4_10_annual: 5990,
    flow_11_25_monthly: 899,
    flow_11_25_annual: 8990,
    flow_26_50_monthly: 1099,
    flow_26_50_annual: 10990,
  }
  for (const sku of BILLING_CHECKOUT_SKUS) {
    const parsed = parseCheckoutSku(sku)!
    const q = quoteBillingSelection(parsed)
    assertEq(q.sku, sku, `${sku} sku`)
    assertEq(q.amount, expectedAmounts[sku], `${sku} amount`)
    assert(q.checkoutEligible, `${sku} checkout eligible`)
  }
}

console.log('E. Contact / Flow Pay rejected')
{
  for (const band of ['users_51_100', 'users_100_plus'] as const) {
    const q = quoteBillingSelection({
      product: 'alza_flow',
      userBand: band,
      interval: 'monthly',
    })
    assertEq(q.checkoutEligible, false, `${band} not checkout`)
    assertEq(q.sku, null, `${band} no sku`)
  }
  const pay = quoteBillingSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assertEq(pay.checkoutEligible, false, 'Flow Pay not checkout')
}

console.log('F. Wiring present')
{
  const root = resolve(process.cwd())
  const billingPage = readFileSync(resolve(root, 'src/pages/admin/SubscriptionBilling.tsx'), 'utf8')
  const billingLib = readFileSync(resolve(root, 'src/lib/billing.ts'), 'utf8')
  const resumeFn = resolve(root, 'supabase/functions/resume-razorpay-checkout/index.ts')
  const createFn = readFileSync(
    resolve(root, 'supabase/functions/create-razorpay-subscription/index.ts'),
    'utf8',
  )
  const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8')
  assert(existsSync(resumeFn), 'resume-razorpay-checkout function exists')
  assert(config.includes('resume-razorpay-checkout'), 'config.toml registers resume function')
  assert(billingLib.includes('resume-razorpay-checkout'), 'billing.ts invokes resume')
  assert(billingPage.includes('Resume Payment'), 'Billing shows Resume Payment')
  assert(billingPage.includes('Start Onboarding'), 'Billing has Start Onboarding')
  assert(billingPage.includes("navigate('/onboarding'"), 'Billing navigates to onboarding when active')
  assert(billingPage.includes('handleResumePayment'), 'Billing has resume handler')
  assert(createFn.includes('live_key_blocked') || createFn.includes('LIVE Razorpay'), 'create LIVE refused on staging')
  assert(createFn.includes('alza-flow-staging') || createFn.includes('stagingHost'), 'create LIVE guard is staging-scoped')
  const resumeSrc = readFileSync(resumeFn, 'utf8')
  assert(resumeSrc.includes('Never creates') || resumeSrc.includes('Never creates a new'), 'resume docs no create')
  assert(
    resumeSrc.includes('never from the client') || resumeSrc.includes('Never trusts client'),
    'resume ignores client sub id',
  )
  assert(resumeSrc.includes('rzp_test_'), 'resume requires TEST key on staging')
}

console.log('')
console.log(`Phase 3 checkout lifecycle: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
