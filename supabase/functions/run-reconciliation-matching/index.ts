// Deno Edge Function: run-reconciliation-matching
// Deterministic transaction-level matching. Does not write receipts or change
// producer splits, broker fees, recoveries, payouts, or approval status.

import { assertCallerAgencyMatches, authorizeOpsStaff, serviceClient } from '../_shared/opsAuth.ts'
import { corsHeaders, fail, ok } from '../_shared/http.ts'

type DiscrepancyType =
  | 'exact_match'
  | 'underpaid'
  | 'overpaid'
  | 'missing_from_statement'
  | 'unmatched_row'
  | 'zero_amount'

type MatchStatus = 'auto_matched' | 'unmatched' | 'exception' | 'skipped'

interface StatementRow {
  id: string
  row_index: number
  policy_number: string | null
  client_name: string | null
  commission_amount: number | string | null
  premium_amount: number | string | null
  transaction_date: string | null
  transaction_type: string | null
  carrier_name: string | null
  mga_name: string | null
  external_reference: string | null
  match_status: string
}

interface CandidateTxn {
  id: string
  transaction_number: string | null
  transaction_type: string | null
  transaction_date: string | null
  expected_amount: number | string | null
  agency_commission_amount: number | string | null
  premium_amount: number | string | null
  carrier: string | null
  mga: string | null
  agency_commission_confirmed: boolean | null
  amount_received: number | string | null
  client_id: string | null
  policy_id: string | null
  producer: string | null
  policy_number?: string | null
  client_name?: string | null
}

const TYPE_ALIASES: Record<string, string> = {
  new_policy_premium: 'new_policy_premium',
  newbusiness: 'new_policy_premium',
  'new business': 'new_policy_premium',
  nb: 'new_policy_premium',
  new: 'new_policy_premium',
  renewal_premium: 'renewal_premium',
  renewal: 'renewal_premium',
  endorsement_premium: 'endorsement_premium',
  endorsement: 'endorsement_premium',
  endo: 'endorsement_premium',
  audit_premium: 'audit_premium',
  audit: 'audit_premium',
  cancellation_premium: 'cancellation_premium',
  cancellation: 'cancellation_premium',
  cancel: 'cancellation_premium',
  return_premium: 'cancellation_premium',
  return: 'cancellation_premium',
}

function normalizePolicy(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeName(a)
  const right = normalizeName(b)
  return Boolean(left) && Boolean(right) && left === right
}

