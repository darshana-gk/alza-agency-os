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

console.log('A. Routing architecture')
{
  assert(app.includes('PublicLandingPage'), 'App imports landing page')
  assert(
    app.includes("location.pathname === '/'") && app.includes('<PublicLandingPage />'),
    'unauthenticated / renders landing',
  )
  assert(app.includes("path=\"/pricing\"") && app.includes('PricingPage'), '/pricing preserved')
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

console.log('C. V2 copy and sections')
{
  for (const needle of [
    'Know what your agency earned.',
    'Know what was paid.',
    "Know what's missing.",
    'Keep your AMS. Fix your commission operations.',
    'ALZA Flow brings your commission operations into one place',
    'Your commission operation. One clear view.',
    'Commission operations without the spreadsheet chase.',
    'Reconcile faster.',
    "Catch what doesn't add up.",
    'Know what producers are owed.',
    'From statement to clarity.',
    'Built for commission operations. Designed to work alongside your AMS.',
    'Plans that grow with your agency.',
    'Ready to put your commission operations in order?',
    'See How It Works',
    'by ALZA Business Solutions LLP',
  ]) {
    assert(landing.includes(needle), `landing has: ${needle}`)
  }
  assert(landing.includes('id="hero"'), 'hero id')
  assert(landing.includes('id="product"'), 'product id')
  assert(landing.includes('id="how-it-works"'), 'how-it-works id')
  assert((landing.match(/<header/g) ?? []).length === 1, 'exactly one header')
  assert(!landing.includes('Learn'), 'Learn nav removed')
  assert(!landing.includes('Book a Demo'), 'hero Book a Demo removed')
  assert(!landing.includes('Clip coming soon'), 'video placeholders removed')
  assert(!landing.includes('See ALZA Flow in action'), 'old four-card heading removed')
  assert(!landing.includes("Commission operations shouldn't live in spreadsheets."), 'old problem list heading removed')
  assert(!landing.includes('Pricing that grows with your agency.'), 'full pricing heading removed from homepage')
  assert(!landing.includes('Take control of your commission operations.'), 'old final CTA removed')
  assert(!/\bV1\b/.test(landing), 'no customer-facing V1 copy')
  assert(!landing.includes('whole-premium'), 'no whole-premium marketing copy')
  assert(!landing.includes('billingUserBands'), 'homepage does not render catalog grid')
  assert(!landing.includes('formatUsdWhole'), 'homepage does not display plan prices')
  assert(!landing.includes('ALZA Flow Pay'), 'Flow Pay card not on homepage')
  assert(!landing.includes('$399'), 'no $399 on homepage')
  assert(!landing.includes('signupPathForPlan'), 'homepage does not start checkout SKUs')
}

console.log('D. CTAs and dedicated pricing page still owns catalog')
{
  assert(landing.includes('PUBLIC_GET_STARTED_PATH'), 'Get Started / View Pricing use /pricing')
  assert(landing.includes('href="#how-it-works"'), 'See How It Works scrolls on-page')
  assert(landing.includes('PUBLIC_DEMO_MAILTO'), 'Talk/Contact uses existing support email')
  assert(landing.includes('PUBLIC_PRICING_INQUIRY_MAILTO'), 'larger-agency Talk uses existing inquiry mailto')
  assert(landing.includes('View Pricing'), 'homepage has View Pricing')
  assert(pricing.includes('Get Started'), 'dedicated /pricing still has Get Started')
  assert(pricing.includes('Coming Soon'), 'dedicated /pricing still has Flow Pay Coming Soon')
  assert(pricing.includes('Contact ALZA'), 'dedicated /pricing still has Contact ALZA')
  const bands = billingUserBands('alza_flow')
  assert(bands.filter((b) => b.checkoutEligible).length === 4, '4 self-serve bands')
  assert(bands.filter((b) => b.contactAlza).length === 2, '2 contact bands')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_51_100', interval: 'monthly' }).checkoutEligible === false, '51–100 not checkout')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_100_plus', interval: 'monthly' }).checkoutEligible === false, '100+ not checkout')
  assert(quoteBillingSelection({ product: 'alza_flow_pay', userBand: 'users_1_3', interval: 'monthly' }).checkoutEligible === false, 'Flow Pay not checkout')
  assert(signupPathForPlan('flow_1_3_monthly') === '/signup?plan_key=flow_1_3_monthly', '1–3 monthly signup path')
  assert(BILLING_CHECKOUT_SKUS.length === 8, '8 checkout SKUs')
}

console.log('E. Preview, claims, and dead-link hygiene')
{
  assert(preview.includes('CommissionWorkspacePreview'), 'single workspace preview')
  assert(!preview.includes('Clip coming soon'), 'preview has no clip placeholder')
  assert(!preview.includes('<video'), 'preview does not render video')
  assert(!landing.includes('<video'), 'landing does not render video')
  assert(landing.includes('CommissionWorkspacePreview'), 'landing uses single workspace preview')
  assert(!landing.includes('<ProductPreview'), 'old four-card component unused')
  assert(preview.includes('Expected') && preview.includes('Received'), 'generic preview labels')
  assert(!/\$\d/.test(preview), 'preview has no dollar amounts')
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
  ]) {
    assert(!landing.toLowerCase().includes(banned.toLowerCase()), `no invented/banned: ${banned}`)
  }
  assert(PUBLIC_DEMO_MAILTO.startsWith('mailto:support@alzabusiness.com'), 'demo uses existing support inbox')
  assert(PUBLIC_PRICING_INQUIRY_MAILTO.startsWith('mailto:support@alzabusiness.com'), 'pricing inquiry uses existing support inbox')
  assert(landing.includes("href: '#product'"), 'Product anchor')
  assert(landing.includes("href: '#how-it-works'"), 'How It Works anchor')
  assert(landing.includes('kind: \'route\''), 'Pricing nav is a route')
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
  assert(login.includes('PUBLIC_LANDING_PATH') || login.includes(PUBLIC_PRICING_PATH), 'login still links to public pricing/signup')
  assert(PUBLIC_PRICING_PATH === '/pricing', 'pricing path constant')
}

console.log('')
console.log(`Public landing: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
