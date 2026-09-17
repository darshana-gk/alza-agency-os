/**
 * Public sales inquiry + pricing presentation safety (offline).
 * Does not call Razorpay. Does not send email. Does not touch Production.
 *
 * Run: npx tsx scripts/validate-sales-inquiry.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  billingUserBands,
  quoteBillingSelection,
} from '../src/lib/billingCatalog.ts'
import { signupPathForPlan } from '../src/lib/purchaseIntent.ts'
import {
  firstNameFromFullName,
  parseSalesInquirySource,
  SALES_INQUIRY_HONEYPOT_FIELD,
  SALES_INQUIRY_LIMITS,
  SALES_INQUIRY_USER_BANDS,
  validateSalesInquiryInput,
} from '../src/lib/salesInquiry.ts'
import { PUBLIC_CONTACT_SALES_PATH } from '../src/lib/publicSite.ts'

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

const pricing = read('src/pages/Pricing.tsx')
const contact = read('src/pages/ContactSales.tsx')
const fn = read('supabase/functions/submit-sales-inquiry/index.ts')
const migration = read('supabase/migrations/20260917120000_sales_inquiries.sql')
const config = read('supabase/config.toml')
const app = read('src/App.tsx')
const catalog = read('src/lib/billingCatalog.ts')
const landing = read('src/pages/PublicLanding.tsx')
const talk = read('src/components/marketing/TalkToAlzaLink.tsx')

const valid = {
  fullName: 'Jordan Lee',
  workEmail: 'jordan@example.com',
  agencyName: 'Example Agency',
  userBand: '51-100',
  phone: '555-0100',
  message: 'Need a walkthrough',
  consent: true,
  source: 'pricing_contact',
  companyWebsite: '',
}

console.log('A. Public pricing presentation')
{
  assert(!pricing.includes('flow_1_3_monthly'), 'SKU flow_1_3_monthly hidden')
  assert(!pricing.includes('flow_4_10_monthly'), 'SKU flow_4_10_monthly hidden')
  assert(!pricing.includes('flow_11_25_monthly'), 'SKU flow_11_25_monthly hidden')
  assert(!pricing.includes('flow_26_50_monthly'), 'SKU flow_26_50_monthly hidden')
  assert(!pricing.includes('flow_1_3_annual'), 'annual SKU hidden')
  assert(!pricing.includes('Self-service'), 'Self-service label removed')
  assert(!pricing.includes('For larger agencies that need a tailored conversation'), '51+ extra sentence removed')
  assert(!pricing.includes('Checkout is not available yet'), 'Flow Pay extra sentence removed')
  assert(pricing.includes('51+ users'), '51+ card')
  assert(pricing.includes('Custom Pricing'), 'custom pricing copy')
  assert(!pricing.includes('$1,499'), 'no $1,499')
  assert(!pricing.includes('1499'), 'no 1499 literal on pricing page')
  assert(!pricing.includes('51–100 users'), 'old 51–100 card gone')
  assert(!pricing.includes('100+ / complex'), 'old 100+ card gone')
  assert(!/\bPopular\b/.test(pricing), 'no Popular')
  assert(!pricing.includes('Recommended'), 'no Recommended')
  assert(pricing.includes('Coming Soon'), 'Flow Pay Coming Soon')
  assert(pricing.includes('Waitlist only'), 'Flow Pay waitlist')
  assert(pricing.includes('ArrowRight'), 'Get Started arrow')
  assert(pricing.includes('contactSalesPath'), '51+ uses contact-sales')
  assert(pricing.includes('Contact us'), '51+ CTA is Contact us')
  assert(pricing.includes('max-w-[44rem]'), 'secondary row width-capped')
}

console.log('B. Self-service catalog unchanged')
{
  assert(BILLING_CHECKOUT_SKUS.length === 8, '8 checkout SKUs')
  assert(BILLING_CHECKOUT_SKUS.includes('flow_1_3_monthly'), '1–3 monthly SKU remains')
  assert(BILLING_CHECKOUT_SKUS.includes('flow_26_50_annual'), '26–50 annual SKU remains')
  const bands = billingUserBands('alza_flow')
  assert(bands.filter((b) => b.checkoutEligible).length === 4, '4 self-serve bands')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_1_3', interval: 'monthly' }).amount === 399, '1–3 monthly $399')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_4_10', interval: 'monthly' }).amount === 599, '4–10 monthly $599')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_11_25', interval: 'monthly' }).amount === 899, '11–25 monthly $899')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_26_50', interval: 'monthly' }).amount === 1099, '26–50 monthly $1,099')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_1_3', interval: 'annual' }).amount === 3990, '1–3 annual')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_4_10', interval: 'annual' }).amount === 5990, '4–10 annual')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_11_25', interval: 'annual' }).amount === 8990, '11–25 annual')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_26_50', interval: 'annual' }).amount === 10990, '26–50 annual')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_51_100', interval: 'monthly' }).checkoutEligible === false, '51–100 not checkout')
  assert(quoteBillingSelection({ product: 'alza_flow', userBand: 'users_100_plus', interval: 'monthly' }).checkoutEligible === false, '100+ not checkout')
  assert(signupPathForPlan('flow_1_3_monthly') === '/signup?plan_key=flow_1_3_monthly', 'signup path unchanged')
  assert(catalog.includes("key: 'users_51_100'"), 'internal 51–100 band retained')
  assert(catalog.includes('monthly: 1499'), 'internal 1499 guidance retained off public page')
}

console.log('C. Client validation')
{
  assert(validateSalesInquiryInput(valid).ok === true, 'valid submission accepted')
  const badEmail = validateSalesInquiryInput({ ...valid, workEmail: 'not-an-email' })
  assert(badEmail.ok === false && !badEmail.ok && 'code' in badEmail && badEmail.code === 'email_invalid', 'invalid email rejected')
  assert(validateSalesInquiryInput({ ...valid, fullName: '' }).ok === false, 'required full name')
  assert(validateSalesInquiryInput({ ...valid, agencyName: '' }).ok === false, 'required agency')
  assert(validateSalesInquiryInput({ ...valid, userBand: '' }).ok === false, 'required user band')
  assert(validateSalesInquiryInput({ ...valid, consent: false }).ok === false, 'consent required')
  const honey = validateSalesInquiryInput({ ...valid, companyWebsite: 'https://spam.test' })
  assert(honey.ok === false, 'honeypot rejected')
  const long = validateSalesInquiryInput({ ...valid, message: 'x'.repeat(SALES_INQUIRY_LIMITS.message + 1) })
  assert(long.ok === false, 'oversized message rejected')
  const html = validateSalesInquiryInput({ ...valid, message: '<script>alert(1)</script>' })
  assert(html.ok === true, 'HTML accepted as untrusted text')
  assert(
    html.ok === true && html.value.message === '<script>alert(1)</script>',
    'HTML not executed or stripped as markup language',
  )
  assert(SALES_INQUIRY_USER_BANDS.join(',') === '51-100,101-250,251-500,500+', 'user band options')
  assert(parseSalesInquirySource('pricing') === 'pricing_contact', 'pricing source maps')
  assert(parseSalesInquirySource('landing') === 'landing_contact', 'landing source default')
  assert(parseSalesInquirySource('header_contact') === 'header_contact', 'header source maps')
  assert(parseSalesInquirySource('pricing_contact') === 'pricing_contact', 'pricing_contact unchanged')
  assert(parseSalesInquirySource('landing_contact') === 'landing_contact', 'landing_contact unchanged')
  assert(firstNameFromFullName('Jordan Lee') === 'Jordan', 'first name for ack')
}

console.log('D. Route, form, storage, anti-spam architecture')
{
  assert(PUBLIC_CONTACT_SALES_PATH === '/contact-sales', 'route constant')
  assert(app.includes('/contact-sales') && app.includes('ContactSalesPage'), 'App public route')
  assert(contact.includes('Talk to ALZA'), 'form heading')
  assert(contact.includes('Full Name'), 'full name field')
  assert(contact.includes('Work Email'), 'work email field')
  assert(contact.includes('Agency Name'), 'agency name field')
  assert(contact.includes('Number of Users'), 'users field')
  assert(contact.includes('Send Inquiry'), 'submit copy')
  assert(contact.includes('Inquiry received.'), 'on-screen confirmation')
  assert(!contact.includes('We sent you an email'), 'does not claim email unless acknowledged')
  assert(contact.includes('acknowledged'), 'ack status can show confirmation email line')
  assert(contact.includes('SALES_INQUIRY_HONEYPOT_FIELD'), 'honeypot field in form')
  assert(fn.includes("verifyTurnstile"), 'Turnstile hook present')
  assert(fn.includes('TURNSTILE_SECRET_KEY'), 'Turnstile secret read only if configured')
  assert(fn.includes('RATE_IP_MAX'), 'IP rate limiting')
  assert(fn.includes('RATE_EMAIL_MAX'), 'email rate limiting')
  assert(fn.includes('payload_hash'), 'duplicate suppression hash')
  assert(fn.includes('escapeHtml'), 'email HTML escaped')
  assert(fn.includes('RESEND_API_KEY'), 'uses existing Resend infrastructure')
  assert(fn.includes('New ALZA Flow Sales Inquiry'), 'ALZA notification subject')
  assert(fn.includes("We've received your ALZA Flow inquiry"), 'customer ack subject')
  assert(fn.includes("companyWebsite"), 'server honeypot check')
  assert(migration.includes('ENABLE ROW LEVEL SECURITY'), 'RLS enabled')
  assert(migration.includes('FORCE ROW LEVEL SECURITY'), 'RLS forced')
  assert(migration.includes('REVOKE ALL ON TABLE public.sales_inquiries FROM anon'), 'anon cannot read')
  assert(migration.includes('REVOKE ALL ON TABLE public.sales_inquiries FROM authenticated'), 'authenticated cannot read')
  assert(migration.includes('GRANT SELECT, INSERT, UPDATE ON TABLE public.sales_inquiries TO service_role'), 'service role only')
  assert(config.includes('[functions.submit-sales-inquiry]'), 'function registered')
  assert(config.includes('verify_jwt = false'), 'public function jwt false exists')
  assert(existsSync(resolve(root, 'supabase/functions/submit-sales-inquiry/index.ts')), 'function file exists')
  assert(talk.includes('PUBLIC_CONTACT_SALES_PATH') || talk.includes('contactSalesPath'), 'Talk to ALZA uses contact-sales')
  assert(landing.includes('TalkToAlzaLink'), 'landing Talk to ALZA present')
  assert(landing.includes("contactSalesPath('header_contact')"), 'header Contact us source')
  assert(talk.includes('header_contact'), 'header source on public marketing header')
  assert(fn.includes('header_contact'), 'edge function accepts header_contact')
  assert(!/\bTURNSTILE_SITE_KEY\s*=\s*['"][A-Za-z0-9_-]{10,}/.test(contact), 'no invented Turnstile site key')
}

console.log('E. Navigation polish')
{
  assert(landing.includes('PublicBrandLink'), 'landing logo scroll/home')
  assert(landing.includes('BackToTopButton'), 'floating back to top')
  assert(landing.includes('aria-label="Back to top"') || read('src/components/marketing/BackToTopButton.tsx').includes('aria-label="Back to top"'), 'back to top accessible')
  assert(read('src/index.css').includes('prefers-reduced-motion'), 'reduced motion CSS')
  assert(read('src/components/marketing/BackToTopButton.tsx').includes("behavior: reduced ? 'auto' : 'smooth'"), 'reduced-motion scroll')
  assert(read('src/pages/Signup.tsx').includes('PublicBrandLink'), 'signup brand home')
  assert(read('src/pages/Login.tsx').includes('PublicBrandLink'), 'login brand home')
  assert(read('src/pages/ContactSales.tsx').includes('PublicMarketingHeader'), 'contact-sales brand home')
  assert(!read('src/pages/Pricing.tsx').includes('BackToTopButton'), 'pricing has no floating back-to-top')
  assert(!read('src/pages/Signup.tsx').includes('{intent?.planKey}'), 'signup SKU not rendered')
  assert(read('src/pages/Signup.tsx').includes('intentQuote.bandLabel'), 'signup shows band')
}

console.log('')
console.log(`Sales inquiry + public pricing: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
