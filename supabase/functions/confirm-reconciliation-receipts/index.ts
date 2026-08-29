// Deno Edge Function: confirm-reconciliation-receipts
// Tenant-scoped receipt confirmation via Phase 3C confirm_agency_commission_received RPC.
// Does not modify producer splits, broker fees, recoveries, payouts, or approval workflow
// beyond what the receipt RPC allows on the pre-review path.

import {
  assertCallerAgencyMatches,
  authorizeOwnerAdmin,
  callerJwtClient,
  serviceClient,
} from '../_shared/opsAuth.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toNum(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? roundMoney(n) : 0
}

function moneyLabel(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function varianceRequiresReview(type: unknown): boolean {
  return type === 'underpaid' || type === 'overpaid' || type === 'zero_amount'
}

async function markRowAlreadyProcessed(
  admin: ReturnType<typeof serviceClient>,
  rowId: string,
  importedAt: string,
  receiptId?: string | null,
) {
  await admin
    .from('reconciliation_statement_rows')
    .update({
      match_status: 'skipped',
      resolution_status: 'ignored',
      resolution_notes: 'Receipt already confirmed for this transaction',
      ...(receiptId ? { receipt_id: receiptId } : {}),
      updated_at: importedAt,
    })
    .eq('id', rowId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST required.', 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const admin = serviceClient()
  const authz = await authorizeOwnerAdmin(admin, authHeader)
  if ('error' in authz && authz.error) return authz.error
  const callerAgencyId = authz.agencyProfileId
  const callerClient = callerJwtClient(authHeader)

  let body: { statementId?: string; rowIds?: string[] }
  try {
    body = await req.json()
  } catch {
    return fail('invalid_json', 'Request body must be JSON.')
  }

  const statementId = String(body.statementId ?? '').trim()
  if (!statementId) return fail('invalid_input', 'statementId is required.')

  const { data: statement, error: stmtError } = await admin
    .from('reconciliation_statements')
    .select('id, agency_profile_id, status, statement_date, period_end, rounding_tolerance')
    .eq('id', statementId)
    .maybeSingle()

  if (stmtError) return fail('statement_load_failed', stmtError.message, 500)
  if (!statement) return fail('not_found', 'Statement not found.', 404)

  const statementAgencyId = String(statement.agency_profile_id ?? '').trim()
  const agencyMismatch = assertCallerAgencyMatches(callerAgencyId, statementAgencyId)
  if (agencyMismatch) return fail('forbidden', agencyMismatch, 403)

  if (statement.status === 'cancelled') {
    return fail('invalid_state', 'Cannot confirm receipts on a cancelled statement.')
  }

  let query = admin
    .from('reconciliation_statement_rows')
    .select(
      `
      id, statement_id, match_status, match_confidence, matched_transaction_id,
      commission_amount, expected_commission, variance, discrepancy_type,
      policy_number, client_name, external_reference, receipt_id, row_source
    `,
    )
    .eq('statement_id', statementId)
    .in('match_status', ['auto_matched', 'manual_matched'])
    .is('receipt_id', null)

  if (body.rowIds?.length) query = query.in('id', body.rowIds)

  const { data: rows, error: rowsError } = await query
  if (rowsError) return fail('rows_load_failed', rowsError.message, 500)
  if (!rows?.length) return ok({ confirmed: 0, skipped: 0, errors: [] as string[] })

  const actor = authz.callerProfile
  const settlementDate = String(statement.statement_date || statement.period_end || '').slice(0, 10)
  const importedAt = new Date().toISOString()
  const confirmedTxnIds = new Set<string>()
  let confirmed = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    const txnId = String(row.matched_transaction_id ?? '')
    if (!txnId) {
      errors.push(`${row.id}: no matched transaction`)
      continue
    }
    if (confirmedTxnIds.has(txnId)) {
      await admin
        .from('reconciliation_statement_rows')
        .update({
          match_status: 'exception',
          resolution_notes: 'Duplicate match to same transaction within this statement',
          updated_at: importedAt,
        })
        .eq('id', row.id)
      skipped += 1
      continue
    }

    const { data: txn, error: txnError } = await admin
      .from('transactions')
      .select(
        `
        id, transaction_number, agency_profile_id,
        agency_commission_amount, agency_commission_confirmed
      `,
      )
      .eq('id', txnId)
      .maybeSingle()

    if (txnError || !txn) {
      errors.push(`${row.id}: transaction not found`)
      continue
    }

    const txnAgencyMismatch = assertCallerAgencyMatches(statementAgencyId, txn.agency_profile_id)
    if (txnAgencyMismatch) {
      errors.push(`${row.id}: ${txnAgencyMismatch}`)
      continue
    }

    if (txn.agency_commission_confirmed) {
      const { data: existingReceipt } = await admin
        .from('agency_commission_receipts')
        .select('id')
        .eq('transaction_id', txnId)
        .eq('agency_profile_id', statementAgencyId)
        .maybeSingle()
      await markRowAlreadyProcessed(admin, row.id, importedAt, existingReceipt?.id ?? null)
      skipped += 1
      continue
    }

    const amountReceived = toNum(row.commission_amount)
    const expected = toNum(row.expected_commission ?? txn.expected_amount ?? txn.agency_commission_amount)
    const variance = roundMoney(amountReceived - expected)
    const hasVariance = Math.abs(variance) > 0.009

    if (row.match_status !== 'manual_matched' && varianceRequiresReview(row.discrepancy_type)) {
      await admin
        .from('reconciliation_statement_rows')
        .update({
          match_status: 'exception',
          resolution_status: 'open',
          resolution_notes: 'Variance requires review before receipt confirmation.',
          updated_at: importedAt,
        })
        .eq('id', row.id)
      skipped += 1
      continue
    }

    const notes = [
      `Confirmed from reconciliation statement ${statementId}.`,
      hasVariance
        ? `Variance acknowledged: received ${moneyLabel(amountReceived)} vs expected ${moneyLabel(expected)} (${moneyLabel(variance)}).`
        : 'Amount matches expected within tolerance.',
    ].join(' ')

    const { data: rpcData, error: rpcError } = await callerClient.rpc(
      'confirm_agency_commission_received',
      {
        p_transaction_id: txn.id,
        p_amount_received: amountReceived,
        p_received_date: settlementDate || new Date().toISOString().slice(0, 10),
        p_deposit_reference: null,
        p_external_invoice_id: row.external_reference || null,
        p_notes: notes,
        p_variance_acknowledged: hasVariance,
      },
    )

    if (rpcError) {
      const msg = String(rpcError.message ?? 'receipt RPC failed')
      if (/duplicate/i.test(msg) || /already confirmed/i.test(msg)) {
        const receiptId = (rpcData as { receipt_id?: string } | null)?.receipt_id
        await markRowAlreadyProcessed(admin, row.id, importedAt, receiptId ?? null)
        skipped += 1
        continue
      }
      errors.push(`${row.id}: ${msg}`)
      continue
    }

    const payload = rpcData as { receipt_id?: string; duplicate?: boolean } | null
    const receiptId = payload?.receipt_id
    if (!receiptId) {
      errors.push(`${row.id}: receipt RPC returned no receipt id`)
      continue
    }

    if (payload?.duplicate) {
      await markRowAlreadyProcessed(admin, row.id, importedAt, receiptId)
      skipped += 1
      continue
    }

    await admin
      .from('reconciliation_statement_rows')
      .update({
        match_status: 'confirmed',
        receipt_id: receiptId,
        resolution_status: 'resolved',
        resolved_at: importedAt,
        resolved_by: actor?.id ?? null,
        updated_at: importedAt,
      })
      .eq('id', row.id)

    confirmedTxnIds.add(txn.id)
    confirmed += 1

    await admin.from('activity_history').insert({
      actor_user_id: actor?.id ?? null,
      actor_name: actor?.full_name ?? null,
      actor_role: actor?.role ?? null,
      action: 'transaction_receipt_confirm',
      entity_type: 'transaction',
      entity_id: txn.id,
      record_reference: txn.transaction_number || String(txn.id),
      transaction_id: txn.id,
      old_value: { agencyCommissionConfirmed: false },
      new_value: {
        agencyCommissionConfirmed: true,
        amountReceived,
        receivedDate: settlementDate,
        receiptId,
        variance,
        hasVariance,
        source: 'reconciliation',
      },
    })
  }

  const { data: allRows } = await admin
    .from('reconciliation_statement_rows')
    .select('match_status, row_source')
    .eq('statement_id', statementId)

  const list = allRows ?? []
  const counts = {
    matched_count: list.filter((r) =>
      ['auto_matched', 'manual_matched', 'confirmed'].includes(String(r.match_status)),
    ).length,
    unmatched_count: list.filter((r) => r.match_status === 'unmatched').length,
    exception_count: list.filter((r) => r.match_status === 'exception').length,
    missing_count: list.filter((r) => r.row_source === 'missing').length,
    skipped_count: list.filter((r) => r.match_status === 'skipped').length,
    confirmed_count: list.filter((r) => r.match_status === 'confirmed').length,
  }

  await admin
    .from('reconciliation_statements')
    .update({ ...counts, updated_at: importedAt })
    .eq('id', statementId)
    .eq('agency_profile_id', statementAgencyId)

  if (confirmed > 0) {
    await admin.from('activity_history').insert({
      actor_user_id: actor?.id ?? null,
      actor_name: actor?.full_name ?? null,
      actor_role: actor?.role ?? null,
      action: 'reconciliation_receipts_confirmed',
      entity_type: 'reconciliation',
      entity_id: statementId,
      record_reference: statementId,
      new_value: { confirmed, skipped, errors: errors.length },
    })
  } else if (errors.length > 0) {
    await admin.from('activity_history').insert({
      actor_user_id: actor?.id ?? null,
      actor_name: actor?.full_name ?? null,
      actor_role: actor?.role ?? null,
      action: 'reconciliation_receipts_failed',
      entity_type: 'reconciliation',
      entity_id: statementId,
      record_reference: statementId,
      new_value: { confirmed, skipped, errors: errors.length, messages: errors.slice(0, 20) },
    })
  }

  return ok({ confirmed, skipped, errors, ...counts })
})
