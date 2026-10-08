/**
 * Offline checks for explicit cancellation of a created Razorpay subscription.
 * Does NOT call Razorpay. Does NOT read or write customer records.
 *
 * Run: npx tsx scripts/validate-created-subscription-cancellation.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canResumeCheckout } from '../src/lib/billingCatalog.ts'
import {
  CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
  CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE,
  cancelledSubscriptionMirrorAction,
  createdSubscriptionCancelRoute,
  isExplicitlyCancelledStatus,
  localCreatedCancellationPatch,
  reconciliationConflictResolvedByCurrentSubscription,
  reconciliationMarkerComplete,
  reconciliationNoticeMatchesWorkspace,
  reconciliationNoticeVisible,
  subscriptionIdsConflict,
  tenantNoteConflicts,
  webhookDiscrepancyRetryAction,
  type ReconciliationNoticeRecord,
} from '../supabase/functions/_shared/razorpayCancellation.ts'

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

function assertEq<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (got ${String(actual)}, expected ${String(expected)})`)
}

function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

console.log('1. Abandoned checkout stays resumable')
{
  assert(canResumeCheckout('created', 'sub_created'), 'created with subscription id can resume')
  assert(!canResumeCheckout('cancelled', 'sub_created'), 'explicit cancel removes Resume Payment')
  const page = read('src/pages/admin/SubscriptionBilling.tsx')
  const dismissAt = page.indexOf('if (checkout.dismissed)')
  const dismiss = page.slice(dismissAt, page.indexOf('startProcessingPoll()', dismissAt))
  assert(dismiss.includes('use Resume Payment to continue'), 'dismiss tells the owner to resume')
  assert(!dismiss.includes('cancelRazorpaySubscription'), 'dismiss does not cancel')
}

console.log('2. Created subscription uses local cancel only while Razorpay is still created')
{
  assertEq(createdSubscriptionCancelRoute('created'), 'local_cancel', 'remote created stays local')
  assertEq(createdSubscriptionCancelRoute('cancelled'), 'local_cancel', 'remote cancelled is stored locally')
  assertEq(createdSubscriptionCancelRoute('completed'), 'local_cancel', 'remote completed is stored locally')
  for (const status of ['authenticated', 'active', 'pending', 'paused', 'halted']) {
    assertEq(createdSubscriptionCancelRoute(status), 'api_cancel', `${status} uses the Razorpay cancel API`)
  }
  const patch = localCreatedCancellationPatch('2026-10-08T00:00:00.000Z')
  assertEq(patch.status, 'cancelled', 'local cancel sets cancelled')
  assert(!('razorpay_subscription_id' in patch), 'local cancel keeps the subscription id')
  assert(!('plan_key' in patch), 'local cancel keeps plan_key')
  assert(!('razorpay_plan_id' in patch), 'local cancel keeps the Razorpay plan id')
  assert(!('product_key' in patch), 'local cancel keeps the product')
}

console.log('3. Cancellation endpoint keeps tenant isolation')
{
  const cancel = read('supabase/functions/cancel-razorpay-subscription/index.ts')
  assert(cancel.includes('getCallerAgency'), 'cancel resolves the caller agency')
  assert(cancel.includes('agencyLifecycleAllowsBilling'), 'cancel checks a suspended workspace')
  assert(!cancel.includes('getSingletonAgency'), 'cancel does not use the singleton agency lookup')
  assert(cancel.includes('razorpayGetSubscription'), 'created cancel reads Razorpay before writing')
  assert(cancel.includes("createdSubscriptionCancelRoute(remoteStatus) === 'local_cancel'"), 'local path is gated')
  assert(cancel.includes(".eq('status', 'created')"), 'local write is conditional on created')
  assert(cancel.includes(".eq('agency_profile_id', agency.data.id)"), 'write is pinned to the caller workspace')
  const localBranch = cancel.slice(
    cancel.indexOf("if (status === 'created')"),
    cancel.indexOf('const cancelRes = await razorpayRequest'),
  )
  assert(!localBranch.includes('/cancel'), 'local created path does not call the cancel API')
  assert(cancel.includes('/subscriptions/${subscriptionId}/cancel'), 'authenticated path still calls Razorpay cancel')
  assert(cancel.includes('cancel_at_cycle_end: 0'), 'immediate cancel flag is unchanged')
}

console.log('4. Webhook and Refresh sync cannot reopen a local cancellation')
{
  assertEq(cancelledSubscriptionMirrorAction('active', 'active'), 'apply', 'live row still mirrors')
  assertEq(cancelledSubscriptionMirrorAction('cancelled', 'created'), 'hold', 'stale created event does not reopen')
  assertEq(cancelledSubscriptionMirrorAction('canceled', 'pending'), 'hold', 'stale pending event does not reopen')
  assertEq(cancelledSubscriptionMirrorAction('cancelled', 'paused'), 'hold', 'stale paused event does not reopen')
  assertEq(
    cancelledSubscriptionMirrorAction('cancelled', 'active'),
    'discrepancy',
    'later activation is held for reconciliation',
  )
  assertEq(
    cancelledSubscriptionMirrorAction('cancelled', 'authenticated'),
    'discrepancy',
    'later authentication is held for reconciliation',
  )
  assertEq(
    cancelledSubscriptionMirrorAction('cancelled', 'cancelled'),
    'apply',
    'a remote cancellation can still be stored',
  )
  assert(isExplicitlyCancelledStatus('canceled'), 'American spelling is treated as cancelled')

  const mirror = read('supabase/functions/_shared/billing.ts')
  assert(mirror.includes('cancelledSubscriptionMirrorAction'), 'mirror uses the cancellation guard')
  assert(mirror.includes('subscriptionIdsConflict'), 'mirror refuses a different subscription id')
  assert(mirror.includes('tenantNoteConflicts'), 'mirror refuses a different workspace note')
  assert(mirror.includes('More than one workspace is linked'), 'mirror refuses an ambiguous subscription id')
  assert(!mirror.includes('maybeMarkBillingPending(admin, agencyId, status)'), 'access promotion is not unconditional')

  const webhook = read('supabase/functions/razorpay-webhook/index.ts')
  assert(webhook.includes('await mirrorSubscriptionEntity(admin, subscriptionEntity)'), 'webhook still mirrors')
  assert(webhook.includes('alza_reconciliation'), 'discrepancy is stored on the webhook event')
  assert(webhook.includes('workspaceAccessGranted: false'), 'discrepancy does not grant workspace access')
  assert(webhook.includes('return ok({ received: true, eventId, type: eventType })'), 'webhook acknowledgement remains')

  const sync = read('supabase/functions/sync-razorpay-subscription/index.ts')
  assert(sync.includes('workspaceUnlock: mirrored.applied && remoteStatus === \'active\''), 'Refresh unlock follows the applied row')
  assert(sync.includes('reconciliationRequired'), 'Refresh reports a payment discrepancy')
}

console.log('5. Payment after local cancel is visible and does not activate the workspace')
{
  assert(
    CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE.includes('The workspace was not activated'),
    'admin message says access was not granted',
  )
  assert(
    CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE.includes('ALZA needs to reconcile'),
    'admin message says ALZA must reconcile the payment',
  )
  assertEq(
    CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
    'cancelled_subscription_payment_reported',
    'discrepancy code is stable',
  )
  const page = read('src/pages/admin/SubscriptionBilling.tsx')
  assert(page.includes('synced.data?.reconciliationRequired'), 'billing page surfaces the discrepancy')
  assert(page.includes('CancelledSubscriptionReconciliationNotice'), 'billing page renders one reconciliation warning')
  const resume = page.slice(page.indexOf('async function handleResumePayment'), page.indexOf('async function handleCancel'))
  const reconcile = resume.indexOf('reconciliationRequired')
  const unlock = resume.indexOf('workspaceUnlock')
  assert(reconcile >= 0 && reconcile < unlock, 'Resume Payment checks the discrepancy before activation')
  const reconcileBranch = resume.slice(reconcile, unlock)
  assert(!reconcileBranch.includes('attemptOnboardingHandoff'), 'Resume Payment does not activate after a discrepancy')
}

console.log('6. Matching cannot attach an event to another subscription or tenant')
{
  assert(subscriptionIdsConflict('sub_old', 'sub_new'), 'different subscription ids conflict')
  assert(!subscriptionIdsConflict('', 'sub_new'), 'an empty stored id can receive the first subscription')
  assert(!subscriptionIdsConflict('sub_same', 'sub_same'), 'the same subscription id matches')
  assert(tenantNoteConflicts('agency-a', 'agency-b'), 'notes for another workspace conflict')
  assert(!tenantNoteConflicts('', 'agency-b'), 'missing notes do not invent a tenant conflict')
  assert(!tenantNoteConflicts('agency-a', 'agency-a'), 'matching notes are accepted')
}

console.log('7. A later payment is visible to that workspace without Refresh')
{
  const workspace = {
    agencyProfileId: 'agency-a',
    currentSubscriptionId: 'sub_cancelled',
    currentStatus: 'cancelled',
  }
  const payment: ReconciliationNoticeRecord = {
    code: CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
    agencyProfileId: 'agency-a',
    subscriptionId: 'sub_cancelled',
    localStatus: 'cancelled',
    remoteStatus: 'active',
    workspaceAccessGranted: false,
  }
  const authenticated = { ...payment, remoteStatus: 'authenticated' }
  assert(reconciliationNoticeMatchesWorkspace(payment, workspace), 'active payment is visible to the same workspace')
  assert(
    reconciliationNoticeMatchesWorkspace(authenticated, workspace),
    'authenticated payment is visible to the same workspace',
  )
  assertEq(
    reconciliationNoticeVisible([payment, authenticated, payment], workspace),
    true,
    'duplicate payment events produce one notice',
  )
  assertEq(reconciliationNoticeVisible([payment, payment], workspace), reconciliationNoticeVisible([payment], workspace), 'a second delivery does not change the notice')
  assert(
    !reconciliationNoticeMatchesWorkspace({ ...payment, agencyProfileId: 'agency-b' }, workspace),
    'another tenant is not visible',
  )
  assert(
    !reconciliationNoticeMatchesWorkspace(payment, { ...workspace, agencyProfileId: 'agency-b' }),
    'a workspace cannot see another tenant record',
  )
  assert(
    reconciliationNoticeMatchesWorkspace(
      { ...payment, subscriptionId: 'sub_earlier' },
      { ...workspace, currentSubscriptionId: 'sub_new', currentStatus: 'created' },
    ),
    'an earlier cancelled subscription stays visible after a new checkout',
  )
  assert(
    !reconciliationNoticeMatchesWorkspace({ ...payment, subscriptionId: '' }, workspace),
    'a marker without a subscription id is not visible',
  )
  assert(
    !reconciliationNoticeMatchesWorkspace({ ...payment, workspaceAccessGranted: true }, workspace),
    'a record that claims access was granted is not shown as this notice',
  )
  assert(
    !reconciliationNoticeMatchesWorkspace({ ...payment, remoteStatus: 'created' }, workspace),
    'a stale created event is not a payment notice',
  )
  assert(
    !reconciliationNoticeMatchesWorkspace(payment, { ...workspace, currentStatus: 'active' }),
    'activating the same subscription clears that conflict',
  )
  assert(
    reconciliationNoticeMatchesWorkspace(payment, {
      agencyProfileId: 'agency-a',
      currentSubscriptionId: 'sub_new',
      currentStatus: 'active',
    }),
    'a newer active subscription does not hide the earlier conflict',
  )
  assert(!reconciliationNoticeVisible([null, undefined], workspace), 'empty webhook records stay hidden')

  const notice = read('supabase/functions/billing-reconciliation-notice/index.ts')
  assert(notice.includes('getCallerAgency'), 'notice resolves the caller agency')
  assert(notice.includes('getExistingBillingRow(admin, agency.data.id)'), 'notice loads only the caller billing row')
  assert(notice.includes('agency.data.id'), 'notice filters webhook records by the caller workspace')
  const containsFilter = notice.slice(notice.indexOf('.contains('), notice.indexOf('.limit('))
  assert(!containsFilter.includes('subscriptionId'), 'notice is not limited to the current checkout id')
  assert(notice.includes('currentSubscriptionId'), 'notice can tell an earlier subscription from the current one')
  assert(!notice.includes('getSingletonAgency'), 'notice does not use the singleton agency lookup')
  assert(!notice.includes('req.json'), 'notice ignores a client-supplied agency or subscription id')
  assert(!notice.includes('razorpayGetSubscription') && !notice.includes('razorpayRequest'), 'notice does not call Razorpay')
  assert(!notice.includes('.update(') && !notice.includes('.insert('), 'notice does not write billing data')
  assert(notice.includes('return ok({ visible })'), 'notice returns visibility only')
  assert(!notice.includes('workspaceUnlock'), 'notice cannot grant workspace access')
  assert(!notice.includes('maybeMarkBillingPending'), 'notice does not promote the workspace')

  const webhook = read('supabase/functions/razorpay-webhook/index.ts')
  const duplicateFn = webhook.slice(
    webhook.indexOf('async function acknowledgeDuplicateWebhook'),
    webhook.indexOf('Deno.serve'),
  )
  assert(!duplicateFn.includes('mirrorSubscriptionEntity'), 'a duplicate delivery does not apply the subscription mirror')
  assert(duplicateFn.includes('findCancellationPaymentDiscrepancy'), 'a duplicate delivery can finish a missing conflict marker')
  assert(webhook.includes('return ok({ received: true, eventId, type: eventType })'), 'successful webhook acknowledgement is unchanged')

  const page = read('src/pages/admin/SubscriptionBilling.tsx')
  const refreshFn = page.slice(page.indexOf('const handleRefresh'), page.indexOf('const recommendedBand'))
  assert(!refreshFn.includes('useCancelledPaymentReconciliationNotice'), 'the warning does not wait for Refresh')
  assert(page.includes('useCancelledPaymentReconciliationNotice(canManage)'), 'billing keeps watching after a new checkout starts')
  assert(page.includes('visible={watchedPaymentConflict || paymentConflictFromSync}'), 'billing shows a single warning')

  const screen = read('src/components/billing/WorkspaceActivationScreen.tsx')
  assert(screen.includes("reason === 'cancelled' && canManageBilling"), 'the restricted screen watches only for that workspace owner or admin')
  assert(screen.includes('<CancelledSubscriptionReconciliationNotice'), 'the restricted screen shows the same warning')

  const widget = read('src/components/billing/CancelledSubscriptionReconciliationNotice.tsx')
  assert(widget.includes('CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE'), 'the warning explains reconciliation and restricted access')
  assert(widget.includes('if (notice.visible) setVisible(true)'), 'a notice turns the warning on once')
  assert(widget.includes('if (!enabled)'), 'leaving the cancelled subscription clears the warning')
  assert(!widget.includes('syncRazorpaySubscription'), 'the warning does not call Razorpay')
  assert(!widget.includes('setVisible(notice.visible)'), 'a duplicate poll does not toggle a second alert')

  const client = read('src/lib/billing.ts')
  assert(client.includes("invoke('billing-reconciliation-notice'"), 'client reads the notice function')
  assert(client.includes('body: {}'), 'client does not send tenant identifiers')
  const config = read('supabase/config.toml')
  assert(
    /\[functions\.billing-reconciliation-notice\]\s*\r?\nverify_jwt = true/.test(config),
    'notice function requires a signed-in caller',
  )
}

console.log('8. Conflict durability: failed marker write and a later checkout')
{
  const stored = {
    alza_reconciliation: {
      code: CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
      agencyProfileId: 'agency-a',
      subscriptionId: 'sub_cancelled',
      localStatus: 'cancelled',
      remoteStatus: 'active',
      workspaceAccessGranted: false,
    },
  }
  assert(reconciliationMarkerComplete(stored), 'a complete marker ends the retry')
  assert(!reconciliationMarkerComplete({ event: 'subscription.activated' }), 'a payload without the marker must retry')
  assert(
    !reconciliationMarkerComplete({
      alza_reconciliation: { ...stored.alza_reconciliation, agencyProfileId: '' },
    }),
    'an incomplete marker does not count as stored',
  )
  assertEq(
    webhookDiscrepancyRetryAction({
      markerAlreadyStored: true,
      discrepancyFound: true,
      recordSucceeded: null,
    }),
    'acknowledge',
    'a duplicate delivery with the marker does not reprocess',
  )
  assertEq(
    webhookDiscrepancyRetryAction({
      markerAlreadyStored: false,
      discrepancyFound: false,
      recordSucceeded: null,
    }),
    'acknowledge',
    'a duplicate delivery that is not a payment conflict does not apply again',
  )
  assertEq(
    webhookDiscrepancyRetryAction({
      markerAlreadyStored: false,
      discrepancyFound: true,
      recordSucceeded: false,
    }),
    'reject',
    'a failed conflict write is not acknowledged',
  )
  assertEq(
    webhookDiscrepancyRetryAction({
      markerAlreadyStored: false,
      discrepancyFound: true,
      recordSucceeded: true,
    }),
    'acknowledge',
    'a repaired conflict write can then be acknowledged',
  )

  const earlier: ReconciliationNoticeRecord = {
    code: CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
    agencyProfileId: 'agency-a',
    subscriptionId: 'sub_cancelled',
    localStatus: 'cancelled',
    remoteStatus: 'authenticated',
    workspaceAccessGranted: false,
  }
  const replacementCheckout = {
    agencyProfileId: 'agency-a',
    currentSubscriptionId: 'sub_new',
    currentStatus: 'created',
  }
  assert(
    reconciliationNoticeVisible([earlier, earlier], replacementCheckout),
    'duplicate events for the earlier subscription stay one notice after a new checkout',
  )
  assert(
    !reconciliationNoticeVisible(
      [{ ...earlier, agencyProfileId: 'agency-b' }],
      replacementCheckout,
    ),
    'a new checkout cannot reveal another tenant conflict',
  )
  assert(
    !reconciliationConflictResolvedByCurrentSubscription(earlier, replacementCheckout),
    'a new checkout does not resolve the earlier subscription',
  )
  assert(
    reconciliationConflictResolvedByCurrentSubscription(earlier, {
      agencyProfileId: 'agency-a',
      currentSubscriptionId: 'sub_cancelled',
      currentStatus: 'active',
    }),
    'the same subscription becoming active resolves that conflict',
  )

  const webhook = read('supabase/functions/razorpay-webhook/index.ts')
  const handler = webhook.slice(webhook.indexOf('Deno.serve'))
  const recordFailure = handler.indexOf("return fail('reconciliation_record_failed', 'Payment conflict was not saved.', 500)")
  const successAck = handler.indexOf('return ok({ received: true, eventId, type: eventType })')
  assert(recordFailure >= 0 && successAck > recordFailure, 'a failed conflict write returns before acknowledgement')
  const duplicateFn = webhook.slice(
    webhook.indexOf('async function acknowledgeDuplicateWebhook'),
    webhook.indexOf('Deno.serve'),
  )
  assert(duplicateFn.includes('webhookDiscrepancyRetryAction'), 'duplicate handling uses the retry decision')
  assert(!duplicateFn.includes('.update('), 'the duplicate path does not apply a billing update')

  const shared = read('supabase/functions/_shared/billing.ts')
  const inspect = shared.slice(
    shared.indexOf('export async function findCancellationPaymentDiscrepancy'),
    shared.indexOf('export async function mirrorSubscriptionEntity'),
  )
  assert(inspect.includes("cancelledSubscriptionMirrorAction"), 'retry inspection uses the cancellation guard')
  assert(!inspect.includes('.update('), 'retry inspection does not write a subscription')
  assert(!inspect.includes('maybeMarkBillingPending'), 'retry inspection does not promote the workspace')

  const page = read('src/pages/admin/SubscriptionBilling.tsx')
  assert(!page.includes('watchCancelledPayment'), 'the billing warning is not tied to the current cancelled status')
}

console.log('')
console.log(`Created subscription cancellation: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
