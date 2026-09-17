/**
 * Public landing page + navigation safety (offline).
 * Does not call Razorpay. Does not touch Production.
 *
 * Run: npx tsx scripts/validate-public-landing.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  billingUserBands,
  quoteBillingSelection,
} from '../src/lib/billingCatalog.ts'
import { signupPathForPlan } from '../src/lib/purchaseIntent.ts'
import {
  PUBLIC_CONTACT_SALES_PATH,
  PUBLIC_DEMO_MAILTO,
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LOGIN_PATH,
  PUBLIC_PAGE_DESCRIPTION,
  PUBLIC_PAGE_TITLE,
  PUBLIC_PRICING_INQUIRY_MAILTO,
  PUBLIC_PRICING_PATH,
} from '../src/lib/publicSite.ts'

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

const root = resolve(process.cwd())
function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

const landing = read('src/pages/PublicLanding.tsx')
const preview = read('src/components/marketing/ProductPreview.tsx')
const talk = read('src/components/marketing/TalkToAlzaLink.tsx')
const motion = read('src/components/marketing/LandingMotion.tsx')
const brand = read('src/components/marketing/PublicBrandLink.tsx')
const backTop = read('src/components/marketing/BackToTopButton.tsx')
const css = read('src/index.css')
const marketing = `${landing}\n${preview}\n${talk}\n${motion}`
const app = read('src/App.tsx')
const pricing = read('src/pages/Pricing.tsx')
const signup = read('src/pages/Signup.tsx')
const login = read('src/pages/Login.tsx')
const setPassword = read('src/pages/SetPassword.tsx')
const resetPassword = read('src/pages/ResetPassword.tsx')
const html = read('index.html')
const permissions = read('src/lib/permissions.ts')
const billing = read('src/lib/billing.ts')
const reconciliation = read('src/lib/reconciliation.ts')
const auth = read('src/lib/auth.tsx')
const dashboard = read('src/pages/Dashboard.tsx')
const financials = read('src/pages/Financials.tsx')

console.log('A. Routing architecture')
{
  assert(app.includes('PublicLandingPage'), 'App imports landing page')
  assert(
    app.includes("location.pathname === '/'") && app.includes('<PublicLandingPage />'),
    'unauthenticated / renders landing',
  )
  assert(app.includes("path=\"/contact-sales\"") && app.includes('ContactSalesPage'), '/contact-sales preserved as public route')
  assert(app.includes("path=\"/signup\"") && app.includes('SignupPage'), '/signup preserved')
  assert(app.includes("path=\"/get-started\""), '/get-started preserved')
  assert(app.includes('<Dashboard />'), 'authenticated dashboard still at index')
  assert(PUBLIC_LOGIN_PATH === '/login', 'login path is /login')
  assert(PUBLIC_GET_STARTED_PATH === '/pricing', 'Get Started enters existing /pricing')
}

console.log('B. Sign-in destinations no longer dump to marketing root')
{
  assert(pricing.includes('PUBLIC_LOGIN_PATH'), 'Pricing Sign in uses /login')
  assert(signup.includes('PUBLIC_LOGIN_PATH'), 'Signup Sign in uses /login')
  assert(setPassword.includes('PUBLIC_LOGIN_PATH'), 'Set password Sign in uses /login')
  assert(resetPassword.includes('PUBLIC_LOGIN_PATH'), 'Reset password Sign in uses /login')
  assert(!pricing.includes('to="/"'), 'Pricing does not Sign in to /')
  assert(!signup.includes('to="/"'), 'Signup does not Sign in to /')
}

console.log('C. Template-style copy and sections')
{
  for (const needle of [
    'Take control of your',
    'commission operations.',
    'Commission Operations for Insurance Agencies',
    "Know what came in. Catch what didn't.",
    'Explore ALZA Flow',
    'One place to understand your commission business.',
    'Turn commission statements into answers.',
    'Spot the commissions that need attention.',
    'without the spreadsheet chase.',
    'See the business behind your commissions.',
    'Keep your AMS.',
    'Give commissions their own workflow.',
    'No AMS replacement required.',
    'Ready to make your commission operations easier?',
    'View Pricing',
  ]) {
    assert(landing.includes(needle), `landing has: ${needle}`)
  }
  assert(landing.includes('id="hero"'), 'hero id')
  assert(landing.includes('id="product"'), 'product id')
  assert(motion.includes('id="how-it-works"'), 'how-it-works id on commission journey')
  assert(landing.includes('id="reconciliation"'), 'reconciliation id')
  assert(landing.includes('id="exceptions"'), 'exceptions id')
  assert(landing.includes('id="producers"'), 'producers id')
  assert(landing.includes('id="reporting"'), 'reporting id')
  assert(landing.includes('id="positioning"'), 'positioning id')
  assert(landing.includes('max-w-7xl'), 'wider page container')
  assert(landing.includes('py-24'), 'generous section padding')
  assert(!landing.includes('function ProductStory'), 'narrow alternating ProductStory layout removed')
  assert((landing.match(/<header/g) ?? []).length === 1, 'exactly one header')
  assert(!landing.includes('Know what you earned.'), 'old hero headline removed')
  assert(!landing.includes('Know what your producers are owed.'), 'old producer headline removed')
  assert(!landing.includes('Your AMS manages policies.'), 'old AMS headline removed')
  assert(!landing.includes("Your commissions shouldn't require detective work."), 'old final CTA removed')
  assert(!landing.includes('Ready to make commission operations easier?'), 'old final headline removed')
  assert(!landing.includes('Bring reconciliation, discrepancies, producer commissions, and reporting into one operational'), 'repetitive final supporting sentence removed')
  assert(!landing.includes('See ALZA Flow'), 'old See ALZA Flow CTA removed')
  assert(!landing.includes('Stop hunting through commission statements.'), 'old recon headline removed')
  assert(!landing.includes('Learn'), 'Learn nav removed')
  assert(!landing.includes('Book a Demo'), 'hero Book a Demo removed')
  assert(!landing.includes('Clip coming soon'), 'video placeholders removed')
  assert(!landing.includes('Plans that grow with your agency.'), 'homepage pricing CTA section removed')
  assert(!/\bV1\b/.test(landing), 'no customer-facing V1 copy')
  assert(!landing.includes('whole-premium'), 'no whole-premium marketing copy')
  assert(!landing.includes('billingUserBands'), 'homepage does not render catalog grid')
  assert(!landing.includes('formatUsdWhole'), 'homepage does not display plan prices')
  assert(!landing.includes('ALZA Flow Pay'), 'Flow Pay card not on homepage')
  assert(!landing.includes('$399'), 'no $399 on homepage')
  assert(!landing.includes('signupPathForPlan'), 'homepage does not start checkout SKUs')
  assert(!landing.toLowerCase().includes('integrates with'), 'does not claim AMS integration')
}

console.log('C2. Visual motion adapted without restoring rejected layout')
{
  assert(landing.includes('MarketingOrbs'), 'drifting orbs on landing')
  assert(landing.includes('OpsTicker'), 'operational ticker')
  assert(landing.includes('CommissionJourney'), 'connected commission journey')
  assert(landing.includes('mkt-enter-1') && landing.includes('mkt-enter-5'), 'staggered hero entrance')
  assert(landing.includes('mkt-float-ui'), 'floating product visual')
  assert(landing.includes('mkt-cta-shift'), 'animated gradient CTA')
  assert(landing.includes('Reveal'), 'scroll reveal wrappers')
  assert(motion.includes('IntersectionObserver'), 'IntersectionObserver scroll reveals')
  assert(motion.includes('Bound transaction'), 'journey starts at bound transaction')
  assert(motion.includes('Payment status'), 'journey ends at payment status')
  assert(motion.includes("keeps the agency's commission operation connected"), 'original product promise kept as journey copy')
  assert(preview.includes('mkt-bar-col'), 'animated metric bars')
  assert(preview.includes('mkt-status-dot'), 'pulsing status indicators')
  assert(preview.includes('mkt-metric-fill'), 'animated KPI metric fills')
  assert(css.includes('prefers-reduced-motion'), 'reduced-motion media query present')
  assert(css.includes('.mkt-ticker-dup'), 'ticker duplicate hidden when motion is reduced')
  assert(!motion.includes('01 Import'), 'numbered Import/Reconcile cards not restored')
  assert(!landing.includes('01 / 02'), 'numbered feature cards not restored')
  assert(!marketing.includes('mock.js'), 'no mock.js data layer')
  assert(!marketing.includes('Google login'), 'no Google login')
}

console.log('D. CTAs and dedicated pricing page still owns catalog')
{
  assert(landing.includes('PUBLIC_GET_STARTED_PATH'), 'Get Started / View Pricing use /pricing')
  assert(landing.includes('href="#product"'), 'Explore ALZA Flow / Product scroll on-page')
  assert(landing.includes("href: '#how-it-works'"), 'How It Works nav scrolls on-page')
  assert(landing.includes('TalkToAlzaLink'), 'Talk/Contact uses swappable TalkToAlzaLink')
  assert(talk.includes('PUBLIC_CONTACT_SALES_PATH'), 'Talk to ALZA uses /contact-sales')
  assert(PUBLIC_CONTACT_SALES_PATH === '/contact-sales', 'contact-sales path constant')
  assert(landing.includes('BackToTopButton'), 'floating back to top on landing')
  assert(landing.includes('PublicBrandLink'), 'header logo uses shared public brand link')
  assert(landing.includes('variant="text"'), 'footer brand is clickable home')
  assert(brand.includes("pathname === PUBLIC_LANDING_PATH"), 'brand on / scrolls to top')
  assert(brand.includes("behavior: reduced ? 'auto' : 'smooth'"), 'brand respects reduced motion')
  assert(brand.includes('variant === \'stacked\''), 'stacked brand variant for login/signup')
  assert(signup.includes('PublicBrandLink'), 'signup brand navigates home')
  assert(login.includes('PublicBrandLink'), 'login brand navigates home')
  assert(pricing.includes('PublicMarketingHeader'), 'pricing header uses public brand')
  assert(!pricing.includes('BackToTopButton'), 'pricing has no floating back-to-top')
  assert(!signup.includes('BackToTopButton'), 'signup has no floating back-to-top')
  assert(backTop.includes('window.scrollY > 420'), 'back to top threshold ~420px')
  assert(backTop.includes('aria-label="Back to top"'), 'back to top accessible')
  assert(brand.includes('by ALZA Business Solutions LLP'), 'public brand lockup includes LLP line')
  assert(landing.includes('View Pricing'), 'homepage has View Pricing')
  assert(landing.includes('Talk to us'), 'final CTA says Talk to us')
  assert(landing.includes('text-alza-teal-200'), 'dashboard eyebrow uses high-contrast teal')
  assert(landing.includes('text-slate-100'), 'dashboard body uses high-contrast slate')
  assert(landing.includes('from-[#041433]/90'), 'dashboard text sits on darkened veil')
  assert(!landing.toLowerCase().includes('powered by'), 'no powered by attribution')
  assert(pricing.includes('Get Started'), 'dedicated /pricing still has Get Started')
  assert(pricing.includes('Coming Soon'), 'dedicated /pricing still has Flow Pay Coming Soon')
  assert(pricing.includes('max-w-[44rem]'), 'secondary pricing row is width-capped')
  assert(pricing.includes('text-center'), 'secondary cards are centered')
  assert(pricing.includes('Contact us'), '51+ CTA is Contact us')
  assert(!pricing.includes('>Contact ALZA<'), 'pricing CTA no longer Contact ALZA')
  const bands = billingUserBands('alza_flow')
  assert(bands.filter((b) => b.checkoutEligible).length === 4, '4 self-serve bands')
  assert(bands.filter((b) => b.contactAlza).length === 2, '2 contact bands')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_51_100', interval: 'monthly' }).checkoutEligible === false, '51–100 not checkout')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_100_plus', interval: 'monthly' }).checkoutEligible === false, '100+ not checkout')
  assert(quoteBillingSelection({ product: 'alza_flow_pay', userBand: 'users_1_3', interval: 'monthly' }).checkoutEligible === false, 'Flow Pay not checkout')
  assert(signupPathForPlan('flow_1_3_monthly') === '/signup?plan_key=flow_1_3_monthly', '1–3 monthly signup path')
  assert(BILLING_CHECKOUT_SKUS.length === 8, '8 checkout SKUs')
}

console.log('E. Product UI frames, claims, PII, and dead-link hygiene')
{
  assert(preview.includes('DashboardProductFrame'), 'dashboard frame present')
  assert(preview.includes('ReconciliationProductFrame'), 'reconciliation frame present')
  assert(preview.includes('ExceptionsProductFrame'), 'exceptions frame present')
  assert(preview.includes('ProducerProductFrame'), 'producer frame present')
  assert(landing.includes('DashboardProductFrame'), 'hero/reporting uses dashboard frame')
  assert(landing.includes('ReconciliationProductFrame'), 'recon story uses recon frame')
  assert(landing.includes('ExceptionsProductFrame'), 'exception story uses exception frame')
  assert(landing.includes('ProducerProductFrame'), 'producer story uses producer frame')
  assert(preview.includes('Matched') && preview.includes('Needs Review'), 'recon statuses from real product')
  assert(preview.includes('Missing') && preview.includes('Underpaid') && preview.includes('Overpaid'), 'discrepancy labels from real product')
  assert(preview.includes('Ready for Payment'), 'producer ready queue from financials')
  assert(preview.includes('Welcome to ALZA Flow'), 'dashboard welcome banner language')
  assert(preview.includes('from-alza-blue-900 via-alza-blue-800 to-alza-teal-900'), 'sidebar gradient matches app chrome')
  assert(preview.includes('min-h-[30rem]'), 'feature frames are large')
  assert(dashboard.includes('Welcome to ALZA Flow'), 'dashboard source still has welcome banner')
  assert(dashboard.includes('Needs Attention'), 'dashboard source still has Needs Attention')
  assert(financials.includes('Ready for Payment'), 'financials source still has Ready for Payment')
  assert(!preview.includes('<video'), 'preview does not render video')
  assert(!landing.includes('<video'), 'landing does not render video')
  assert(!landing.includes('<ProductPreview'), 'old four-card component unused')
  assert(!dashboard.includes('DashboardProductFrame'), 'authenticated dashboard not using marketing frames')
  assert(!financials.includes('ProducerProductFrame'), 'authenticated financials not using marketing frames')
  for (const banned of [
    'SOC 2',
    'ISO 27001',
    'testimonial',
    'customers trust',
    '99.9%',
    'Applied Epic',
    'HawkSoft',
    'Calendly',
    'replaces your AMS',
    'Google login',
  ]) {
    assert(!marketing.toLowerCase().includes(banned.toLowerCase()), `no invented/banned: ${banned}`)
  }
  assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(marketing), 'no email addresses in marketing source')
  assert(!/\b(alex morgan|uat|@alzabusiness\.com)\b/i.test(marketing), 'no UAT names or support inbox literals')
  assert(!/\bPOL[-_]/i.test(marketing), 'no policy-number looking identifiers')
  assert(!/\b(CHK|ACH|WIRE|REF)[-_]/i.test(marketing), 'no payment-reference looking identifiers')
  assert(preview.includes('Producer A') && preview.includes('Producer B'), 'producer labels are generic')
  assert(PUBLIC_DEMO_MAILTO.startsWith('mailto:support@alzabusiness.com'), 'demo uses existing support inbox')
  assert(PUBLIC_PRICING_INQUIRY_MAILTO.startsWith('mailto:support@alzabusiness.com'), 'pricing inquiry uses existing support inbox')
  assert(landing.includes("href: '#product'"), 'Product anchor')
  assert(landing.includes("href: '#how-it-works'"), 'How It Works anchor')
  assert(landing.includes("kind: 'route'"), 'Pricing nav is a route')
  assert(!landing.includes('/help'), 'no dead public /help link')
  assert(!landing.includes('to="/support"'), 'no public /support login trap')
}

console.log('F. Metadata and safety isolation')
{
  assert(html.includes(PUBLIC_PAGE_TITLE.replace('&', '&amp;')) || html.includes('Commission Operations'), 'index title')
  assert(html.includes('without replacing their AMS'), 'index description')
  assert(PUBLIC_PAGE_DESCRIPTION.includes('without replacing their AMS'), 'shared description')
  assert(!permissions.includes('PublicLanding'), 'permissions logic untouched by landing import')
  assert(!billing.includes('PublicLanding'), 'billing backend untouched')
  assert(!reconciliation.includes('PublicLanding'), 'reconciliation untouched')
  assert(!auth.includes('PublicLanding'), 'auth module untouched')
  assert(login.includes('PUBLIC_PRICING_PATH'), 'login still links to public pricing/signup')
  assert(PUBLIC_PRICING_PATH === '/pricing', 'pricing path constant')
  assert(PUBLIC_CONTACT_SALES_PATH === '/contact-sales', 'sales inquiry path constant')
}

console.log('')
console.log(`Public landing: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
