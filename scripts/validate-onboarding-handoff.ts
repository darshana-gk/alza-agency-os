/**
 * Phase 3.2A — activation → onboarding handoff (offline).
 * Does NOT call Razorpay. Does NOT touch Production or billing rows.
 *
 * Run: npx tsx scripts/validate-onboarding-handoff.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ONBOARDING_HANDOFF_PATH,
  ONBOARDING_HANDOFF_REFRESH_FAILED_MESSAGE,
  ONBOARDING_HANDOFF_STILL_RESTRICTED_MESSAGE,
  billingAllowsOnboardingHandoff,
  confirmOnboardingHandoff,
  decideOnboardingHandoff,
} from '../src/lib/onboardingHandoff.ts'
import { applyWorkspaceSubscriptionAccess } from '../src/lib/subscriptionAccess.ts'
import {
  allowsNewCheckout,
  billingCatalogPrimaryAction,
  canResumeCheckout,
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

async function runHandoff(input: {
  billingStatus: string | null | undefined
  gate?: { state: 'ACTIVE' | 'RESTRICTED' | 'ERROR' | 'LOADING' } | null
  refreshThrows?: boolean
  alreadyHandedOff?: boolean
  inFlight?: boolean
}) {
  let refreshCalls = 0
  const decision = await confirmOnboardingHandoff({
    billingStatus: input.billingStatus,
    alreadyHandedOff: input.alreadyHandedOff,
    inFlight: input.inFlight,
    refreshGate: async () => {
      refreshCalls += 1
      if (input.refreshThrows) throw new Error('rpc failed')
      return input.gate ?? null
    },
  })
  return { decision, refreshCalls }
}

console.log('A. Poll reports active → gate ACTIVE → navigate once')
{
  const first = await runHandoff({ billingStatus: 'active', gate: { state: 'ACTIVE' } })
  assertEq(first.decision.action, 'navigate', 'A navigates')
  assert(first.decision.action === 'navigate' && first.decision.path === ONBOARDING_HANDOFF_PATH, 'A path /onboarding')
  assertEq(first.refreshCalls, 1, 'A refresh ran once')

  const second = await runHandoff({
    billingStatus: 'active',
    gate: { state: 'ACTIVE' },
    alreadyHandedOff: true,
  })
  assertEq(second.decision.action, 'stay', 'A second attempt stays')
  assertEq(second.refreshCalls, 0, 'A second attempt does not refresh')
}

console.log('B. Start Onboarding CTA uses the same confirm path')
{
  const cta = await runHandoff({ billingStatus: 'active', gate: { state: 'ACTIVE' } })
  assertEq(cta.decision.action, 'navigate', 'B CTA navigates')
  assertEq(cta.refreshCalls, 1, 'B CTA refreshes gate first')
  const page = readFileSync(resolve(process.cwd(), 'src/pages/admin/SubscriptionBilling.tsx'), 'utf8')
  assert(page.includes('data-testid="start-onboarding-cta"'), 'B Start Onboarding is a button CTA')
  assert(!page.includes('to="/onboarding"'), 'B Start Onboarding is not a raw Link')
  assert(page.includes('confirmOnboardingHandoff'), 'B page uses confirmOnboardingHandoff')
  assert(page.includes('refreshGate: gate.refresh'), 'B CTA/poll refresh SubscriptionAccessProvider')
}

console.log('C. Billing active but gate still RESTRICTED → do not navigate')
{
  const result = await runHandoff({ billingStatus: 'active', gate: { state: 'RESTRICTED' } })
  assertEq(result.decision.action, 'stay', 'C stays')
  assert(result.decision.action === 'stay' && result.decision.reason === 'gate_restricted', 'C reason restricted')
  assert(
    result.decision.action === 'stay' && result.decision.message === ONBOARDING_HANDOFF_STILL_RESTRICTED_MESSAGE,
    'C retry copy',
  )
  assertEq(result.refreshCalls, 1, 'C still refreshed the gate')
}

console.log('D. Gate refresh fails → do not navigate, no loop')
{
  const thrown = await runHandoff({ billingStatus: 'active', refreshThrows: true })
  assertEq(thrown.decision.action, 'stay', 'D throw stays')
  assert(thrown.decision.action === 'stay' && thrown.decision.reason === 'gate_refresh_failed', 'D throw reason')
  assert(
    thrown.decision.action === 'stay' && thrown.decision.message === ONBOARDING_HANDOFF_REFRESH_FAILED_MESSAGE,
    'D throw retry copy',
  )

  const empty = await runHandoff({ billingStatus: 'active', gate: null })
  assertEq(empty.decision.action, 'stay', 'D null refresh stays')
  assert(empty.decision.action === 'stay' && empty.decision.reason === 'gate_refresh_failed', 'D null reason')

  const errorState = await runHandoff({ billingStatus: 'active', gate: { state: 'ERROR' } })
  assertEq(errorState.decision.action, 'stay', 'D ERROR stays')

  const loop = decideOnboardingHandoff({
    billingStatus: 'active',
    gateState: 'ERROR',
    refreshFailed: true,
  })
  assertEq(loop.action, 'stay', 'D decision never navigates on refresh failure')
}

console.log('E. Non-active billing → do not navigate and do not refresh')
{
  for (const status of [
    'created',
    'incomplete',
    'pending',
    'halted',
    'cancelled',
    'completed',
    'authenticated',
    'paused',
    'canceled',
    null,
    '',
  ]) {
    const result = await runHandoff({ billingStatus: status, gate: { state: 'ACTIVE' } })
    assertEq(result.decision.action, 'stay', `E ${String(status) || 'empty'} stays`)
    assertEq(result.refreshCalls, 0, `E ${String(status) || 'empty'} does not call gate refresh`)
    assert(!billingAllowsOnboardingHandoff(status), `E ${String(status) || 'empty'} billing not active`)
  }
}

console.log('F. Created/unpaid checkout/resume behavior unchanged')
{
  assert(canResumeCheckout('created', 'sub_TEST123'), 'F created + sub can resume')
  assert(!canResumeCheckout('incomplete', 'sub_TEST123'), 'F incomplete cannot resume')
  assert(!canResumeCheckout('active', 'sub_TEST123'), 'F active cannot resume')
  assert(!allowsNewCheckout('created'), 'F created blocks new checkout')
  assert(allowsNewCheckout('incomplete'), 'F incomplete allows new checkout')
  assert(!allowsNewCheckout('active'), 'F active blocks new checkout')
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
  assertEq(resume, 'resume', 'F created same plan still resume')
}

console.log('G. Authoritative RPC mapping — billing row is not enough')
{
  const restricted = applyWorkspaceSubscriptionAccess({ access_state: 'restricted', reason: 'pending' })
  assertEq(restricted.state, 'RESTRICTED', 'G pending RPC stays restricted')
  const active = applyWorkspaceSubscriptionAccess({ access_state: 'active', reason: 'none', period_end_date: null })
  assertEq(active.state, 'ACTIVE', 'G active RPC opens')
  const failed = applyWorkspaceSubscriptionAccess(null, true)
  assertEq(failed.state, 'ERROR', 'G failed RPC is ERROR')
}

console.log('')
console.log(`Onboarding handoff: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