function nonemptyParty(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

async function resolveStatementPartyText(
  admin: ReturnType<typeof serviceClient>,
  statement: {
    carrier: string | null
    mga: string | null
    carrier_id: string | null
    mga_id: string | null
  },
): Promise<{ carrier: string | null; mga: string | null }> {
  let carrier = nonemptyParty(statement.carrier)
  let mga = nonemptyParty(statement.mga)
  if (!carrier && statement.carrier_id) {
    const { data } = await admin
      .from('carriers')
      .select('carrier_name')
      .eq('id', statement.carrier_id)
      .maybeSingle()
    carrier = nonemptyParty((data?.carrier_name as string | null) ?? null)
  }
  if (!mga && statement.mga_id) {
    const { data } = await admin
      .from('mgas')
      .select('mga_name')
      .eq('id', statement.mga_id)
      .maybeSingle()
    mga = nonemptyParty((data?.mga_name as string | null) ?? null)
  }
  return { carrier, mga }
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? roundMoney(n) : null
}

function mapType(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const compact = key.replace(/\s+/g, '')
  return TYPE_ALIASES[key] ?? TYPE_ALIASES[compact] ?? TYPE_ALIASES[raw.toLowerCase()] ?? null
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function policyOf(txn: CandidateTxn): string {
  return String(txn.policy_number ?? '')
}

function clientNameOf(txn: CandidateTxn): string | null {
  return nonemptyParty(txn.client_name)
}

async function hydrateCandidateParties(
  admin: ReturnType<typeof serviceClient>,
  txns: CandidateTxn[],
): Promise<CandidateTxn[]> {
  const policyIds = [...new Set(txns.map((t) => String(t.policy_id ?? '')).filter(Boolean))]
  const clientIds = [...new Set(txns.map((t) => String(t.client_id ?? '')).filter(Boolean))]
  const policyNumberById = new Map<string, string>()
  const carrierByPolicyId = new Map<string, string>()
  const mgaByPolicyId = new Map<string, string>()
  const clientNameById = new Map<string, string>()

  if (policyIds.length > 0) {
    const { data: policies } = await admin
      .from('policies')
      .select('id, policy_number, carrier, mga')
      .in('id', policyIds)
    for (const row of policies ?? []) {
      policyNumberById.set(String(row.id), String(row.policy_number ?? ''))
      carrierByPolicyId.set(String(row.id), String(row.carrier ?? ''))
      mgaByPolicyId.set(String(row.id), String(row.mga ?? ''))
    }
  }
  if (clientIds.length > 0) {
    const { data: clients } = await admin.from('clients').select('id, business_name').in('id', clientIds)
    for (const row of clients ?? []) {
      clientNameById.set(String(row.id), String(row.business_name ?? ''))
    }
  }

  return txns.map((txn) => ({
    ...txn,
    policy_number: txn.policy_id ? policyNumberById.get(String(txn.policy_id)) ?? null : null,
    client_name: txn.client_id ? clientNameById.get(String(txn.client_id)) ?? null : null,
    carrier: nonemptyParty(txn.carrier) ?? (txn.policy_id ? nonemptyParty(carrierByPolicyId.get(String(txn.policy_id))) : null),
    mga: nonemptyParty(txn.mga) ?? (txn.policy_id ? nonemptyParty(mgaByPolicyId.get(String(txn.policy_id))) : null),
  }))
}

function expectedOf(txn: CandidateTxn): number {
  return toNum(txn.expected_amount) ?? toNum(txn.agency_commission_amount) ?? 0
}

function normalizeRef(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.abs(Math.round((da - db) / 86400000))
}

function classify(actual: number | null, expected: number | null, tolerance: number): {
  discrepancyType: DiscrepancyType | null
  variance: number | null
} {
  if (actual == null || expected == null) return { discrepancyType: null, variance: null }
  const variance = roundMoney(actual - expected)
  if (actual === 0 && expected !== 0) return { discrepancyType: 'zero_amount', variance }
  if (Math.abs(variance) <= tolerance) return { discrepancyType: 'exact_match', variance }
  if (variance < -tolerance) return { discrepancyType: 'underpaid', variance }
  return { discrepancyType: 'overpaid', variance }
}

function varianceRequiresReview(type: DiscrepancyType | null): boolean {
  return type === 'underpaid' || type === 'overpaid' || type === 'zero_amount'
}

function moneyLabel(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function recordedCommissionOf(txn: CandidateTxn): number {
  return toNum(txn.amount_received) ?? expectedOf(txn)
}

function buildAlreadyProcessedPatch(
  paidTxn: CandidateTxn,
  row: StatementRow,
  tolerance: number,
): Record<string, unknown> {
  const actual = toNum(row.commission_amount)
  const recorded = recordedCommissionOf(paidTxn)
  const classified = classify(actual, recorded, tolerance)
  const withinTolerance =
    classified.discrepancyType === 'exact_match' ||
    (classified.variance != null && Math.abs(classified.variance) <= tolerance)
  let resolutionNotes = 'Receipt already confirmed for this transaction'
  if (!withinTolerance && actual != null && classified.discrepancyType && classified.discrepancyType !== 'zero_amount') {
    resolutionNotes = `${resolutionNotes}. Commission was already recorded at ${moneyLabel(recorded)}. This statement reports ${moneyLabel(actual)}.`
  }
  return {
    match_status: 'skipped' satisfies MatchStatus,
    match_confidence: 'none',
    matched_transaction_id: paidTxn.id,
    expected_commission: recorded,
    variance: withinTolerance ? null : classified.variance,
    discrepancy_type: withinTolerance ? null : classified.discrepancyType,
    resolution_status: 'ignored',
    resolution_notes: resolutionNotes,
  }
}

function crossStatementOccupancyNote(statementLabel?: string | null): string {
  if (statementLabel) {
    return `Already matched on another statement (${statementLabel}) and awaiting receipt confirmation.`
  }
  return 'Already matched on another statement and awaiting receipt confirmation.'
}

function carrierMgaMatch(
  statement: { carrier: string | null; mga: string | null },
  txn: CandidateTxn,
  row: StatementRow,
): boolean {
  const stmtCarrier = nonemptyParty(statement.carrier) ?? nonemptyParty(row.carrier_name)
  const stmtMga = nonemptyParty(statement.mga) ?? nonemptyParty(row.mga_name)
  const carrierOk = stmtCarrier ? namesMatch(stmtCarrier, txn.carrier) || namesMatch(stmtCarrier, txn.mga) : false
  const mgaOk = stmtMga ? namesMatch(stmtMga, txn.mga) || namesMatch(stmtMga, txn.carrier) : false
  if (stmtCarrier && stmtMga) return carrierOk || mgaOk
  if (stmtCarrier) return carrierOk
  if (stmtMga) return mgaOk
  return true
}

function scoreCandidate(row: StatementRow, txn: CandidateTxn): number {
  let score = 0
  const mapped = mapType(row.transaction_type)
  if (mapped && mapped === txn.transaction_type) score += 100
  const actual = toNum(row.commission_amount)
  const expected = expectedOf(txn)
  if (actual != null) {
    const signA = Math.sign(actual)
    const signE = Math.sign(expected)
    if (signA !== 0 && signE !== 0 && signA === signE) score += 50
    if (signA !== 0 && signE !== 0 && signA !== signE) score -= 80
    const diff = Math.abs(actual - expected)
    score += Math.max(0, 40 - diff)
  }
  const days = daysBetween(row.transaction_date, txn.transaction_date)
  if (days != null) score += Math.max(0, 20 - days)
  const rowPremium = toNum(row.premium_amount)
  const txnPremium = toNum(txn.premium_amount)
  if (rowPremium != null && txnPremium != null) {
    score += Math.max(0, 20 - Math.abs(rowPremium - txnPremium))
  }
  if (namesMatch(row.client_name, clientNameOf(txn))) score += 10
  return score
}

function pickWinner(row: StatementRow, candidates: CandidateTxn[]): {
  txn: CandidateTxn
  confidence: 'high' | 'medium'
  note?: string
} | null {
  if (!candidates.length) return null
  if (candidates.length === 1) return { txn: candidates[0], confidence: 'high' }

  const actual = toNum(row.commission_amount)
  const withAmount = candidates.map((txn) => ({
    txn,
    diff: actual == null ? Number.POSITIVE_INFINITY : Math.abs(actual - expectedOf(txn)),
    score: scoreCandidate(row, txn),
    signOk:
      actual == null
        ? true
        : Math.sign(actual) === 0 ||
          Math.sign(expectedOf(txn)) === 0 ||
          Math.sign(actual) === Math.sign(expectedOf(txn)),
  }))

  withAmount.sort((a, b) => a.diff - b.diff || b.score - a.score)
  const best = withAmount[0]
  const second = withAmount[1]
  if (!best) return null

  const uniqueAmount =
    actual != null &&
    best.diff <= 0.009 &&
    (second == null || second.diff - best.diff > 0.009) &&
    best.signOk
  const mappedType = mapType(row.transaction_type)
  const typeOk = Boolean(mappedType) && mappedType === best.txn.transaction_type
  const uniqueAmountAndType = uniqueAmount && typeOk

  const ref = normalizeRef(row.external_reference)
  const refHits = ref
    ? candidates.filter((t) => normalizeRef(t.transaction_number) === ref)
    : []
  const uniqueRefWinner = refHits.length === 1 ? refHits[0] : null

  if (uniqueRefWinner && uniqueAmountAndType && uniqueRefWinner.id !== best.txn.id) {
    return {
      txn: best.txn,
      confidence: 'medium',
      note: 'Multiple candidate transactions for this policy.',
    }
  }
  if (uniqueRefWinner) return { txn: uniqueRefWinner, confidence: 'high' }
  if (uniqueAmountAndType) return { txn: best.txn, confidence: 'high' }
  return { txn: best.txn, confidence: 'medium', note: 'Multiple candidate transactions for this policy.' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST required.', 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const admin = serviceClient()
  const authz = await authorizeOpsStaff(admin, authHeader)
  if ('error' in authz && authz.error) return authz.error
  const callerAgencyId = authz.agencyProfileId

  let body: { statementId?: string; rerun?: boolean; detectMissing?: boolean }
  try {
    body = await req.json()
  } catch {
    return fail('invalid_json', 'Request body must be JSON.')
  }
  const statementId = String(body.statementId ?? '').trim()
  if (!statementId) return fail('invalid_input', 'statementId is required.')

  const { data: statement, error: stmtError } = await admin
    .from('reconciliation_statements')
    .select(
      'id, agency_profile_id, carrier, mga, carrier_id, mga_id, period_start, period_end, rounding_tolerance, row_count, status, detect_missing',
    )
    .eq('id', statementId)
    .maybeSingle()

  if (stmtError) return fail('statement_load_failed', stmtError.message, 500)
  if (!statement) return fail('not_found', 'Statement not found.', 404)

  const statementAgencyId = String(statement.agency_profile_id ?? '').trim()
  const agencyMismatch = assertCallerAgencyMatches(callerAgencyId, statementAgencyId)
  if (agencyMismatch) return fail('forbidden', agencyMismatch, 403)

  if (typeof body.detectMissing === 'boolean') {
    const { error: flagError } = await admin
      .from('reconciliation_statements')
      .update({ detect_missing: body.detectMissing, updated_at: new Date().toISOString() })
      .eq('id', statementId)
      .eq('agency_profile_id', statementAgencyId)
    if (flagError) return fail('statement_update_failed', flagError.message, 500)
  }

  if (statement.status === 'cancelled') return fail('invalid_state', 'Cancelled statements cannot be matched.')
  if (statement.status === 'completed' && !body.rerun) {
    return fail('invalid_state', 'Completed statements cannot be rematched.')
  }

  await admin
    .from('reconciliation_statements')
    .update({ status: 'matching', updated_at: new Date().toISOString() })
    .eq('id', statementId)
    .eq('agency_profile_id', statementAgencyId)

  if (body.rerun) {
    await admin
      .from('reconciliation_statement_rows')
      .delete()
      .eq('statement_id', statementId)
      .eq('row_source', 'missing')
    await admin
      .from('reconciliation_statement_rows')
      .update({
        match_status: 'pending',
        match_confidence: null,
        matched_transaction_id: null,
        expected_commission: null,
        variance: null,
        discrepancy_type: null,
        resolution_status: 'open',
        resolution_notes: null,
        updated_at: new Date().toISOString(),
      })
      .eq('statement_id', statementId)
      .eq('row_source', 'import')
      .neq('match_status', 'confirmed')
      .is('receipt_id', null)
  }

  const { data: importRows, error: rowsError } = await admin
    .from('reconciliation_statement_rows')
    .select(
      'id, row_index, policy_number, client_name, commission_amount, premium_amount, transaction_date, transaction_type, carrier_name, mga_name, external_reference, match_status',
    )
    .eq('statement_id', statementId)
    .eq('row_source', 'import')
    .eq('match_status', 'pending')
    .order('row_index')

  if (rowsError) return fail('rows_load_failed', rowsError.message, 500)

  const windowStart = addDays(String(statement.period_start), -30)
  const windowEnd = addDays(String(statement.period_end), 30)
  const { data: txns, error: txnError } = await admin
    .from('transactions')
    .select(
      `
      id, transaction_number, transaction_type, transaction_date,
      agency_commission_amount, premium_amount, agency_commission_confirmed,
      amount_received,
      client_id, policy_id, producer
    `,
    )
    .eq('agency_profile_id', statementAgencyId)
    .is('voided_at', null)
    .is('archived_at', null)
    .gte('transaction_date', windowStart)
    .lte('transaction_date', windowEnd)

  if (txnError) return fail('transactions_load_failed', txnError.message, 500)

  const candidates = await hydrateCandidateParties(admin, (txns ?? []) as CandidateTxn[])

  const { data: existingReceipts } = await admin
    .from('agency_commission_receipts')
    .select('transaction_id')
    .eq('agency_profile_id', statementAgencyId)
    .not('transaction_id', 'is', null)

  const receiptTxnIds = new Set(
    (existingReceipts ?? []).map((r) => String(r.transaction_id)).filter(Boolean),
  )

  const usedTxnIds = new Set<string>()
  const { data: alreadyMatched } = await admin
    .from('reconciliation_statement_rows')
    .select('matched_transaction_id')
    .eq('statement_id', statementId)
    .eq('row_source', 'import')
    .not('matched_transaction_id', 'is', null)
    .in('match_status', ['auto_matched', 'manual_matched', 'confirmed', 'exception'])
  for (const row of alreadyMatched ?? []) {
    if (row.matched_transaction_id) usedTxnIds.add(String(row.matched_transaction_id))
  }

  const globalOccupiedTxnIds = new Set<string>()
  const globalOccupiedStmtLabel = new Map<string, string>()
  const { data: agencyStatements } = await admin
    .from('reconciliation_statements')
    .select('id, file_name')
    .eq('agency_profile_id', statementAgencyId)
  const stmtFileNameById = new Map(
    (agencyStatements ?? []).map((s) => [String(s.id), String(s.file_name ?? '')]),
  )
  const otherStatementIds = (agencyStatements ?? [])
    .map((s) => String(s.id))
    .filter((id) => id && id !== statementId)
  if (otherStatementIds.length > 0) {
    const { data: globalOccupiedRows, error: occupiedError } = await admin
      .from('reconciliation_statement_rows')
      .select('matched_transaction_id, statement_id')
      .in('statement_id', otherStatementIds)
      .eq('row_source', 'import')
      .not('matched_transaction_id', 'is', null)
      .is('receipt_id', null)
      .in('match_status', ['auto_matched', 'manual_matched'])
    if (occupiedError) throw new Error(occupiedError.message)
    for (const occ of globalOccupiedRows ?? []) {
      const txnId = String(occ.matched_transaction_id ?? '')
      if (!txnId) continue
      globalOccupiedTxnIds.add(txnId)
      const fileName = stmtFileNameById.get(String(occ.statement_id ?? ''))
      if (fileName) globalOccupiedStmtLabel.set(txnId, fileName)
    }
  }

  const tolerance = Number(statement.rounding_tolerance ?? 0.01) || 0.01
  const stmtMeta = await resolveStatementPartyText(admin, {
    carrier: (statement.carrier as string | null) ?? null,
    mga: (statement.mga as string | null) ?? null,
    carrier_id: (statement.carrier_id as string | null) ?? null,
    mga_id: (statement.mga_id as string | null) ?? null,
  })

  async function applyRow(
    row: StatementRow,
    patch: Record<string, unknown>,
  ) {
    const { error } = await admin
      .from('reconciliation_statement_rows')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) throw new Error(error.message)
  }

  try {
    for (const raw of (importRows ?? []) as StatementRow[]) {
      const row = raw
      const norm = normalizePolicy(row.policy_number)
      if (!norm) {
        await applyRow(row, {
          match_status: 'unmatched' satisfies MatchStatus,
          match_confidence: 'none',
          discrepancy_type: 'unmatched_row' satisfies DiscrepancyType,
        })
        continue
      }

      const policyHits = candidates.filter((t) => normalizePolicy(policyOf(t)) === norm)
      const partyHits = policyHits.filter((t) => carrierMgaMatch(stmtMeta, t, row))
      const receivable = (list: CandidateTxn[]) =>
        list.filter(
          (t) =>
            !t.agency_commission_confirmed &&
            !receiptTxnIds.has(t.id) &&
            !usedTxnIds.has(t.id) &&
            !globalOccupiedTxnIds.has(t.id),
        )
      const alreadyPaid = (list: CandidateTxn[]) =>
        list.filter((t) => t.agency_commission_confirmed || receiptTxnIds.has(t.id))

      const occupiedElsewhere = partyHits.find(
        (t) =>
          globalOccupiedTxnIds.has(t.id) && !t.agency_commission_confirmed && !receiptTxnIds.has(t.id),
      )
      if (occupiedElsewhere) {
        const actual = toNum(row.commission_amount)
        const expected = expectedOf(occupiedElsewhere)
        const classified = classify(actual, expected, tolerance)
        await applyRow(row, {
          match_status: 'exception' satisfies MatchStatus,
          match_confidence: 'none',
          matched_transaction_id: occupiedElsewhere.id,
          expected_commission: expected,
          variance: classified.variance,
          discrepancy_type: classified.discrepancyType ?? 'unmatched_row',
          resolution_status: 'open',
          resolution_notes: crossStatementOccupancyNote(globalOccupiedStmtLabel.get(occupiedElsewhere.id)),
        })
        continue
      }

      const openParty = receivable(partyHits)
      const paidParty = alreadyPaid(partyHits)
      const claimedParty = partyHits.filter((t) => usedTxnIds.has(t.id))

      if (openParty.length === 0 && claimedParty.length > 0) {
        await applyRow(row, {
          match_status: 'exception' satisfies MatchStatus,
          match_confidence: 'medium',
          discrepancy_type: 'unmatched_row' satisfies DiscrepancyType,
          resolution_notes: 'Duplicate match to same transaction within this statement',
        })
        continue
      }

      if (openParty.length === 0 && paidParty.length > 0 && receivable(policyHits).length === 0) {
        await applyRow(row, buildAlreadyProcessedPatch(paidParty[0], row, tolerance))
        continue
      }

      if (openParty.length > 0) {
        const picked = pickWinner(row, openParty)
        if (picked && usedTxnIds.has(picked.txn.id)) {
          await applyRow(row, {
            match_status: 'exception' satisfies MatchStatus,
            match_confidence: 'medium',
            discrepancy_type: 'unmatched_row',
            resolution_notes: 'Duplicate match to same transaction within this statement',
          })
          continue
        }
        if (picked?.confidence === 'high') {
          const expected = expectedOf(picked.txn)
          const actual = toNum(row.commission_amount)
          const classified = classify(actual, expected, tolerance)
          const needsReview = varianceRequiresReview(classified.discrepancyType)
          usedTxnIds.add(picked.txn.id)
          await applyRow(row, {
            match_status: (needsReview ? 'exception' : 'auto_matched') satisfies MatchStatus,
            match_confidence: 'high',
            matched_transaction_id: picked.txn.id,
            expected_commission: expected,
            variance: classified.variance,
            discrepancy_type: classified.discrepancyType,
            resolution_status: needsReview ? 'open' : 'resolved',
            resolution_notes: needsReview ? 'Variance requires review before receipt confirmation.' : null,
          })
          continue
        }
        if (picked) {
          const expected = expectedOf(picked.txn)
          const actual = toNum(row.commission_amount)
          const classified = classify(actual, expected, tolerance)
          usedTxnIds.add(picked.txn.id)
          await applyRow(row, {
            match_status: 'exception' satisfies MatchStatus,
            match_confidence: 'medium',
            matched_transaction_id: picked.txn.id,
            expected_commission: expected,
            variance: classified.variance,
            discrepancy_type: classified.discrepancyType,
            resolution_notes: picked.note ?? 'Multiple candidate transactions for this policy.',
          })
          continue
        }
      }

      if (policyHits.length > 0 && openParty.length === 0 && receivable(policyHits).length > 0) {
        const picked = pickWinner(row, receivable(policyHits))
        if (picked) {
          const expected = expectedOf(picked.txn)
          const classified = classify(toNum(row.commission_amount), expected, tolerance)
          await applyRow(row, {
            match_status: 'exception' satisfies MatchStatus,
            match_confidence: 'medium',
            matched_transaction_id: picked.txn.id,
            expected_commission: expected,
            variance: classified.variance,
            discrepancy_type: classified.discrepancyType,
            resolution_notes: 'Policy number matched but carrier/MGA did not match exactly.',
          })
          continue
        }
      }

      const partial = receivable(candidates).filter((t) => {
        const p = normalizePolicy(policyOf(t))
        if (!p) return false
        return p.includes(norm) || norm.includes(p)
      })
      const amountClose = partial.filter((t) => {
        const actual = toNum(row.commission_amount)
        if (actual == null) return false
        return Math.abs(actual - expectedOf(t)) <= Math.max(tolerance, 5)
      })
      if (amountClose.length > 0) {
        const picked = pickWinner(row, amountClose)
        if (picked) {
          const expected = expectedOf(picked.txn)
          const classified = classify(toNum(row.commission_amount), expected, tolerance)
          await applyRow(row, {
            match_status: 'exception' satisfies MatchStatus,
            match_confidence: 'low',
            matched_transaction_id: picked.txn.id,
            expected_commission: expected,
            variance: classified.variance,
            discrepancy_type: classified.discrepancyType,
            resolution_notes: 'Partial policy-number match. Confirm before receipt.',
          })
          continue
        }
      }

      await applyRow(row, {
        match_status: 'unmatched' satisfies MatchStatus,
        match_confidence: 'none',
        discrepancy_type: 'unmatched_row' satisfies DiscrepancyType,
      })
    }

    const { data: matchedNow } = await admin
      .from('reconciliation_statement_rows')
      .select('matched_transaction_id')
      .eq('statement_id', statementId)
      .eq('row_source', 'import')
      .not('matched_transaction_id', 'is', null)
    const matchedIds = new Set(
      (matchedNow ?? []).map((r) => String(r.matched_transaction_id)).filter(Boolean),
    )

    const periodStart = String(statement.period_start)
    const periodEnd = String(statement.period_end)
    const missingTxns = candidates.filter((t) => {
      const date = String(t.transaction_date ?? '')
      if (!date || date < periodStart || date > periodEnd) return false
      if (!carrierMgaMatch(stmtMeta, t, {
        id: '',
        row_index: 0,
        policy_number: null,
        client_name: null,
        commission_amount: null,
        premium_amount: null,
        transaction_date: null,
        transaction_type: null,
        carrier_name: null,
        mga_name: null,
        external_reference: null,
        match_status: 'pending',
      })) return false
      if (t.agency_commission_confirmed || receiptTxnIds.has(t.id) || matchedIds.has(t.id)) return false
      if (expectedOf(t) === 0) return false
      return true
    })

    const importCount = Number(statement.row_count ?? 0)
    const detectMissing = Boolean(statement.detect_missing)
    if (detectMissing && missingTxns.length) {
      const missingRows = missingTxns.map((t, i) => ({
        statement_id: statementId,
        row_source: 'missing',
        row_index: importCount + 1 + i,
        raw_data: null,
        policy_number: policyOf(t) || null,
        client_name: t.client_name ?? null,
        commission_amount: null,
        transaction_date: t.transaction_date,
        transaction_type: t.transaction_type,
        carrier_name: t.carrier,
        mga_name: t.mga,
        match_status: 'exception',
        match_confidence: 'none',
        matched_transaction_id: t.id,
        expected_commission: expectedOf(t),
        variance: null,
        discrepancy_type: 'missing_from_statement',
        resolution_status: 'open',
      }))
      const { error: missingError } = await admin.from('reconciliation_statement_rows').insert(missingRows)
      if (missingError) throw new Error(missingError.message)
    }

    const { data: allRows, error: countError } = await admin
      .from('reconciliation_statement_rows')
      .select('match_status, row_source')
      .eq('statement_id', statementId)
    if (countError) throw new Error(countError.message)

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
      .update({
        ...counts,
        status: 'matched',
        updated_at: new Date().toISOString(),
      })
      .eq('id', statementId)
      .eq('agency_profile_id', statementAgencyId)

    const actor = authz.callerProfile
    await admin.from('activity_history').insert({
      actor_user_id: actor?.id ?? null,
      actor_name: actor?.full_name ?? null,
      actor_role: actor?.role ?? null,
      action: 'reconciliation_matching_completed',
      entity_type: 'reconciliation',
      entity_id: statementId,
      record_reference: statementId,
      new_value: counts,
    })

    return ok({ statementId, ...counts })
  } catch (err) {
    await admin
      .from('reconciliation_statements')
      .update({ status: 'staged', updated_at: new Date().toISOString() })
      .eq('id', statementId)
      .eq('agency_profile_id', statementAgencyId)
    return fail('matching_failed', err instanceof Error ? err.message : 'Matching failed.', 500)
  }
})
