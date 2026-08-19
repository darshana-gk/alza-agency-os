// Deno Edge Function: confirm-reconciliation-receipts
// Mirrors confirmAgencyCommissionReceived() receipt payload + transaction update.
// Does not modify producer splits, broker fees, recoveries, payouts, or approval workflow
// beyond review_status = 'expected' (same as the manual receipt flow).

import { authorizeOpsStaff, serviceClient } from '../_shared/opsAuth.ts'
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

/** Map reconciliation row confidence onto agency_commission_receipts.match_confidence CHECK. */
function mapReceiptMatchConfidence(value: unknown): 'exact_invoice' | 'strong' | 'weak' | 'none' {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'exact_invoice') return 'exact_invoice'
  if (raw === 'high' || raw === 'strong') return 'strong'
  if (raw === 'medium' || raw === 'low' || raw === 'weak') return 'weak'
  return 'none'
}

function varianceRequiresReview(type: unknown): boolean {
  return type === 'underpaid' || type === 'overpaid' || type === 'zero_amount'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST required.', 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const admin = serviceClient()
  const authz = await authorizeOpsStaff(admin, authHeader)
  if ('error' in authz && authz.error) return authz.error

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
    .select('id, status, statement_date, period_end, rounding_tolerance')
    .eq('id', statementId)
    .maybeSingle()

  if (stmtError) return fail('statement_load_failed', stmtError.message, 500)
  if (!statement) return fail('not_found', 'Statement not found.', 404)
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

    const { data: existingReceipt } = await admin
      .from('agency_commission_receipts')
      .select('id')
      .eq('transaction_id', txnId)
      .limit(1)
      .maybeSingle()

    const { data: txn, error: txnError } = await admin
      .from('transactions')
      .select(
        `
        id, transaction_number, client_id, policy_id, producer, expected_amount,
        agency_commission_amount, amount_received, agency_commission_confirmed,
        clients ( business_name ),
        policies ( policy_number )
      `,
      )
      .eq('id', txnId)
      .maybeSingle()

    if (txnError || !txn) {
      errors.push(`${row.id}: transaction not found`)
      continue
    }

    if (txn.agency_commission_confirmed || existingReceipt) {
      await admin
        .from('reconciliation_statement_rows')
        .update({
          match_status: 'skipped',
          resolution_status: 'ignored',
          resolution_notes: 'Receipt already confirmed for this transaction',
          updated_at: importedAt,
        })
        .eq('id', row.id)
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
    const recStatus = 'matched'
    const confidence = mapReceiptMatchConfidence(row.match_confidence)

    const notes = [
      `Confirmed from reconciliation statement ${statementId}.`,
      hasVariance
        ? `Variance acknowledged: received ${moneyLabel(amountReceived)} vs expected ${moneyLabel(expected)} (${moneyLabel(variance)}).`
        : 'Amount matches expected within tolerance.',
    ].join(' ')

    const policy = Array.isArray(txn.policies) ? txn.policies[0] : txn.policies
    const client = Array.isArray(txn.clients) ? txn.clients[0] : txn.clients

    const { data: receipt, error: receiptError } = await admin
      .from('agency_commission_receipts')
      .insert({
        client_id: txn.client_id || null,
        policy_id: txn.policy_id || null,
        transaction_id: txn.id,
        matched_transaction_id: txn.id,
        producer: txn.producer || null,
        source: 'reconciliation',
        external_invoice_id: row.external_reference || null,
        deposit_reference: null,
        notes,
        policy_number: row.policy_number || policy?.policy_number || null,
        client_name: row.client_name || client?.business_name || null,
        settlement_date: settlementDate || null,
        imported_at: importedAt,
        reconciliation_status: recStatus,
        match_confidence: confidence,
      })
      .select('id')
      .single()

    if (receiptError || !receipt) {
      errors.push(`${row.id}: ${receiptError?.message || 'receipt insert failed'}`)
      continue
    }

    const { error: updateError } = await admin
      .from('transactions')
      .update({
        amount_received: amountReceived,
        received_date: settlementDate || null,
        agency_commission_confirmed: true,
        agency_commission_receipt_id: receipt.id,
        review_status: 'expected',
      })
      .eq('id', txn.id)
      .eq('agency_commission_confirmed', false)

    if (updateError) {
      errors.push(`${row.id}: ${updateError.message}`)
      continue
    }

    await admin
      .from('reconciliation_statement_rows')
      .update({
        match_status: 'confirmed',
        receipt_id: receipt.id,
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
      client_id: txn.client_id,
      policy_id: txn.policy_id,
      transaction_id: txn.id,
      old_value: {
        agencyCommissionConfirmed: false,
        amountReceived: txn.amount_received,
      },
      new_value: {
        agencyCommissionConfirmed: true,
        amountReceived,
        receivedDate: settlementDate,
        receiptId: receipt.id,
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
