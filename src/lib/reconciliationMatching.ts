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

