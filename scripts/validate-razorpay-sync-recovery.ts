/**
 * Phase 3.2G — webhook GRANT + GET-only subscription sync (offline).
 * Does NOT call Razorpay. Does NOT apply migrations. Does NOT touch Production.
 *
 * Run: npx tsx scripts/validate-razorpay-sync-recovery.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canResumeCheckout,
  shouldAttemptRazorpaySync,
} from '../src/lib/billingCatalog.ts'
import {
  billingAllowsOnboardingHandoff,
  confirmOnboardingHandoff,
} from '../src/lib/onboardingHandoff.ts'

const root = resolve(process.cwd())

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

function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

const migrationName = 'supabase/migrations/20260914154500_billing_webhook_events_service_role_grants.sql'
const webhook = read('supabase/functions/razorpay-webhook/index.ts')
const sharedBilling = read('supabase/functions/_shared/billing.ts')
const syncFn = read('supabase/functions/sync-razorpay-subscription/index.ts')
const config = read('supabase/config.toml')
const billingPage = read('src/pages/admin/SubscriptionBilling.tsx')
const billingLib = read('src/lib/billing.ts')
const migration = read(migrationName)

console.log('1. service_role INSERT grant')
{
  assert(existsSync(resolve(root, migrationName)), 'migration file exists')
  assert(migration.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_webhook_events TO service_role'), 'GRANT DML to service_role')
  assert(
    migration.includes("has_table_privilege('service_role', 'public.billing_webhook_events', 'INSERT')"),
    'migration asserts service_role INSERT',
  )
}

console.log('2. authenticated/anon cannot write webhook events')
{
  assert(migration.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.billing_webhook_events FROM authenticated'), 'REVOKE authenticated writes')
  assert(migration.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.billing_webhook_events FROM anon'), 'REVOKE anon writes')
  assert(migration.includes("has_table_privilege('authenticated', 'public.billing_webhook_events', 'INSERT')"), 'asserts authenticated cannot INSERT')
  assert(!/CREATE POLICY[\s\S]*billing_webhook_events[\s\S]*FOR INSERT/i.test(migration), 'no customer INSERT policy')
  assert(migration.includes('relrowsecurity'), 'RLS remains enabled')
}

console.log('3. webhook HMAC is raw-body-first')
{
  const textIdx = webhook.indexOf('await req.text()')
  const verifyIdx = webhook.indexOf('await verifySignature(rawBody, signature, webhookSecret)')
  const parseIdx = webhook.indexOf('JSON.parse(rawBody)')
  assert(textIdx >= 0 && verifyIdx > textIdx && parseIdx > verifyIdx, 'req.text → HMAC → JSON.parse')
  assert(webhook.includes("req.headers.get('x-razorpay-signature')"), 'reads x-razorpay-signature')
  assert(webhook.includes("Deno.env.get('RAZORPAY_WEBHOOK_SECRET')"), 'uses RAZORPAY_WEBHOOK_SECRET')
  assert(!webhook.includes('JSON.stringify') || webhook.indexOf('JSON.stringify') < 0 || !/verifySignature\([\s\S]*JSON\.stringify/.test(webhook), 'HMAC is not over re-serialized JSON')
}

console.log('4. webhook logs receipt then mirrors')
{
  const insertIdx = webhook.indexOf("from('billing_webhook_events').insert")
  const mirrorIdx = webhook.indexOf('await mirrorSubscriptionEntity(admin, subscriptionEntity)')
  assert(insertIdx >= 0 && mirrorIdx > insertIdx, 'insert billing_webhook_events before mirror')
  assert(webhook.includes("subscription.activated"), 'handles subscription.activated')
  assert(webhook.includes("subscription.authenticated"), 'handles subscription.authenticated')
  assert(webhook.includes("subscription.charged"), 'handles subscription.charged')
  assert(sharedBilling.includes('export async function mirrorSubscriptionEntity'), 'shared mirror exists')
}

console.log('5. sync is Razorpay GET only')
{
  assert(syncFn.includes('razorpayGetSubscription(storedId)'), 'sync uses GET helper')
  assert(!syncFn.includes("method: 'POST'") && !syncFn.includes('method: "POST"'), 'sync source has no Razorpay POST')
  assert(!/\b(PATCH|PUT|DELETE)\b/.test(syncFn.replace('req.method !== \'POST\'', '')), 'sync has no PATCH/PUT/DELETE')
  assert(sharedBilling.includes("method: 'GET'") && sharedBilling.includes('razorpayGetSubscription'), 'shared GET helper')
  assert(sharedBilling.includes('Never POST/PATCH/PUT/DELETE'), 'GET helper documents write ban')
  assert(!syncFn.includes('getOrCreateBillingRow'), 'sync does not create billing rows')
  assert(syncFn.includes('getExistingBillingRow'), 'sync loads existing billing row only')
}

console.log('6. sync rejections')
{
  assert(syncFn.includes('no_subscription'), 'rejects missing subscription id')
  assert(syncFn.includes('subscription_mismatch'), 'rejects wrong remote id')
  assert(syncFn.includes('plan_mismatch'), 'rejects wrong plan id')
  assert(syncFn.includes('tenant_mismatch'), 'rejects wrong agency note')
  assert(syncFn.includes('requireOwnerOrAdmin'), 'Owner/Admin only')
  assert(syncFn.includes('live_key_blocked'), 'LIVE keys blocked on staging')
  assert(syncFn.includes("startsWith('rzp_test_')"), 'staging requires rzp_test_')
  assert(syncFn.includes('Never trusts a client-supplied subscription_id'), 'ignores client sub id')
  assert(/\[functions\.sync-razorpay-subscription\]\s*\r?\nverify_jwt = true/.test(config), 'verify_jwt = true')
}

console.log('7–8. remote ACTIVE unlocks; non-active does not')
{
  assert(syncFn.includes("workspaceUnlock: remoteStatus === 'active'"), 'unlock flag only when remote active')
  assert(shouldAttemptRazorpaySync('created', 'sub_Tan9mBG1A0sm0i'), 'created + sub id may sync')
  assert(shouldAttemptRazorpaySync('pending', 'sub_Tan9mBG1A0sm0i'), 'pending + sub id may sync')
  assert(shouldAttemptRazorpaySync('incomplete', 'sub_Tan9mBG1A0sm0i'), 'incomplete + sub id may sync')
  assert(!shouldAttemptRazorpaySync('active', 'sub_Tan9mBG1A0sm0i'), 'local active does not need sync')
  assert(!shouldAttemptRazorpaySync('created', null), 'no sub id skips sync')
  assert(!billingAllowsOnboardingHandoff('created'), 'created does not allow onboarding')
  assert(!billingAllowsOnboardingHandoff('pending'), 'pending does not allow onboarding')
  assert(billingAllowsOnboardingHandoff('active'), 'active allows onboarding handoff check')
}

console.log('9–10. sync is idempotent and never creates a subscription')
{
  assert(!syncFn.includes("razorpayRequest('/subscriptions'"), 'does not POST /subscriptions')
  assert(!syncFn.includes("method: 'POST'") && !syncFn.includes('/subscriptions",'), 'no create path')
  assert(syncFn.includes('mirrorSubscriptionEntity(admin, remote.data)'), 'reuses shared mirror')
  assert(webhook.includes('mirrorSubscriptionEntity(admin, subscriptionEntity)'), 'webhook uses same mirror')
}

console.log('11. already-active Razorpay does not reopen checkout')
{
  const resumeHandler = billingPage.slice(billingPage.indexOf('async function handleResumePayment'))
  const syncIdx = resumeHandler.indexOf('syncRazorpaySubscription()')
  const checkoutIdx = resumeHandler.indexOf('openCheckoutFromBootstrap')
  const unlockIdx = resumeHandler.indexOf('workspaceUnlock')
  assert(syncIdx >= 0 && unlockIdx > syncIdx && checkoutIdx > unlockIdx, 'Resume syncs before checkout')
  assert(resumeHandler.includes('return'), 'active path returns before checkout')
  assert(!canResumeCheckout('active', 'sub_Tan9mBG1A0sm0i'), 'local active hides Resume Payment')
}

console.log('12. genuinely-created still supports Resume Payment')
{
  assert(canResumeCheckout('created', 'sub_Tan9mBG1A0sm0i'), 'created + sub still Resume')
  assert(billingPage.includes('resumeRazorpayCheckout()'), 'Resume still calls checkout resume')
  assert(billingPage.includes('Resume Payment'), 'Resume Payment copy remains')
}

console.log('13. client recovery + Phase 3.2A handoff still wired')
{
  assert(billingPage.includes('startProcessingPoll'), 'poll remains')
  assert(billingPage.includes('shouldAttemptRazorpaySync'), 'poll/refresh gated by shouldAttemptRazorpaySync')
  assert(billingPage.includes('handleRefresh'), 'Refresh handler exists')
  assert(billingPage.includes('void handleRefresh()'), 'Refresh button calls sync path')
  assert(billingLib.includes("invoke('sync-razorpay-subscription'"), 'client invokes sync function')
  assert(billingPage.includes('confirmOnboardingHandoff'), 'handoff protection remains')
  assert(billingPage.includes('attemptOnboardingHandoff'), 'gate confirm before /onboarding')
  const stay = await confirmOnboardingHandoff({
    billingStatus: 'created',
    refreshGate: async () => ({ state: 'ACTIVE', reason: 'none' }),
  })
  assert(stay.action === 'stay', 'created billing never navigates even if gate lies')
  const go = await confirmOnboardingHandoff({
    billingStatus: 'active',
    refreshGate: async () => ({ state: 'ACTIVE', reason: 'none' }),
  })
  assert(go.action === 'navigate', 'active + gate ACTIVE still navigates')
}

console.log('')
console.log(`Razorpay sync recovery: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
