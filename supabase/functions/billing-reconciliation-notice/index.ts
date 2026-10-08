// Deno Edge Function: billing-reconciliation-notice
// Owner/Admin read of an existing cancellation payment discrepancy.
// Does not call Razorpay. Does not write billing rows. Does not grant workspace access.
// Never trusts a client-supplied agency id or subscription id.
// verify_jwt = true

import {
  adminClient,
  asRecord,
  getCallerAgency,
  getExistingBillingRow,
  requireOwnerOrAdmin,
} from '../_shared/billing.ts'
import {
  CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
  reconciliationNoticeVisible,
} from '../_shared/razorpayCancellation.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 'POST required.', 405)
  }

  const admin = adminClient()
  const authz = await requireOwnerOrAdmin(admin, req.headers.get('Authorization'))
  if (!authz.ok) return authz.response

  const agency = await getCallerAgency(admin, authz.agencyProfileId)
  if (!agency.data) {
    return fail('agency_missing', agency.error ?? 'Agency profile missing.', 403)
  }

  const billing = await getExistingBillingRow(admin, agency.data.id)
  if (!billing.data) return ok({ visible: false })

  const currentStatus = String(billing.data.status ?? '')
  const currentSubscriptionId = String(billing.data.razorpay_subscription_id ?? '').trim()

  const { data, error } = await admin
    .from('billing_webhook_events')
    .select('payload')
    .contains('payload', {
      alza_reconciliation: {
        code: CANCELLED_SUBSCRIPTION_PAYMENT_CODE,
        agencyProfileId: agency.data.id,
        workspaceAccessGranted: false,
      },
    })
    .limit(25)

  if (error) {
    return fail('notice_lookup_failed', 'Unable to check reconciliation.', 500)
  }

  const records = (data ?? []).map((row) => asRecord(asRecord(row.payload)?.alza_reconciliation))
  const visible = reconciliationNoticeVisible(records, {
    agencyProfileId: agency.data.id,
    currentSubscriptionId,
    currentStatus,
  })
  return ok({ visible })
})
