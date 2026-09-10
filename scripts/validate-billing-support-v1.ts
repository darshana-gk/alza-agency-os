/**
 * Billing + Support V1 foundation validators (no network / no Razorpay / no secrets).
 * Run: npx tsx scripts/validate-billing-support-v1.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  BILLING_PRODUCTS,
  BILLING_SUPPORT_CONTACT_PATH,
  annualListValueFromMonthly,
  annualPriceFromMonthly,
  annualSavingsFromMonthly,
  allowsNewCheckout,
  billingCatalogPrimaryAction,
  billingCheckoutCtaCopy,
  canCancelSubscription,
  catalogContainsPlanSecrets,
  checkoutSkuFor,
  equivalentMonthlyFromAnnual,
  formatStoredPlanLabel,
  isLegacyActiveSubscription,
  quoteBillingSelection,
  quoteCheckoutSelection,
  razorpayPlanEnvName,
  recommendUserBand,
  shouldShowBillingCatalog,
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
  assertEq(annualPriceFromMonthly(1499), 14990, '51-100 annual')
  assertEq(annualSavingsFromMonthly(1499), 2998, '51-100 savings')

  const q = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_1_3',
    interval: 'annual',
  })
  assertEq(q.amount, 3990, 'quote annual amount')
  assertEq(q.annualSavings, 798, 'quote savings')
  assert(q.summaryLines.some((l) => /2 months included/i.test(l)), '2 months included in summary')
  assert(q.checkoutEligible, '1-3 annual checkout eligible')
  assertEq(q.sku, 'flow_1_3_annual', 'sku flow_1_3_annual')
  assertEq(q.displayPrice, '$3,990 / year', 'annual display price spacing')
  assertEq(
    Math.round(equivalentMonthlyFromAnnual(5990) * 100) / 100,
    499.17,
    '4-10 annual equivalent monthly',
  )
}

console.log('B. Flow Pay Coming Soon / waitlist (no price, no checkout)')
{
  const pay = BILLING_PRODUCTS.find((p) => p.key === 'alza_flow_pay')
  assert(pay?.comingSoon === true, 'Flow Pay coming soon')
  assert(pay?.purchasable === false, 'Flow Pay not purchasable')
  assertEq(pay?.startsAtLabel, 'Coming Soon', 'Flow Pay starts-at is Coming Soon')
  for (const band of ['users_1_3', 'users_4_10', 'users_100_plus'] as const) {
    for (const interval of ['monthly', 'annual'] as const) {
      const q = quoteBillingSelection({
        product: 'alza_flow_pay',
        userBand: band,
        interval,
      })
      assertEq(q.checkoutEligible, false, `Flow Pay ${band} ${interval} cannot checkout`)
      assertEq(q.displayPrice, 'Coming Soon', `Flow Pay ${band} ${interval} display Coming Soon`)
      assertEq(q.amount, null, `Flow Pay ${band} ${interval} amount hidden`)
      assertEq(q.monthlyAmount, null, `Flow Pay ${band} ${interval} monthly hidden`)
      assertEq(q.annualAmount, null, `Flow Pay ${band} ${interval} annual hidden`)
      assertEq(q.contactAlza, false, `Flow Pay ${band} ${interval} not Contact ALZA`)
      assert(!q.displayPrice.includes('$'), `Flow Pay ${band} ${interval} has no dollar price`)
      assert(
        q.summaryLines.includes('Integrated producer payments are coming to ALZA Flow.'),
        `Flow Pay ${band} ${interval} waitlist summary`,
      )
    }
  }
  const blocked = quoteCheckoutSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assert('error' in blocked, 'Flow Pay checkout selection rejected')
  assertEq(
    billingCatalogPrimaryAction({
      status: 'incomplete',
      planKey: null,
      product: 'alza_flow_pay',
      checkoutEligible: true,
      contactAlza: false,
    }),
    'flow_pay_waitlist',
    'Flow Pay CTA is waitlist, not checkout',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'active',
      planKey: 'flow_1_3_monthly',
      product: 'alza_flow_pay',
      checkoutEligible: true,
      contactAlza: false,
    }),
    'flow_pay_waitlist',
    'Flow Pay CTA remains waitlist while Flow is active',
  )
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

  const band51 = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_51_100',
    interval: 'monthly',
  })
  assertEq(band51.checkoutEligible, false, '51-100 monthly not checkout eligible')
  assert(band51.contactAlza, '51-100 Contact ALZA')
  assertEq(band51.sku, null, '51-100 monthly no sku')
  assertEq(band51.monthlyAmount, 1499, '51-100 monthly guidance $1499')
  assert(band51.plusPricing, '51-100 plus pricing')
  assert(band51.displayPrice.includes('1,499'), '51-100 display shows $1,499+')

  const band51Annual = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_51_100',
    interval: 'annual',
  })
  assertEq(band51Annual.checkoutEligible, false, '51-100 annual not checkout eligible')
  assert(band51Annual.contactAlza, '51-100 annual Contact ALZA')
  assertEq(band51Annual.sku, null, '51-100 annual no sku')

  const band51Checkout = quoteCheckoutSelection({
    product: 'alza_flow',
    userBand: 'users_51_100',
    interval: 'monthly',
  })
  assert('error' in band51Checkout, '51-100 checkout selection rejected')

  const custom = quoteBillingSelection({
    product: 'alza_flow',
    userBand: 'users_100_plus',
    interval: null,
  })
  assert(custom.contactAlza && custom.customPricing, '100+ custom')
  assertEq(custom.checkoutEligible, false, '100+ no checkout')
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
  assertEq(BILLING_CHECKOUT_SKUS.length, 8, '8 Flow checkout SKUs (1-3 through 26-50)')
  assert(!BILLING_CHECKOUT_SKUS.includes('flow_51_100_monthly' as never), '51-100 monthly sku not listed')
  assert(!BILLING_CHECKOUT_SKUS.includes('flow_51_100_annual' as never), '51-100 annual sku not listed')
  assertEq(
    razorpayPlanEnvName('flow_1_3_monthly'),
    'RAZORPAY_PLAN_FLOW_1_3_MONTHLY',
    'env name monthly still correct',
  )
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

console.log('G2. Legacy-active + V2 catalog visibility (no second checkout)')
{
  assert(shouldShowBillingCatalog(), 'catalog always shown to Owner/Admin')
  for (const status of ['active', 'authenticated', 'pending'] as const) {
    assert(isLegacyActiveSubscription('essential', status), `essential ${status} is legacy-active`)
    assert(isLegacyActiveSubscription('professional', status), `professional ${status} is legacy-active`)
    assert(!allowsNewCheckout(status, 'essential'), `no checkout essential ${status}`)
    assert(!allowsNewCheckout(status, 'professional'), `no checkout professional ${status}`)
    assertEq(
      billingCatalogPrimaryAction({
        status,
        planKey: 'essential',
        product: 'alza_flow',
        checkoutEligible: true,
        contactAlza: false,
        selectedUserBand: 'users_1_3',
        selectedInterval: 'monthly',
      }),
      'subscribe',
      `legacy ${status} 1-3 CTA is purchase, not Upgrade / Contact ALZA`,
    )
    assertEq(
      billingCheckoutCtaCopy({
        status,
        planKey: 'essential',
        selectedProduct: 'alza_flow',
        selectedUserBand: 'users_1_3',
        selectedInterval: 'monthly',
      }),
      'Change Plan',
      `legacy ${status} label is Change Plan`,
    )
  }
  assert(!isLegacyActiveSubscription('essential', 'cancelled'), 'cancelled essential not legacy-active')
  assert(allowsNewCheckout('incomplete', null), 'incomplete may checkout')
  assert(allowsNewCheckout('cancelled', null), 'cancelled null plan may checkout')
  assert(allowsNewCheckout('cancelled', 'essential'), 'cancelled legacy may checkout Flow')
  assert(allowsNewCheckout('canceled', 'professional'), 'canceled legacy may checkout Flow')
  assert(allowsNewCheckout('cancelled', 'flow_1_3_monthly'), 'cancelled Flow may checkout again')
  assertEq(
    billingCatalogPrimaryAction({
      status: 'incomplete',
      planKey: null,
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
    }),
    'subscribe',
    'incomplete CTA subscribe',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'cancelled',
      planKey: 'essential',
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
    }),
    'subscribe',
    'cancelled legacy CTA subscribe',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'cancelled',
      planKey: 'flow_4_10_monthly',
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
    }),
    'subscribe',
    'cancelled Flow CTA subscribe',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'incomplete',
      planKey: null,
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
    }),
    'subscribe',
    'no-plan CTA subscribe',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'cancelled',
      planKey: null,
      product: 'alza_flow',
      checkoutEligible: false,
      contactAlza: true,
      selectedUserBand: 'users_51_100',
      selectedInterval: 'monthly',
    }),
    'contact_alza',
    '51-100 Contact ALZA CTA',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'incomplete',
      planKey: null,
      product: 'alza_flow',
      checkoutEligible: false,
      contactAlza: true,
    }),
    'contact_alza',
    '100+ Contact ALZA CTA',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'active',
      planKey: 'essential',
      product: 'alza_flow',
      checkoutEligible: false,
      contactAlza: true,
      selectedUserBand: 'users_100_plus',
      selectedInterval: 'annual',
    }),
    'contact_alza',
    '100+ stays Contact ALZA even with live legacy plan',
  )
  assertEq(
    billingCheckoutCtaCopy({
      status: 'incomplete',
      planKey: null,
      selectedProduct: 'alza_flow',
      selectedUserBand: 'users_1_3',
      selectedInterval: 'monthly',
    }),
    'Continue to Checkout',
    'no current plan uses Continue to Checkout',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'active',
      planKey: 'flow_1_3_monthly',
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
      selectedUserBand: 'users_1_3',
      selectedInterval: 'monthly',
    }),
    null,
    'already on selected paid plan has no purchase CTA',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'active',
      planKey: 'flow_1_3_monthly',
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
      selectedUserBand: 'users_4_10',
      selectedInterval: 'monthly',
    }),
    'subscribe',
    'different paid plan uses purchase CTA',
  )
  assertEq(
    billingCheckoutCtaCopy({
      status: 'active',
      planKey: 'flow_1_3_monthly',
      selectedProduct: 'alza_flow',
      selectedUserBand: 'users_4_10',
      selectedInterval: 'monthly',
    }),
    'Change Plan',
    'known paid plan change uses Change Plan',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'incomplete',
      planKey: null,
      product: 'alza_flow_pay',
      checkoutEligible: false,
      contactAlza: false,
    }),
    'flow_pay_waitlist',
    'Flow Pay CTA remains waitlist',
  )

  const page = readFileSync(resolve(root, 'src/pages/admin/SubscriptionBilling.tsx'), 'utf8')
  assert(page.includes('shouldShowBillingCatalog'), 'page uses always-show catalog helper')
  assert(page.includes('isLegacyActiveSubscription'), 'page detects legacy-active')
  assert(page.includes('Continue to Checkout'), 'purchasable CTA Continue to Checkout')
  assert(page.includes('Change Plan'), 'plan-change CTA Change Plan')
  assert(!page.includes('Upgrade / Contact ALZA'), 'Upgrade / Contact ALZA removed from 1-100')
  assert(!page.includes('Subscribe —'), 'old Subscribe — price CTA removed')
  assert(page.includes('Configure plan'), 'catalog configure heading present')
  assert(page.includes('<select'), 'compact product/band selectors')
  assert(/Team Size/i.test(page), 'team size selector present')
  assert(/Coming Soon/i.test(page), 'Flow Pay Coming Soon preserved')
  assert(page.includes('ALZA Flow Pay — Coming Soon') || page.includes("{p.comingSoon ? ' — Coming Soon' : ''}"), 'product option Coming Soon suffix')
  assert(page.includes('Join Flow Pay Waitlist'), 'Flow Pay waitlist CTA')
  assert(page.includes('Join the ALZA Flow Pay Waitlist'), 'waitlist modal title')
  assert(
    page.includes('Be among the first to know when integrated producer payments become available.'),
    'waitlist modal body',
  )
  assert(
    page.includes(
      'ALZA Flow Pay will bring producer payment processing directly into ALZA Flow. Join',
    ),
    'Flow Pay waitlist product copy',
  )
  assert(page.includes('Integrated producer payments are coming to ALZA Flow.'), 'quote Coming Soon subtitle')
  assert(!page.includes('ALZA Flow Pay is Coming Soon and not purchasable.'), 'old not-purchasable copy removed')
  assert(page.includes('openFlowPayWaitlist'), 'waitlist CTA opens modal, not checkout')
  assert(!/flow-pay-waitlist-cta[\s\S]{0,500}handleSubscribe/.test(page), 'waitlist CTA does not call handleSubscribe')
  assert(!/handleJoinWaitlist[\s\S]{0,800}createRazorpay/.test(page), 'waitlist submit does not create subscription')
  assert(page.includes('joinFlowPayWaitlist'), 'waitlist submit uses waitlist helper')
  assert(page.includes('waitlistBusy'), 'waitlist double-click guard')
  assert(page.includes("You're on the Flow Pay waitlist.") || page.includes('You&apos;re on the Flow Pay waitlist.'), 'waitlist success title')
  assert(
    page.includes("We'll let you know when integrated producer payments become available.") ||
      page.includes('We&apos;ll let you know when integrated producer payments become available.'),
    'waitlist success body',
  )
  const waitlistLib = readFileSync(resolve(root, 'src/lib/flowPayWaitlist.ts'), 'utf8')
  assert(waitlistLib.includes("supabase.rpc('join_flow_pay_waitlist'"), 'waitlist RPC join_flow_pay_waitlist')
  assert(!/createRazorpay|openRazorpay|subscription/i.test(waitlistLib), 'waitlist helper has no checkout')
  const waitlistSql = readFileSync(
    resolve(root, 'supabase/migrations/20260908170000_flow_pay_waitlist_v1.sql'),
    'utf8',
  )
  assert(waitlistSql.includes('CREATE TABLE IF NOT EXISTS public.flow_pay_waitlist'), 'waitlist table')
  assert(waitlistSql.includes('flow_pay_waitlist_select'), 'waitlist SELECT policy')
  assert(waitlistSql.includes('is_alza_support()'), 'ALZA Support may read waitlist')
  assert(waitlistSql.includes('same_agency(agency_profile_id)'), 'agency waitlist SELECT is same-agency')
  assert(waitlistSql.includes('ON CONFLICT (agency_profile_id, (lower(btrim(work_email))))'), 'waitlist upsert on agency+email')
  assert(waitlistSql.includes('current_user_agency_profile_id()'), 'RPC stamps agency from session')
  assert(waitlistSql.includes('current_app_user_id()'), 'RPC stamps submitting user from session')
  assert(!/GRANT INSERT ON TABLE public.flow_pay_waitlist TO authenticated/i.test(waitlistSql), 'no authenticated INSERT grant')
  assert(!/create-razorpay|openRazorpay|billing_subscriptions/i.test(waitlistSql), 'waitlist migration has no payment objects')
  assert(page.includes("product !== 'alza_flow'"), 'subscribe handler rejects non-Flow products')
  assert(page.includes("disabled={busy || processing || product === 'alza_flow_pay'}"), 'Flow Pay frequency toggle disabled')
  assert(!/band\.key === recommendedBand && \(\s*<span className="rounded-full bg-emerald-50/.test(page), 'no card-grid recommended badges')
  assert(!page.includes('choiceClass'), 'choiceClass card helper removed')
  assert(!/showSubscribe\s*&&\s*\(/.test(page), 'catalog not gated only on showSubscribe block')
  assert(page.includes('allowsNewCheckout'), 'checkout gated separately from catalog')
  assert(canCancelSubscription('active'), 'legacy-active cancel preserved')
  assert(page.includes('data-billing-layout="quote-first"'), 'quote-first layout marker')
  assert(page.includes('billing-product-select'), 'product select test id')
  assert(page.includes('billing-user-band-select'), 'user band select test id')
  assert(page.includes('Save 2 months'), 'annual toggle save badge')
  assert(page.includes("userBand !== 'users_100_plus'"), '100+ hides Save 2 months badge')
  assert(page.includes('from-alza-blue-800 to-alza-teal-700'), 'selected frequency filled blue/teal')
  assert(page.includes('text-white shadow-sm'), 'selected frequency white text')
  assert(page.includes('bg-white text-slate-600'), 'unselected frequency neutral')
  assert(page.includes('Annual Advantage'), 'annual advantage panel copy')
  assert(page.includes('Equivalent to'), 'annual equivalent monthly copy')
  assert(page.includes('line-through'), 'crossed-out monthly annual value')
  assert(page.includes('ALZA_FLOW_INCLUDED_FEATURES'), 'feature checklist wired')
  assert(page.includes('2 months included'), '2 months included copy')
  assert(page.includes('Continue to Checkout'), 'purchase CTA in quote panel')
  assert(page.includes('Secure checkout by Razorpay'), 'secure checkout note')
  assert(page.includes('All prices are in USD'), 'USD note in left rail')
  assert(page.includes('bg-gradient-to-br from-alza-blue-900'), 'quote brand header gradient')
  assert(page.includes('— RECOMMENDED'), 'recommended badge in quote header')
  assert(!page.includes('QUOTE-FIRST BILLING QA'), 'QA strip removed')
  assert(!page.includes('BILLING_QUOTE_FIRST_QA_MARKER'), 'QA marker constant removed')
  assert(!page.includes('ffefc3c'), 'old QA sha not in page')
  assert(!page.includes('Previous plan'), 'no Previous plan customer copy')
  assert(!page.includes('Legacy Plan'), 'no Legacy Plan customer copy')
  assert(!page.includes('historical compatibility'), 'no historical compatibility copy')
  assert(!page.includes('Cancelled Aug'), 'no Cancelled Aug customer copy')
  assert(!page.includes('Status:'), 'no status history line')
  assert(!page.includes('A legacy plan is still active'), 'no legacy banner in quote')
  assert(!page.includes('Status is mirrored from Razorpay'), 'no Razorpay webhook customer blurb')
  assert(!page.includes('Plan IDs stay server-side'), 'no plan-id customer blurb')
  assert(!page.includes('sm:grid-cols-4'), 'no dominating 4-col status history grid')
  assert(!page.includes('Choose product'), 'no card Choose product heading')
  const catalogSrc = readFileSync(resolve(root, 'src/lib/billingCatalog.ts'), 'utf8')
  assert(catalogSrc.includes('Commission operations & reconciliation'), 'feature checklist content')
  assert(catalogSrc.includes('monthly: 399'), '1-3 monthly price')
  assert(catalogSrc.includes('annual: 3990'), '1-3 annual price')
  assert(catalogSrc.includes('monthly: 599'), '4-10 monthly price')
  assert(catalogSrc.includes('annual: 5990'), '4-10 annual price')
  assert(catalogSrc.includes('monthly: 899'), '11-25 monthly price')
  assert(catalogSrc.includes('annual: 8990'), '11-25 annual price')
  assert(catalogSrc.includes('monthly: 1099'), '26-50 monthly price')
  assert(catalogSrc.includes('annual: 10990'), '26-50 annual price')
  assert(catalogSrc.includes('monthly: 1499'), '51-100 monthly price')
  assert(catalogSrc.includes('annual: 14990'), '51-100 annual price')
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

console.log('I. Support/prospect files not restored on Billing V2 Preview branch')
{
  // Difference from 69eb07e: Support assignment, notify-support-event, and the
  // combined billing+support migration stay on launch/support-v1 / the mixed
  // feature branch. This branch restores Billing catalog/UI only.
  assert(
    !existsSync(resolve(root, 'src/pages/Signup.tsx')),
    'prospect Signup.tsx not restored',
  )
  assert(
    !existsSync(resolve(root, 'src/lib/agencyLifecycle.ts')),
    'agencyLifecycle not restored',
  )
  assert(
    !existsSync(resolve(root, 'supabase/functions/notify-support-event/index.ts')),
    'notify-support-event not restored',
  )
  assert(
    !existsSync(resolve(root, 'supabase/functions/create-agency-signup/index.ts')),
    'create-agency-signup not restored',
  )
  assert(
    !existsSync(
      resolve(root, 'supabase/migrations/20260826120000_billing_v2_and_support_assignment.sql'),
    ),
    'billing+support migration not restored',
  )
}

console.log('J. create-subscription rejects legacy / missing secret message')
{
  const createFn = readFileSync(
    resolve(root, 'supabase/functions/create-razorpay-subscription/index.ts'),
    'utf8',
  )
  assert(createFn.includes('parseCheckoutSelection'), 'uses checkout selection parser')
  assert(createFn.includes('resolveRazorpayPlanIdForSku'), 'resolves secret by SKU')
  assert(createFn.includes('getCallerAgency'), 'uses caller agency not singleton')
  assert(!createFn.includes('getSingletonAgency'), 'create fn does not use singleton agency')
  assert(createFn.includes('plan_secret_missing') || createFn.includes('Contact ALZA'), 'missing secret message')
  assert(!createFn.includes('body.amount'), 'browser amount not used')
  assert(!/users_51_100[\s\S]{0,40}\? 100/.test(createFn), '51-100 not mapped for included_users checkout')

  const sharedCatalog = readFileSync(
    resolve(root, 'supabase/functions/_shared/billingCatalog.ts'),
    'utf8',
  )
  for (const sku of BILLING_CHECKOUT_SKUS) {
    assert(sharedCatalog.includes(`'${sku}'`), `server catalog lists ${sku}`)
    assertEq(
      razorpayPlanEnvName(sku),
      `RAZORPAY_PLAN_${sku.toUpperCase()}`,
      `secret name for ${sku}`,
    )
  }
  assertEq(BILLING_CHECKOUT_SKUS.length, 8, '8 sellable Flow SKUs')
  assert(sharedCatalog.includes("users_51_100"), 'server explicitly mentions 51-100')
  assert(
    sharedCatalog.includes('This user band requires custom pricing. Contact ALZA.'),
    'server rejects 51-100 / 100+ with Contact ALZA',
  )
  assert(!sharedCatalog.includes("'flow_51_100_monthly'"), 'server has no 51-100 monthly sku')
  assert(!sharedCatalog.includes("'flow_51_100_annual'"), 'server has no 51-100 annual sku')

  const sharedBilling = readFileSync(
    resolve(root, 'supabase/functions/_shared/billing.ts'),
    'utf8',
  )
  assert(sharedBilling.includes('hasBlockingSubscription'), 'blocking helper present')
  assert(
    !/hasBlockingSubscription[\s\S]{0,200}cancelled/.test(
      sharedBilling.match(/export function hasBlockingSubscription[\s\S]*?^}/m)?.[0] ?? '',
    ),
    'cancelled is not a blocking status',
  )
}

console.log('K. Checkout matrix — sellable SKUs, rejects, cancelled legacy')
{
  const sellableBands = [
    'users_1_3',
    'users_4_10',
    'users_11_25',
    'users_26_50',
  ] as const
  const monthlyAmounts: Record<(typeof sellableBands)[number], number> = {
    users_1_3: 399,
    users_4_10: 599,
    users_11_25: 899,
    users_26_50: 1099,
  }

  for (const band of sellableBands) {
    for (const interval of ['monthly', 'annual'] as const) {
      const q = quoteCheckoutSelection({
        product: 'alza_flow',
        userBand: band,
        interval,
      })
      assert(!('error' in q), `${band} ${interval} checkout ok`)
      if (!('error' in q)) {
        assert(q.checkoutEligible, `${band} ${interval} eligible`)
        assert(q.sku != null && BILLING_CHECKOUT_SKUS.includes(q.sku), `${band} ${interval} has SKU`)
        const monthly = monthlyAmounts[band]
        const want = interval === 'monthly' ? monthly : monthly * 10
        assertEq(q.amount, want, `${band} ${interval} amount ${want}`)
      }
    }
  }

  const band51Reject = quoteCheckoutSelection({
    product: 'alza_flow',
    userBand: 'users_51_100',
    interval: 'monthly',
  })
  assert('error' in band51Reject, '51-100 checkout rejected')

  const pay = quoteCheckoutSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assert('error' in pay, 'Flow Pay checkout rejected')

  const custom = quoteCheckoutSelection({
    product: 'alza_flow',
    userBand: 'users_100_plus',
    interval: 'monthly',
  })
  assert('error' in custom, '100+ checkout rejected')

  assert(allowsNewCheckout('cancelled', 'essential'), 'cancelled legacy permits checkout')
  assert(allowsNewCheckout('canceled', 'professional'), 'canceled legacy permits checkout')
  assert(!allowsNewCheckout('active', 'essential'), 'active legacy blocks second subscription')
  assert(!allowsNewCheckout('active', 'flow_4_10_monthly'), 'active Flow blocks second subscription')
  assertEq(
    billingCatalogPrimaryAction({
      status: 'active',
      planKey: 'essential',
      product: 'alza_flow',
      checkoutEligible: true,
      contactAlza: false,
      selectedUserBand: 'users_1_3',
      selectedInterval: 'monthly',
    }),
    'subscribe',
    'active legacy 1-3 uses purchase CTA',
  )
  assertEq(
    billingCheckoutCtaCopy({
      status: 'active',
      planKey: 'essential',
      selectedProduct: 'alza_flow',
      selectedUserBand: 'users_1_3',
      selectedInterval: 'monthly',
    }),
    'Change Plan',
    'active legacy 1-3 label is Change Plan',
  )
  assertEq(
    billingCatalogPrimaryAction({
      status: 'incomplete',
      planKey: null,
      product: 'alza_flow',
      checkoutEligible: false,
      contactAlza: true,
    }),
    'contact_alza',
    '100+ never uses purchase CTA',
  )

  const browser = readFileSync(resolve(root, 'src/lib/billing.ts'), 'utf8')
  assert(browser.includes('product: input.product'), 'browser sends product')
  assert(browser.includes('userBand: input.userBand'), 'browser sends userBand')
  assert(browser.includes('interval: input.interval'), 'browser sends interval')
  assert(!/functions\.invoke\([\s\S]*amount\s*:/.test(browser), 'browser does not send amount')
  assert(!/functions\.invoke\([\s\S]*planId\s*:/.test(browser), 'browser does not send planId')
  assert(browser.includes('readEdgeFunctionErrorMessage'), 'surfaces Edge Function body message')

  const createFn = readFileSync(
    resolve(root, 'supabase/functions/create-razorpay-subscription/index.ts'),
    'utf8',
  )
  assert(createFn.includes('authz.agencyProfileId'), 'create uses authenticated agency_profile_id')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-billing-support-v1: ALL GREEN')
