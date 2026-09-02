/**
 * Current Policy Premium / policy-term financial SoT.
 *
 * Current Policy Premium is the live premium for the current policy term, not a
 * blind SUM of every non-voided transaction on the policy.
 *
 * Term-establishing types (New Business, Renewal) set the term premium.
 * Term-adjusting types (Endorsement, Audit, Cancellation, legacy Return Premium)
 * add their signed amount to that term.
 * A later establishing transaction starts a new current term; prior-term amounts
 * are not accumulated into Current Policy Premium.
 * Voided and archived rows never count.
 *
 * policies.premium is a stored reference only (Add Policy writes 0; onboarding may
 * persist an imported value). It is displayed when the policy has no live
 * transactions yet, and is never added into live/current-term totals.
 */

export const TERM_ESTABLISHING_TYPES = ['new_policy_premium', 'renewal_premium'] as const
export const TERM_ADJUSTING_TYPES = [
  'endorsement_premium',
  'audit_premium',
  'cancellation_premium',
  'return_premium',
] as const

export type PolicyPremiumTxn = {
  id?: string
  type: string
  amount: number
  archived?: boolean
  voidedAt?: string | null
  transactionDate?: string | null
  createdAt?: string | null
  transactionEffectiveDate?: string | null
  transactionExpirationDate?: string | null
  brokerFee?: number
  agencyCommissionAmount?: number
  producerCommissionAmount?: number
  agencyNetCommission?: number
}

export type PolicyTermOptions = {
  policyEffectiveDate?: string | null
  policyExpirationDate?: string | null
}

export type PolicyTermFinancialTotals = {
  currentPolicyPremium: number
  totalBrokerFees: number
  totalAgencyCommission: number
  totalCommissionPool: number
  totalProducerCommission: number
  totalAgencyNet: number
  termTransactionIds: string[]
}

