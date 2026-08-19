/** Pure matching helpers shared by the UI. The Edge Function uses equivalent logic. */

export type DiscrepancyType =
  | 'exact_match'
  | 'underpaid'
  | 'overpaid'
  | 'missing_from_statement'
  | 'unmatched_row'
  | 'zero_amount'

export function normalizePolicyNumber(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function normalizePartyName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function partyNamesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizePartyName(left)
  const b = normalizePartyName(right)
  return Boolean(a) && Boolean(b) && a === b
}

function nonemptyParty(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

/**
 * Snapshot names on the statement win. Master-directory names fill in only when
 * the text field is empty but a carrier_id / mga_id was stored.
 * Keep in sync with run-reconciliation-matching resolveStatementPartyText.
 */
export function resolveStatementPartyText(input: {
  carrier?: string | null
  mga?: string | null
  carrierId?: string | null
  mgaId?: string | null
  directoryCarriers?: Record<string, string | null | undefined>
  directoryMgas?: Record<string, string | null | undefined>
}): { carrier: string | null; mga: string | null } {
  const carrier =
    nonemptyParty(input.carrier) ??
    nonemptyParty(input.carrierId ? input.directoryCarriers?.[input.carrierId] : null)
  const mga =
    nonemptyParty(input.mga) ??
    nonemptyParty(input.mgaId ? input.directoryMgas?.[input.mgaId] : null)
  return { carrier, mga }
}

/**
 * Statement vs transaction carrier/MGA names.
 * Both statement parties present → OR (MGA-paid statements may use a different
 * underlying carrier). Carrier-only statements still require a carrier match.
 * Keep in sync with run-reconciliation-matching carrierMgaMatch.
 */
export function statementPartyMatchesTransaction(input: {
  statementCarrier: string | null | undefined
  statementMga: string | null | undefined
  rowCarrierName?: string | null | undefined
  rowMgaName?: string | null | undefined
  transactionCarrier: string | null | undefined
  transactionMga: string | null | undefined
}): boolean {
  const stmtCarrier = nonemptyParty(input.statementCarrier) ?? nonemptyParty(input.rowCarrierName)
  const stmtMga = nonemptyParty(input.statementMga) ?? nonemptyParty(input.rowMgaName)
  const carrierOk = stmtCarrier
    ? partyNamesMatch(stmtCarrier, input.transactionCarrier) ||
      partyNamesMatch(stmtCarrier, input.transactionMga)
    : false
  const mgaOk = stmtMga
    ? partyNamesMatch(stmtMga, input.transactionMga) ||
      partyNamesMatch(stmtMga, input.transactionCarrier)
    : false
  if (stmtCarrier && stmtMga) return carrierOk || mgaOk
  if (stmtCarrier) return carrierOk
  if (stmtMga) return mgaOk
  return true
}

/** Round half-up to 2 decimal places. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function parseMoney(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? roundMoney(value) : null
  }
  if (value instanceof Date) return null
  const raw = String(value).trim()
  if (!raw) return null
  const parenNeg = /^\(.*\)$/.test(raw)
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/[()]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return roundMoney(parenNeg ? -Math.abs(n) : n)
}

export function classifySignedVariance(params: {
  commissionAmount: number | null
  expectedCommission: number | null
  roundingTolerance: number
}): { discrepancyType: DiscrepancyType | null; variance: number | null } {
  const { commissionAmount, expectedCommission, roundingTolerance } = params
  if (commissionAmount == null || expectedCommission == null) {
    return { discrepancyType: null, variance: null }
  }
  const actual = roundMoney(commissionAmount)
  const expected = roundMoney(expectedCommission)
  const tolerance = Math.max(0, roundingTolerance)
  const variance = roundMoney(actual - expected)
  if (actual === 0 && expected !== 0) {
    return { discrepancyType: 'zero_amount', variance }
  }
  if (Math.abs(variance) <= tolerance) {
    return { discrepancyType: 'exact_match', variance }
  }
  if (variance < -tolerance) {
    return { discrepancyType: 'underpaid', variance }
  }
  return { discrepancyType: 'overpaid', variance }
}

export function varianceRequiresReview(
  type: DiscrepancyType | string | null | undefined,
): boolean {
  return type === 'underpaid' || type === 'overpaid' || type === 'zero_amount'
}

/** Map matching-engine confidence onto agency_commission_receipts.match_confidence. */
export function mapReconciliationConfidenceToReceipt(
  value: string | null | undefined,
): 'exact_invoice' | 'strong' | 'weak' | 'none' {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'exact_invoice') return 'exact_invoice'
  if (raw === 'high' || raw === 'strong') return 'strong'
  if (raw === 'medium' || raw === 'low' || raw === 'weak') return 'weak'
  return 'none'
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

export function mapStatementTransactionType(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const compact = key.replace(/\s+/g, '')
  return TYPE_ALIASES[key] ?? TYPE_ALIASES[compact] ?? TYPE_ALIASES[raw.toLowerCase()] ?? null
}

export function typesCompatible(
  statementType: string | null | undefined,
  transactionType: string | null | undefined,
): boolean {
  const mapped = mapStatementTransactionType(statementType)
  const txn = String(transactionType ?? '').trim()
  if (!mapped || !txn) return false
  return mapped === txn
}

export function expectedCommissionOf(txn: {
  expected_amount?: number | string | null
  agency_commission_amount?: number | string | null
}): number {
  const primary = parseMoney(txn.expected_amount)
  if (primary != null) return primary
  return parseMoney(txn.agency_commission_amount) ?? 0
}

export function normalizeExternalReference(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export type PolicyMatchCandidate = {
  id: string
  transaction_type?: string | null
  transaction_date?: string | null
  transaction_number?: string | null
  expected_amount?: number | string | null
  agency_commission_amount?: number | string | null
  premium_amount?: number | string | null
  client_name?: string | null
}

export type PolicyMatchRow = {
  commission_amount?: number | string | null
  premium_amount?: number | string | null
  transaction_date?: string | null
  transaction_type?: string | null
  client_name?: string | null
  external_reference?: string | null
}

function daysBetweenIso(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.abs(Math.round((da - db) / 86400000))
}

/** Supporting score only. Never used as the sole high-confidence reason. */
export function scorePolicyMatchCandidate(row: PolicyMatchRow, txn: PolicyMatchCandidate): number {
  let score = 0
  const mapped = mapStatementTransactionType(row.transaction_type)
  if (mapped && mapped === txn.transaction_type) score += 100
  const actual = parseMoney(row.commission_amount)
  const expected = expectedCommissionOf(txn)
  if (actual != null) {
    const signA = Math.sign(actual)
    const signE = Math.sign(expected)
    if (signA !== 0 && signE !== 0 && signA === signE) score += 50
    if (signA !== 0 && signE !== 0 && signA !== signE) score -= 80
    score += Math.max(0, 40 - Math.abs(actual - expected))
  }
  const days = daysBetweenIso(row.transaction_date, txn.transaction_date)
  if (days != null) score += Math.max(0, 20 - days)
  const rowPremium = parseMoney(row.premium_amount)
  const txnPremium = parseMoney(txn.premium_amount)
  if (rowPremium != null && txnPremium != null) {
    score += Math.max(0, 20 - Math.abs(rowPremium - txnPremium))
  }
  if (partyNamesMatch(row.client_name, txn.client_name)) score += 10
  return score
}

/**
 * High confidence only when the winner is unambiguous:
 * - exactly one candidate, or
 * - unique external reference vs transaction_number, or
 * - unique commission amount AND compatible transaction type.
 * Type-only uniqueness and generic score gaps are not high confidence.
 * Keep in sync with run-reconciliation-matching pickWinner.
 */
export function pickPolicyMatchWinner(
  row: PolicyMatchRow,
  candidates: PolicyMatchCandidate[],
): { txn: PolicyMatchCandidate; confidence: 'high' | 'medium'; note?: string } | null {
  if (!candidates.length) return null
  if (candidates.length === 1) return { txn: candidates[0], confidence: 'high' }

  const actual = parseMoney(row.commission_amount)
  const ranked = candidates.map((txn) => ({
    txn,
    diff: actual == null ? Number.POSITIVE_INFINITY : Math.abs(actual - expectedCommissionOf(txn)),
    score: scorePolicyMatchCandidate(row, txn),
    signOk:
      actual == null
        ? true
        : Math.sign(actual) === 0 ||
          Math.sign(expectedCommissionOf(txn)) === 0 ||
          Math.sign(actual) === Math.sign(expectedCommissionOf(txn)),
  }))
  ranked.sort((a, b) => a.diff - b.diff || b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  if (!best) return null

  const ref = normalizeExternalReference(row.external_reference)
  const refHits = ref
    ? candidates.filter((t) => normalizeExternalReference(t.transaction_number) === ref)
    : []
  const uniqueRefWinner = refHits.length === 1 ? refHits[0] : null

  const uniqueAmount =
    actual != null &&
    best.diff <= 0.009 &&
    (second == null || second.diff - best.diff > 0.009) &&
    best.signOk
  const typeOk = typesCompatible(row.transaction_type, best.txn.transaction_type)
  const uniqueAmountAndType = uniqueAmount && typeOk

  if (uniqueRefWinner && uniqueAmountAndType && uniqueRefWinner.id !== best.txn.id) {
    return {
      txn: best.txn,
      confidence: 'medium',
      note: 'Multiple candidate transactions for this policy.',
    }
  }
  if (uniqueRefWinner) return { txn: uniqueRefWinner, confidence: 'high' }
  if (uniqueAmountAndType) return { txn: best.txn, confidence: 'high' }
  return {
    txn: best.txn,
    confidence: 'medium',
    note: 'Multiple candidate transactions for this policy.',
  }
}

/** Deterministic classification checks for signed-amount scenarios 10–14 (no database). */
export function runSignedVarianceScenarioChecks(): Array<{
  id: string
  name: string
  passed: boolean
  detail: string
}> {
  const cases: Array<{
    id: string
    name: string
    expected: number
    actual: number
    tolerance?: number
    want: DiscrepancyType
    wantVariance: number
  }> = [
    { id: '10', name: 'Cancellation exact match', expected: -350, actual: -350, want: 'exact_match', wantVariance: 0 },
    { id: '11', name: 'Cancellation overpaid (carrier returned less)', expected: -200, actual: -170, want: 'overpaid', wantVariance: 30 },
    { id: '12', name: 'Underpaid positive commission', expected: 500, actual: 475, want: 'underpaid', wantVariance: -25 },
    { id: '13', name: 'Overpaid positive commission', expected: 500, actual: 515, want: 'overpaid', wantVariance: 15 },
    { id: '14', name: 'Within rounding tolerance', expected: 500, actual: 499.995, tolerance: 0.01, want: 'exact_match', wantVariance: -0.01 },
  ]
  return cases.map((c) => {
    const result = classifySignedVariance({
      commissionAmount: c.actual,
      expectedCommission: c.expected,
      roundingTolerance: c.tolerance ?? 0.01,
    })
    const passed =
      result.discrepancyType === c.want &&
      result.variance != null &&
      Math.abs(result.variance - c.wantVariance) <= 0.01
    return {
      id: c.id,
      name: c.name,
      passed,
      detail: `got ${result.discrepancyType} variance=${result.variance}`,
    }
  })
}

/** Deterministic party-match checks for CNA+ISC / VALLEY FORGE+ISC and related cases. */
export function runPartyMatchScenarioChecks(): Array<{
  id: string
  name: string
  passed: boolean
  detail: string
}> {
  const txn = { transactionCarrier: 'VALLEY FORGE', transactionMga: 'ISC' }
  const cases: Array<{
    id: string
    name: string
    want: boolean
    statementCarrier: string | null
    statementMga: string | null
    carrierId?: string | null
    mgaId?: string | null
    directoryCarriers?: Record<string, string>
    directoryMgas?: Record<string, string>
  }> = [
    {
      id: 'party-1',
      name: 'CNA + ISC statement matches VALLEY FORGE + ISC transaction via MGA',
      want: true,
      statementCarrier: 'cna',
      statementMga: 'ISC',
    },
    {
      id: 'party-2',
      name: 'Direct CNA statement without MGA does not match VALLEY FORGE + ISC',
      want: false,
      statementCarrier: 'cna',
      statementMga: null,
    },
    {
      id: 'party-3',
      name: 'ISC-only statement matches VALLEY FORGE + ISC',
      want: true,
      statementCarrier: null,
      statementMga: 'ISC',
    },
    {
      id: 'party-4',
      name: 'CNA + btis statement does not match VALLEY FORGE + ISC',
      want: false,
      statementCarrier: 'cna',
      statementMga: 'btis',
    },
    {
      id: 'party-5',
      name: 'MGA id without stored name still matches after directory resolve',
      want: true,
      statementCarrier: 'cna',
      statementMga: null,
      mgaId: 'mga-isc',
      directoryMgas: { 'mga-isc': 'ISC' },
    },
  ]
  return cases.map((c) => {
    const resolved = resolveStatementPartyText({
      carrier: c.statementCarrier,
      mga: c.statementMga,
      carrierId: c.carrierId ?? null,
      mgaId: c.mgaId ?? null,
      directoryCarriers: c.directoryCarriers,
      directoryMgas: c.directoryMgas,
    })
    const got = statementPartyMatchesTransaction({
      statementCarrier: resolved.carrier,
      statementMga: resolved.mga,
      ...txn,
    })
    return {
      id: c.id,
      name: c.name,
      passed: got === c.want,
      detail: `got ${got} want ${c.want}`,
    }
  })
}

/** Deterministic winner checks for same-policy ambiguity (no database). */
export function runAmbiguousPolicyMatchChecks(): Array<{
  id: string
  name: string
  passed: boolean
  detail: string
}> {
  const endorsement = {
    id: 'txn-endo',
    transaction_type: 'endorsement_premium',
    transaction_date: '2026-07-21',
    transaction_number: 'TRX-2026-000033',
    expected_amount: 937.5,
    premium_amount: 7500,
    client_name: 'BALAN PEST COMPANY',
  }
  const renewal = {
    id: 'txn-ren',
    transaction_type: 'renewal_premium',
    transaction_date: '2026-07-01',
    transaction_number: 'TRX-2026-000010',
    expected_amount: 1200,
    premium_amount: 10000,
    client_name: 'BALAN PEST COMPANY',
  }
  const cancel = {
    id: 'txn-can',
    transaction_type: 'cancellation_premium',
    transaction_date: '2026-07-15',
    transaction_number: 'TRX-2026-000040',
    expected_amount: -350,
    premium_amount: -2000,
    client_name: 'BALAN PEST COMPANY',
  }

  const cases: Array<{
    id: string
    name: string
    row: PolicyMatchRow
    candidates: PolicyMatchCandidate[]
    wantConfidence: 'high' | 'medium' | null
    wantId?: string
  }> = [
    {
      id: 'A',
      name: 'One candidate is high confidence',
      row: { commission_amount: 937.5, transaction_type: 'endorsement_premium' },
      candidates: [endorsement],
      wantConfidence: 'high',
      wantId: 'txn-endo',
    },
    {
      id: 'B',
      name: 'Multiple candidates, unique amount + compatible type is high',
      row: {
        commission_amount: 937.5,
        transaction_type: 'endorsement_premium',
        premium_amount: 7500,
        client_name: 'BALAN PEST COMPANY',
        transaction_date: '2026-07-21',
      },
      candidates: [endorsement, renewal],
      wantConfidence: 'high',
      wantId: 'txn-endo',
    },
    {
      id: 'C',
      name: 'Multiple candidates, unique type only is exception',
      row: {
        commission_amount: 1000,
        transaction_type: 'endorsement_premium',
      },
      candidates: [endorsement, renewal],
      wantConfidence: 'medium',
    },
    {
      id: 'D',
      name: 'Multiple candidates, score gap only is exception',
      row: {
        commission_amount: 1100,
        transaction_type: 'endorsement_premium',
        premium_amount: 7500,
        client_name: 'BALAN PEST COMPANY',
        transaction_date: '2026-07-21',
      },
      candidates: [endorsement, renewal],
      wantConfidence: 'medium',
    },
    {
      id: 'F',
      name: 'Negative cancellation unique amount + type is high',
      row: {
        commission_amount: -350,
        transaction_type: 'cancellation_premium',
      },
      candidates: [endorsement, cancel],
      wantConfidence: 'high',
      wantId: 'txn-can',
    },
    {
      id: 'ext',
      name: 'Unique external reference vs transaction number is high',
      row: {
        commission_amount: 1000,
        transaction_type: 'endorsement_premium',
        external_reference: 'TRX-2026-000033',
      },
      candidates: [endorsement, renewal],
      wantConfidence: 'high',
      wantId: 'txn-endo',
    },
  ]

  const results = cases.map((c) => {
    const picked = pickPolicyMatchWinner(c.row, c.candidates)
    const gotConfidence = picked?.confidence ?? null
    const gotId = picked?.txn.id
    const passed =
      gotConfidence === c.wantConfidence && (c.wantId == null || gotId === c.wantId)
    return {
      id: c.id,
      name: c.name,
      passed,
      detail: `got ${gotConfidence}/${gotId} want ${c.wantConfidence}/${c.wantId ?? '*'}`,
    }
  })

  const used = new Set<string>()
  const first = pickPolicyMatchWinner(
    { commission_amount: 937.5, transaction_type: 'endorsement_premium' },
    [endorsement, renewal],
  )
  if (first?.confidence === 'high') used.add(first.txn.id)
  const open = [endorsement, renewal].filter((t) => !used.has(t.id))
  const duplicateEmpty = pickPolicyMatchWinner(
    { commission_amount: 937.5, transaction_type: 'endorsement_premium' },
    [endorsement].filter((t) => !used.has(t.id)),
  )
  results.push({
    id: 'E',
    name: 'Occupancy removes claimed txn so a second identical row cannot reuse it',
    passed: first?.confidence === 'high' && open.length === 1 && duplicateEmpty == null,
    detail: `claimed=${first?.txn.id} remaining=${open.map((t) => t.id).join(',')} second=${duplicateEmpty?.confidence ?? 'null'}`,
  })

  return results
}

