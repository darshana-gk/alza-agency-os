/**
 * Billing + Support V1 foundation validators (no network / no Razorpay / no secrets).
 * Run: npx tsx scripts/validate-billing-support-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  BILLING_PRODUCTS,
  BILLING_SUPPORT_CONTACT_PATH,
  annualListValueFromMonthly,
  annualPriceFromMonthly,
  annualSavingsFromMonthly,
  canCancelSubscription,
  catalogContainsPlanSecrets,
  checkoutSkuFor,
  formatStoredPlanLabel,
  quoteBillingSelection,
  quoteCheckoutSelection,
  razorpayPlanEnvName,
  recommendUserBand,
  shouldShowSubscribe,
} from '../src/lib/billingCatalog.ts'
import { evaluateSeatEntitlement } from '../src/lib/billingEntitlements.ts'
import { canAccessPath, canAccessSupportCenter, canAccessAlzaSupportInbox } from '../src/lib/permissions.ts'

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

const root = resolve(process.cwd())

console.log('A. ALZA Flow monthly + annual ×10 + savings')
{
  assertEq(annualPriceFromMonthly(399), 3990, '1-3 annual')
  assertEq(annualListValueFromMonthly(399), 4788, '1-3 list')
  assertEq(annualSavingsFromMonthly(399), 798, '1-3 savings')
  assertEq(annualPriceFromMonthly(599), 5990, '4-10 annual')
  assertEq(annualSavingsFromMonthly(599), 1198, '4-10 savings')
  assertEq(annualPriceFromMonthly(899), 8990, '11-25 annual')
  assertEq(annualSavingsFromMonthly(899), 1798, '11-25 savings')
  assertEq(annualPriceFromMonthly(1099), 10990, '26-50 annual')
  assertEq(annualSavingsFromMonthly(1099), 2198, '26-50 savings')

  const q = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_1_3',
    interval: 'annual',
  })
  assertEq(q.amount, 3990, 'quote annual amount')
  assertEq(q.annualSavings, 798, 'quote savings')
  assert(q.summaryLines.some((l) => /2 months free/i.test(l)), '2 months free in summary')
  assert(q.checkoutEligible, '1-3 annual checkout eligible')
  assertEq(q.sku, 'flow_1_3_annual', 'sku flow_1_3_annual')
}

console.log('B. Flow Pay Coming Soon / not purchasable')
{
  const pay = BILLING_PRODUCTS.find((p) => p.key === 'alza_flow_pay')
  assert(pay?.comingSoon === true, 'Flow Pay coming soon')
  assert(pay?.purchasable === false, 'Flow Pay not purchasable')
  const q = quoteBillingSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assertEq(q.checkoutEligible, false, 'Flow Pay cannot checkout')
  assertEq(q.monthlyAmount, 499, 'Flow Pay display 499')
  const blocked = quoteCheckoutSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assert('error' in blocked, 'Flow Pay checkout selection rejected')
}

console.log('C. Legacy Essential/Professional no new checkout')
{
  const essential = formatStoredPlanLabel({ planKey: 'essential' })
  assert(essential.legacy, 'essential legacy')
  assert(/Legacy/i.test(essential.subtitle ?? ''), 'legacy subtitle')
  // create body rejection is server-side; frontend quote never offers essential
  assert(!BILLING_CHECKOUT_SKUS.some((s) => s.includes('essential')), 'no essential SKU')
}

console.log('D. Band detection + Contact/Custom')
{
  assertEq(recommendUserBand(2), 'users_1_3', '2 users → 1-3')
  assertEq(recommendUserBand(10), 'users_4_10', '10 → 4-10')
  assertEq(recommendUserBand(25), 'users_11_25', '25 → 11-25')
  assertEq(recommendUserBand(50), 'users_26_50', '50 → 26-50')
  assertEq(recommendUserBand(75), 'users_51_100', '75 → 51-100')
  assertEq(recommendUserBand(120), 'users_100_plus', '120 → 100+')

  const contact = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_51_100',
    interval: 'monthly',
  })
  assertEq(contact.checkoutEligible, false, '51-100 no checkout')
  assert(contact.contactAlza, '51-100 Contact ALZA')

  const custom = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_100_plus',
    interval: null,
  })
  assert(custom.contactAlza && custom.customPricing, '100+ custom')
  assert(BILLING_SUPPORT_CONTACT_PATH.startsWith('/support'), 'Contact ALZA → /support')
}

console.log('E. Razorpay secret names + no frontend secrets')
{
  assertEq(
    razorpayPlanEnvName('flow_1_3_monthly'),
    'RAZORPAY_PLAN_FLOW_1_3_MONTHLY',
    'env name monthly',
  )
  assertEq(
    razorpayPlanEnvName('flow_26_50_annual'),
    'RAZORPAY_PLAN_FLOW_26_50_ANNUAL',
    'env name annual',
  )
  assertEq(BILLING_CHECKOUT_SKUS.length, 8, '8 Flow checkout SKUs only')
  const catalogSrc = readFileSync(resolve(root, 'src/lib/billingCatalog.ts'), 'utf8')
  assert(!catalogContainsPlanSecrets(catalogSrc), 'catalog has no secret values')
  assert(!/["']rzp_live|["']sk_live/.test(catalogSrc), 'no embedded live keys')
}

console.log('F. Soft seat entitlement')
{
  const ok = evaluateSeatEntitlement({
    currentUserCount: 2,
    planKey: 'flow_1_3_monthly',
    addingUser: true,
  })
  assert(ok.ok && !ok.softBlock, '2→3 within 1-3 band')

  const warn = evaluateSeatEntitlement({
    currentUserCount: 3,
    planKey: 'flow_1_3_monthly',
    addingUser: true,
  })
  assert(warn.softBlock, '3→4 soft block')
  assert(/up to 3 users/i.test(warn.message ?? ''), 'soft message')
}

console.log('G. Subscribe/cancel helpers')
{
  assert(shouldShowSubscribe('incomplete'), 'show subscribe incomplete')
  assert(shouldShowSubscribe('cancelled'), 'show subscribe cancelled')
  assert(!shouldShowSubscribe('active'), 'hide subscribe active')
  assert(canCancelSubscription('active'), 'can cancel active')
  assert(checkoutSkuFor('alza_flow', 'users_4_10', 'annual') === 'flow_4_10_annual', 'sku helper')
}

console.log('H. Support RBAC + Need Help routes')
{
  assert(canAccessSupportCenter('owner'), 'owner support')
  assert(canAccessSupportCenter('csr'), 'csr support')
  assert(!canAccessAlzaSupportInbox('owner'), 'owner not alza inbox')
  assert(canAccessAlzaSupportInbox('alza_support'), 'alza inbox')
  assert(canAccessPath('owner', '/support'), 'owner /support')
  assert(canAccessPath('alza_support', '/admin/support-inbox'), 'alza inbox path')
}

console.log('I. Support source contracts')
{
  const support = readFileSync(resolve(root, 'src/lib/support.ts'), 'utf8')
  assert(support.includes('assignSupportConversation'), 'assign helper')
  assert(support.includes('unassignSupportConversation'), 'unassign helper')
  assert(support.includes('notifySupportEventBestEffort'), 'email best effort')
  assert(support.includes('ticket_reopened'), 'reopen notify event')

  const notifyFn = readFileSync(
    resolve(root, 'supabase/functions/notify-support-event/index.ts'),
    'utf8',
  )
  assert(notifyFn.includes('RESEND_API_KEY'), 'notify checks Resend')
  assert(notifyFn.includes('skipped'), 'graceful skip')

  const migration = readFileSync(
    resolve(root, 'supabase/migrations/20260826120000_billing_v2_and_support_assignment.sql'),
    'utf8',
  )
  assert(migration.includes('support_assign_conversation'), 'assign RPC in migration')
  assert(migration.includes('flow_1_3_monthly'), 'billing SKUs in migration')
  assert(migration.includes('DO NOT apply until reviewed') || migration.includes('PROPOSED'), 'migration marked proposed')
}

console.log('J. create-subscription rejects legacy / missing secret message')
{
  const createFn = readFileSync(
    resolve(root, 'supabase/functions/create-razorpay-subscription/index.ts'),
    'utf8',
  )
  assert(createFn.includes('parseCheckoutSelection'), 'uses checkout selection parser')
  assert(createFn.includes('resolveRazorpayPlanIdForSku'), 'resolves secret by SKU')
  assert(createFn.includes('plan_secret_missing') || createFn.includes('Contact ALZA'), 'missing secret message')
  assert(!createFn.includes('body.amount'), 'browser amount not used')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-billing-support-v1: ALL GREEN')
