/**
 * Prospect agency signup + restricted lifecycle validators (no network / no Razorpay).
 * Run: npx tsx scripts/validate-prospect-agency-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  agencyAllowsBillingCheckout,
  agencyAllowsOpsAccess,
  agencyAllowsRestrictedShell,
  isRestrictedShellPath,
  normalizeAgencyLifecycle,
  PROSPECT_HOME_PATH,
} from '../src/lib/agencyLifecycle.ts'
import { canAccessPath, getNavVisibility } from '../src/lib/permissions.ts'

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

console.log('A. Lifecycle helpers')
{
  assert(normalizeAgencyLifecycle(null) === 'active', 'unknown lifecycle defaults active')
  assert(agencyAllowsOpsAccess('active'), 'active allows ops')
  assert(!agencyAllowsOpsAccess('prospect'), 'prospect denies ops')
  assert(!agencyAllowsOpsAccess('billing_pending'), 'billing_pending denies ops')
  assert(!agencyAllowsOpsAccess('suspended'), 'suspended denies ops')
  assert(agencyAllowsBillingCheckout('prospect'), 'prospect may checkout')
  assert(!agencyAllowsBillingCheckout('suspended'), 'suspended cannot checkout')
  assert(agencyAllowsRestrictedShell('prospect'), 'prospect restricted shell')
  assert(isRestrictedShellPath('/admin/subscription-billing'), 'billing is restricted path')
  assert(!isRestrictedShellPath('/clients'), 'clients not restricted path')
  assert(PROSPECT_HOME_PATH === '/admin/subscription-billing', 'prospect home is billing')
}

console.log('B. Path matrix for prospect Owner')
{
  const role = 'owner'
  const life = 'prospect' as const
  assert(canAccessPath(role, '/admin/subscription-billing', life), 'prospect billing ok')
  assert(canAccessPath(role, '/admin/agency-settings', life), 'prospect settings ok')
  assert(canAccessPath(role, '/support', life), 'prospect support ok')
  assert(!canAccessPath(role, '/onboarding', life), 'prospect onboarding denied')
  assert(!canAccessPath(role, '/', life), 'prospect dashboard denied')
  assert(!canAccessPath(role, '/clients', life), 'prospect clients denied')
  assert(!canAccessPath(role, '/transactions', life), 'prospect transactions denied')
  assert(!canAccessPath(role, '/financials', life), 'prospect financials denied')
  assert(!canAccessPath(role, '/reconciliation', life), 'prospect reconciliation denied')
  assert(!canAccessPath(role, '/reports', life), 'prospect reports denied')
  assert(!canAccessPath(role, '/admin/users', life), 'prospect users admin denied')
  assert(!canAccessPath(role, '/admin/producers', life), 'prospect producers denied')
  assert(canAccessPath(role, '/clients', 'active'), 'active clients ok')
  assert(canAccessPath(role, '/onboarding', 'active'), 'active onboarding ok')
}

console.log('C. Nav visibility prospect vs active')
{
  const prospectNav = getNavVisibility('owner', 'prospect')
  assert(!prospectNav.clients && !prospectNav.dashboard, 'prospect nav hides ops')
  assert(prospectNav.subscriptionBilling && prospectNav.agencySettings, 'prospect nav shows billing/settings')
  assert(!prospectNav.onboardingImport && !prospectNav.users, 'prospect nav hides onboarding/users')
  const activeNav = getNavVisibility('owner', 'active')
  assert(activeNav.clients && activeNav.dashboard, 'active nav shows ops')
}

console.log('D. Migration + edge contracts')
{
  const migration = readFileSync(
    resolve(root, 'supabase/migrations/20260826140000_agency_lifecycle_prospect_billing.sql'),
    'utf8',
  )
  assert(/DO NOT apply until reviewed/i.test(migration), 'migration marked proposed')
  assert(migration.includes("lifecycle = 'active'"), 'backfill existing to active')
  assert(migration.includes('agency_profile_singleton'), 'drops singleton unique')
  assert(migration.includes('enforce_agency_lifecycle_immutable_for_clients'), 'lifecycle immutable for clients')
  assert(!/promote_agency_to_active/i.test(migration) || migration.includes('omit'), 'no owner promote RPC')

  const signup = readFileSync(
    resolve(root, 'supabase/functions/create-agency-signup/index.ts'),
    'utf8',
  )
  assert(signup.includes("lifecycle: 'prospect'"), 'signup creates prospect')
  assert(!signup.includes("lifecycle: 'active'"), 'signup never creates active')
  assert(!/role:\s*['\"]alza_support['\"]/.test(signup), 'signup never assigns alza_support role')

  const createSub = readFileSync(
    resolve(root, 'supabase/functions/create-razorpay-subscription/index.ts'),
    'utf8',
  )
  assert(createSub.includes('getCallerAgency'), 'create-sub uses caller agency')
  assert(!createSub.includes('getSingletonAgency'), 'create-sub not singleton')
  assert(createSub.includes('billing_pending'), 'checkout may set billing_pending')
  assert(!/lifecycle:\s*'active'/.test(createSub), 'create-sub never sets active')

  const webhook = readFileSync(resolve(root, 'supabase/functions/razorpay-webhook/index.ts'), 'utf8')
  assert(webhook.includes('maybeMarkBillingPending'), 'webhook may mark billing_pending')
  assert(!/lifecycle:\s*'active'/.test(webhook), 'webhook never sets active')

  const invite = readFileSync(resolve(root, 'supabase/functions/invite-alza-user/index.ts'), 'utf8')
  assert(invite.includes('agency_not_active'), 'invite blocks non-active agencies')
  assert(invite.includes('agency_membership_required'), 'invite requires caller agency')

  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
  assert(app.includes('SignupPage'), 'signup route wired')
  assert(app.includes('PROSPECT_HOME_PATH'), 'prospect home redirect')

  const signupPage = readFileSync(resolve(root, 'src/pages/Signup.tsx'), 'utf8')
  assert(signupPage.includes('create-agency-signup'), 'signup invokes edge function')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-prospect-agency-v1: ALL GREEN')