function toFiniteMoney(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  // Currency-ish strings ("12,000", "$12000") — Number() alone yields NaN.
  const cleaned = String(value).trim().replace(/[$,\s]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function roundPolicyPremiumMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

function isoDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.slice(0, 10)
}

function createdMs(tx: PolicyPremiumTxn): number {
  const raw = tx.createdAt || tx.transactionDate || ''
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

function isLiveTxn(tx: PolicyPremiumTxn): boolean {
  return !tx.archived && !tx.voidedAt
}

export function isTermEstablishingType(type: string | null | undefined): boolean {
  const t = String(type ?? '').trim()
  if (!t) return true
  return (TERM_ESTABLISHING_TYPES as readonly string[]).includes(t)
}

export function isTermAdjustingType(type: string | null | undefined): boolean {
  return (TERM_ADJUSTING_TYPES as readonly string[]).includes(String(type ?? '').trim())
}

function termStartKey(tx: PolicyPremiumTxn): string {
  return isoDate(tx.transactionEffectiveDate) || isoDate(tx.transactionDate)
}

function compareEstablishing(a: PolicyPremiumTxn, b: PolicyPremiumTxn): number {
  const da = termStartKey(a)
  const db = termStartKey(b)
  if (da && db && da !== db) return db.localeCompare(da)
  if (da && !db) return -1
  if (!da && db) return 1
  const created = createdMs(b) - createdMs(a)
  if (created !== 0) return created
  return String(b.id ?? '').localeCompare(String(a.id ?? ''))
}

function adjustmentBelongsToTerm(
  tx: PolicyPremiumTxn,
  establishing: PolicyPremiumTxn,
  termStart: string,
  termEnd: string,
): boolean {
  const eff = isoDate(tx.transactionEffectiveDate)
  if (eff) {
    if (termStart && eff < termStart) return false
    if (termEnd && eff > termEnd) return false
    return true
  }
  return createdMs(tx) > createdMs(establishing)
}

/**
 * Live transactions that belong to the current policy term:
 * the latest establishing New Business/Renewal, plus later signed adjustments
 * in that term. Not "latest transaction only".
 */
export function selectCurrentTermTransactions(
  transactions: PolicyPremiumTxn[],
  options?: PolicyTermOptions,
): PolicyPremiumTxn[] {
  const live = transactions.filter(isLiveTxn)
  const establishing = live.filter((tx) => isTermEstablishingType(tx.type))
  if (establishing.length === 0) return []

  const current = [...establishing].sort(compareEstablishing)[0]
  const termStart =
    isoDate(current.transactionEffectiveDate) || isoDate(options?.policyEffectiveDate)
  const termEnd =
    isoDate(current.transactionExpirationDate) || isoDate(options?.policyExpirationDate)

  const adjustments = live
    .filter((tx) => isTermAdjustingType(tx.type))
    .filter((tx) => adjustmentBelongsToTerm(tx, current, termStart, termEnd))

  return [current, ...adjustments]
}

/**
 * Display SoT for a transaction's policy number: the create-time snapshot.
 * Fall back to the live Policy File only when no snapshot exists (legacy rows).
 */
export function resolveDisplayedPolicyNumber(input: {
  snapshotPolicyNumber?: string | null
  currentPolicyNumber?: string | null
}): string {
  const snapshot = String(input.snapshotPolicyNumber ?? '').trim()
  if (snapshot) return snapshot
  const current = String(input.currentPolicyNumber ?? '').trim()
  return current || '—'
}

export function resolveDisplayedPolicyTerm(input: {
  snapshotEffectiveDate?: string | null
  snapshotExpirationDate?: string | null
  currentEffectiveDate?: string | null
  currentExpirationDate?: string | null
}): { effectiveDate: string; expirationDate: string } {
  const snapEff = isoDate(input.snapshotEffectiveDate)
  const snapExp = isoDate(input.snapshotExpirationDate)
  if (snapEff || snapExp) {
    return { effectiveDate: snapEff, expirationDate: snapExp }
  }
  return {
    effectiveDate: isoDate(input.currentEffectiveDate),
    expirationDate: isoDate(input.currentExpirationDate),
  }
}

/**
 * Split a policy's related transactions into the live current term vs everything else.
 * Uses the same current-term membership as financial totals; does not change those totals.
 */
export function groupRelatedPolicyTransactions<T extends PolicyPremiumTxn>(
  transactions: T[],
  options?: PolicyTermOptions,
): { currentTerm: T[]; priorTerms: T[] } {
  const currentIds = new Set(
    selectCurrentTermTransactions(transactions, options).map((tx) => String(tx.id ?? '')),
  )
  const currentTerm: T[] = []
  const priorTerms: T[] = []
  for (const tx of transactions) {
    if (currentIds.has(String(tx.id ?? ''))) currentTerm.push(tx)
    else priorTerms.push(tx)
  }
  return { currentTerm, priorTerms }
}

export function currentPolicyPremiumFromTransactions(
  transactions: PolicyPremiumTxn[],
  options?: PolicyTermOptions,
): number {
  return roundPolicyPremiumMoney(
    selectCurrentTermTransactions(transactions, options).reduce(
      (sum, tx) => sum + toFiniteMoney(tx.amount),
      0,
    ),
  )
}

/**
 * Policy Details Financial Totals — same current-term set as Current Policy Premium.
 * Pool = SUM(agency commission) + SUM(broker fee) on that set.
 */
export function policyTermFinancialTotals(
  transactions: PolicyPremiumTxn[],
  options?: PolicyTermOptions,
): PolicyTermFinancialTotals {
  const term = selectCurrentTermTransactions(transactions, options)
  const currentPolicyPremium = roundPolicyPremiumMoney(
    term.reduce((sum, tx) => sum + toFiniteMoney(tx.amount), 0),
  )
  const totalAgencyCommission = roundPolicyPremiumMoney(
    term.reduce((sum, tx) => sum + toFiniteMoney(tx.agencyCommissionAmount), 0),
  )
  const totalBrokerFees = roundPolicyPremiumMoney(
    term.reduce((sum, tx) => sum + toFiniteMoney(tx.brokerFee), 0),
  )
  const totalProducerCommission = roundPolicyPremiumMoney(
    term.reduce((sum, tx) => sum + toFiniteMoney(tx.producerCommissionAmount), 0),
  )
  const totalAgencyNet = roundPolicyPremiumMoney(
    term.reduce((sum, tx) => sum + toFiniteMoney(tx.agencyNetCommission), 0),
  )
  return {
    currentPolicyPremium,
    totalBrokerFees,
    totalAgencyCommission,
    totalCommissionPool: roundPolicyPremiumMoney(totalAgencyCommission + totalBrokerFees),
    totalProducerCommission,
    totalAgencyNet,
    termTransactionIds: term.map((tx) => String(tx.id ?? '')).filter(Boolean),
  }
}

export function toPolicyPremiumTxn(input: {
  id?: string | null
  type?: string | null
  transaction_type?: string | null
  amount?: unknown
  premium_amount?: unknown
  archived?: boolean
  archived_at?: string | null
  voidedAt?: string | null
  voided_at?: string | null
  transactionDate?: string | null
  transaction_date?: string | null
  createdAt?: string | null
  created_at?: string | null
  transactionEffectiveDate?: string | null
  transaction_effective_date?: string | null
  transactionExpirationDate?: string | null
  transaction_expiration_date?: string | null
  brokerFee?: unknown
  broker_fee?: unknown
  agencyCommissionAmount?: unknown
  agency_commission_amount?: unknown
  producerCommissionAmount?: unknown
  producer_commission_amount?: unknown
  agencyNetCommission?: unknown
  agency_net_commission?: unknown
}): PolicyPremiumTxn {
  return {
    id: input.id ?? undefined,
    type: String(input.type ?? input.transaction_type ?? ''),
    amount: toFiniteMoney(input.amount ?? input.premium_amount),
    archived: Boolean(input.archived || input.archived_at),
    voidedAt: input.voidedAt ?? input.voided_at ?? null,
    transactionDate: input.transactionDate ?? input.transaction_date ?? null,
    createdAt: input.createdAt ?? input.created_at ?? null,
    transactionEffectiveDate:
      input.transactionEffectiveDate ?? input.transaction_effective_date ?? null,
    transactionExpirationDate:
      input.transactionExpirationDate ?? input.transaction_expiration_date ?? null,
    brokerFee: toFiniteMoney(input.brokerFee ?? input.broker_fee),
    agencyCommissionAmount: toFiniteMoney(
      input.agencyCommissionAmount ?? input.agency_commission_amount,
    ),
    producerCommissionAmount: toFiniteMoney(
      input.producerCommissionAmount ?? input.producer_commission_amount,
    ),
    agencyNetCommission: toFiniteMoney(input.agencyNetCommission ?? input.agency_net_commission),
  }
}

function hasLivePolicyTransactions(input: {
  transactionPremiumSum: number | null | undefined
  liveTransactionCount?: number | null | undefined
}): boolean {
  const countRaw = input.liveTransactionCount
  if (countRaw !== undefined && countRaw !== null && String(countRaw).trim() !== '') {
    const count = Number(countRaw)
    if (Number.isFinite(count)) return count > 0
  }
  // Count omitted: a non-zero current-term sum means a live ledger exists.
  return toFiniteMoney(input.transactionPremiumSum) !== 0
}

/**
 * Displayed Current Policy Premium.
 *
 * - No live transactions: imported/reference policies.premium (onboarding book of business).
 * - Any live transactions: current-term ledger only. policies.premium is never added.
 */
export function resolveCurrentPolicyPremium(input: {
  policyPremium?: number | null | undefined
  transactionPremiumSum: number | null | undefined
  liveTransactionCount?: number | null | undefined
}): number {
  if (hasLivePolicyTransactions(input)) {
    return roundPolicyPremiumMoney(toFiniteMoney(input.transactionPremiumSum))
  }
  return roundPolicyPremiumMoney(toFiniteMoney(input.policyPremium))
}

export function sumTransactionPremiumAmounts(
  amounts: Array<number | null | undefined>,
): number {
  return roundPolicyPremiumMoney(amounts.reduce<number>((sum, a) => sum + toFiniteMoney(a), 0))
}

/**
 * Client Total Premium = SUM(current-term premium) across that client's
 * non-archived policies. Same SoT as Policy Files / Policy Details / Client Details.
 */
export function sumClientCurrentPremium(
  policies: Array<{
    policyPremium: number | null | undefined
    transactionPremiumSum: number | null | undefined
    liveTransactionCount?: number | null | undefined
  }>,
): number {
  return roundPolicyPremiumMoney(
    policies.reduce(
      (sum, p) =>
        sum +
        resolveCurrentPolicyPremium({
          policyPremium: p.policyPremium,
          transactionPremiumSum: p.transactionPremiumSum,
          liveTransactionCount: p.liveTransactionCount,
        }),
      0,
    ),
  )
}

/**
 * Build per-client Total Premium maps from policy rows + per-policy current-term sums.
 * Archived policies/transactions must be excluded by the caller before passing data.
 */
export function buildClientTotalPremiumByClientId(input: {
  policies: Array<{
    id: string
    clientId: string
    premium: number | null | undefined
  }>
  /** Current-term premium by policy_id (from fetchPolicyTransactionSummaries). */
  transactionPremiumSumByPolicyId: Map<string, number> | Record<string, number>
  /** Live (non-voided, non-archived) transaction counts by policy_id. */
  liveTransactionCountByPolicyId?: Map<string, number> | Record<string, number>
}): Map<string, number> {
  const txnMap =
    input.transactionPremiumSumByPolicyId instanceof Map
      ? input.transactionPremiumSumByPolicyId
      : new Map(Object.entries(input.transactionPremiumSumByPolicyId))
  const countMap = !input.liveTransactionCountByPolicyId
    ? null
    : input.liveTransactionCountByPolicyId instanceof Map
      ? input.liveTransactionCountByPolicyId
      : new Map(Object.entries(input.liveTransactionCountByPolicyId))

  const byClient = new Map<
    string,
    Array<{
      policyPremium: number
      transactionPremiumSum: number
      liveTransactionCount?: number
    }>
  >()
  for (const policy of input.policies) {
    const clientId = String(policy.clientId ?? '').trim()
    if (!clientId) continue
    const list = byClient.get(clientId) ?? []
    list.push({
      policyPremium: toFiniteMoney(policy.premium),
      transactionPremiumSum: toFiniteMoney(txnMap.get(policy.id) ?? 0),
      liveTransactionCount: countMap ? toFiniteMoney(countMap.get(policy.id) ?? 0) : undefined,
    })
    byClient.set(clientId, list)
  }

  const totals = new Map<string, number>()
  for (const [clientId, policies] of byClient) {
    totals.set(clientId, sumClientCurrentPremium(policies))
  }
  return totals
}
