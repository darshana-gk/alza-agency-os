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

/** Transaction fields used to present a policy term without a new DB table. */
export type PolicyTermTxn = PolicyPremiumTxn & {
  policyNumber?: string | null
  policyEffectiveDate?: string | null
  policyExpirationDate?: string | null
  producer?: string | null
  csr?: string | null
  carrier?: string | null
  mga?: string | null
  commissionType?: string | null
  agencyCommissionPercentage?: number | null
  producerSplitPercentage?: number | null
}

/** Synthetic term id when a Policy File has no establishing New Business / Renewal yet. */
export const FILE_CURRENT_TERM_ID = 'current'

export type PolicyFileIdentity = {
  policyNumber?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  producer?: string | null
  csr?: string | null
  carrier?: string | null
  mga?: string | null
  premium?: number | null
}

export type PolicyFileTerm = {
  termId: string
  isCurrent: boolean
  establishingTransactionId: string | null
  priorTermId: string | null
  nextTermId: string | null
  policyNumber: string
  effectiveDate: string
  expirationDate: string
  producer: string
  csr: string
  carrier: string
  mga: string
  transactionIds: string[]
  liveTransactionCount: number
  displayedPremium: number
  totals: PolicyTermFinancialTotals
  commissionType: string | null
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  producerSplitPercentage: number | null
}

/** Identity + commission used to prefill Add Transaction on a selected term. */
export type PolicyTermCreateAnchor = {
  termId: string
  isCurrent: boolean
  policyNumber: string
  effectiveDate: string
  expirationDate: string
  producer: string
  csr: string
  carrier: string
  mga: string
  commissionType: string | null
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  producerSplitPercentage: number | null
}

export const EXPIRED_TERM_ADD_WARNING = 'You are adding a transaction to an expired policy term.'

export function displayValueOrEmpty(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim()
  return !trimmed || trimmed === '—' ? '' : trimmed
}

export function policyTermCreateAnchor(term: PolicyFileTerm): PolicyTermCreateAnchor {
  return {
    termId: term.termId,
    isCurrent: term.isCurrent,
    policyNumber: displayValueOrEmpty(term.policyNumber),
    effectiveDate: isoDate(term.effectiveDate),
    expirationDate: isoDate(term.expirationDate),
    producer: displayValueOrEmpty(term.producer),
    csr: displayValueOrEmpty(term.csr),
    carrier: displayValueOrEmpty(term.carrier),
    mga: displayValueOrEmpty(term.mga),
    commissionType: term.commissionType,
    agencyCommissionPercentage: term.agencyCommissionPercentage,
    agencyCommissionAmount: term.agencyCommissionAmount,
    brokerFee: term.brokerFee,
    producerSplitPercentage: term.producerSplitPercentage,
  }
}

export function policyTermCreateSnapshots(anchor: PolicyTermCreateAnchor): {
  policyNumber: string
  policyEffectiveDate: string
  policyExpirationDate: string
  producer: string
  csr: string
  carrier: string
  mga: string
  lockPolicyIdentitySnapshot: boolean
  defaultTransactionType: 'endorsement_premium' | 'new_policy_premium'
} {
  return {
    policyNumber: anchor.policyNumber,
    policyEffectiveDate: anchor.effectiveDate,
    policyExpirationDate: anchor.expirationDate,
    producer: anchor.producer,
    csr: anchor.csr,
    carrier: anchor.carrier,
    mga: anchor.mga,
    lockPolicyIdentitySnapshot: !anchor.isCurrent,
    defaultTransactionType: anchor.isCurrent ? 'new_policy_premium' : 'endorsement_premium',
  }
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

export function isPolicyTermEstablishingType(type: string | null | undefined): boolean {
  return (TERM_ESTABLISHING_TYPES as readonly string[]).includes(String(type ?? '').trim())
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

function dash(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || '—'
}

function totalsFromTermSet(term: PolicyPremiumTxn[]): PolicyTermFinancialTotals {
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

/**
 * Live transactions that belong to one establishing New Business / Renewal term.
 * Same membership rules as current-term totals; does not change that formula.
 */
export function selectTermTransactions<T extends PolicyPremiumTxn>(
  transactions: T[],
  establishing: T,
  options?: PolicyTermOptions,
): T[] {
  const live = transactions.filter(isLiveTxn)
  const termStart =
    isoDate(establishing.transactionEffectiveDate) || isoDate(options?.policyEffectiveDate)
  const termEnd =
    isoDate(establishing.transactionExpirationDate) || isoDate(options?.policyExpirationDate)
  const establishingId = String(establishing.id ?? '')
  const head = live.find((tx) => String(tx.id ?? '') === establishingId)
  const adjustments = live
    .filter((tx) => isTermAdjustingType(tx.type))
    .filter((tx) => adjustmentBelongsToTerm(tx, establishing, termStart, termEnd))
  return head ? [head, ...adjustments] : adjustments
}

function termDisplayIds<T extends PolicyTermTxn>(
  transactions: T[],
  establishing: T,
  liveIds: Set<string>,
  options?: PolicyTermOptions,
): string[] {
  const termStart =
    isoDate(establishing.transactionEffectiveDate) || isoDate(options?.policyEffectiveDate)
  const termEnd =
    isoDate(establishing.transactionExpirationDate) || isoDate(options?.policyExpirationDate)
  const ids: string[] = []
  for (const tx of transactions) {
    if (tx.archived) continue
    const id = String(tx.id ?? '')
    if (!id) continue
    if (liveIds.has(id)) {
      ids.push(id)
      continue
    }
    if (!tx.voidedAt) continue
    if (id === String(establishing.id ?? '')) {
      ids.push(id)
      continue
    }
    if (
      isTermAdjustingType(tx.type) &&
      adjustmentBelongsToTerm(tx, establishing, termStart, termEnd)
    ) {
      ids.push(id)
    }
  }
  return ids
}

export function policyTermPath(policyId: string, termId?: string | null): string {
  const id = String(policyId ?? '').trim()
  const term = String(termId ?? '').trim()
  if (!id) return '/policy-files'
  if (!term || term === FILE_CURRENT_TERM_ID) return `/policies/${id}`
  return `/policies/${id}?term=${encodeURIComponent(term)}`
}

/**
 * Present each establishing New Business / Renewal as its own policy-term entry.
 * Does not create policy rows or mutate snapshots. Oldest term first.
 */
export function listPolicyFileTerms(
  transactions: PolicyTermTxn[],
  file: PolicyFileIdentity,
  options?: PolicyTermOptions,
): PolicyFileTerm[] {
  const establishing = transactions
    .filter((tx) => !tx.archived && isPolicyTermEstablishingType(tx.type) && !tx.voidedAt)
    .sort((a, b) => compareEstablishing(b, a))

  if (establishing.length === 0) {
    const displayTxns = transactions.filter((tx) => !tx.archived)
    const live = displayTxns.filter(isLiveTxn)
    const totals = policyTermFinancialTotals(transactions, options)
    return [
      {
        termId: FILE_CURRENT_TERM_ID,
        isCurrent: true,
        establishingTransactionId: null,
        priorTermId: null,
        nextTermId: null,
        policyNumber: dash(file.policyNumber),
        effectiveDate: isoDate(file.effectiveDate),
        expirationDate: isoDate(file.expirationDate),
        producer: dash(file.producer),
        csr: dash(file.csr),
        carrier: dash(file.carrier),
        mga: dash(file.mga),
        transactionIds: displayTxns.map((tx) => String(tx.id ?? '')).filter(Boolean),
        liveTransactionCount: live.length,
        displayedPremium: resolveCurrentPolicyPremium({
          policyPremium: file.premium,
          transactionPremiumSum: totals.currentPolicyPremium,
          liveTransactionCount: live.length,
        }),
        totals,
        commissionType: null,
        agencyCommissionPercentage: null,
        agencyCommissionAmount: 0,
        brokerFee: 0,
        producerSplitPercentage: null,
      },
    ]
  }

  const fileDates = {
    policyEffectiveDate: options?.policyEffectiveDate ?? file.effectiveDate,
    policyExpirationDate: options?.policyExpirationDate ?? file.expirationDate,
  }
  const currentId = String(establishing[establishing.length - 1]?.id ?? '')

  return establishing.map((head, index) => {
    const liveTerm = selectTermTransactions(transactions, head, fileDates)
    const liveIds = new Set(liveTerm.map((tx) => String(tx.id ?? '')).filter(Boolean))
    const totals = totalsFromTermSet(liveTerm)
    const dates = resolveDisplayedPolicyTerm({
      snapshotEffectiveDate: head.policyEffectiveDate || head.transactionEffectiveDate,
      snapshotExpirationDate: head.policyExpirationDate || head.transactionExpirationDate,
      currentEffectiveDate: index === establishing.length - 1 ? file.effectiveDate : null,
      currentExpirationDate: index === establishing.length - 1 ? file.expirationDate : null,
    })
    const isCurrent = String(head.id ?? '') === currentId
    return {
      termId: String(head.id ?? ''),
      isCurrent,
      establishingTransactionId: String(head.id ?? '') || null,
      priorTermId: index > 0 ? String(establishing[index - 1]?.id ?? '') : null,
      nextTermId:
        index < establishing.length - 1 ? String(establishing[index + 1]?.id ?? '') : null,
      policyNumber: resolveDisplayedPolicyNumber({
        snapshotPolicyNumber: head.policyNumber,
        currentPolicyNumber: isCurrent ? file.policyNumber : null,
      }),
      effectiveDate: dates.effectiveDate,
      expirationDate: dates.expirationDate,
      producer: dash(head.producer || (isCurrent ? file.producer : null)),
      csr: dash(head.csr || (isCurrent ? file.csr : null)),
      carrier: dash(head.carrier || (isCurrent ? file.carrier : null)),
      mga: dash(head.mga || (isCurrent ? file.mga : null)),
      transactionIds: termDisplayIds(transactions, head, liveIds, fileDates),
      liveTransactionCount: liveTerm.length,
      displayedPremium: isCurrent
        ? resolveCurrentPolicyPremium({
            policyPremium: file.premium,
            transactionPremiumSum: totals.currentPolicyPremium,
            liveTransactionCount: liveTerm.length,
          })
        : totals.currentPolicyPremium,
      totals,
      commissionType: head.commissionType ?? null,
      agencyCommissionPercentage:
        head.agencyCommissionPercentage === undefined ? null : head.agencyCommissionPercentage,
      agencyCommissionAmount: toFiniteMoney(head.agencyCommissionAmount),
      brokerFee: toFiniteMoney(head.brokerFee),
      producerSplitPercentage:
        head.producerSplitPercentage === undefined ? null : head.producerSplitPercentage,
    }
  })
}

export function resolvePolicyFileTerm(
  terms: PolicyFileTerm[],
  termId?: string | null,
): PolicyFileTerm | null {
  if (terms.length === 0) return null
  const wanted = String(termId ?? '').trim()
  if (wanted) {
    const match = terms.find((term) => term.termId === wanted)
    if (match) return match
  }
  return terms.find((term) => term.isCurrent) ?? terms[terms.length - 1] ?? null
}

export function groupPolicyTermsByLineOfBusiness<
  T extends { policyType: string },
>(terms: T[]): Array<{ lineOfBusiness: string; terms: T[] }> {
  const groups: Array<{ lineOfBusiness: string; terms: T[] }> = []
  const indexByKey = new Map<string, number>()
  for (const term of terms) {
    const label = String(term.policyType ?? '').trim() || '—'
    const key = label.toLowerCase()
    const existing = indexByKey.get(key)
    if (existing === undefined) {
      indexByKey.set(key, groups.length)
      groups.push({ lineOfBusiness: label, terms: [term] })
    } else {
      groups[existing].terms.push(term)
    }
  }
  return groups
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
  return totalsFromTermSet(selectCurrentTermTransactions(transactions, options))
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

function toNullableFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function toPolicyTermTxn(input: Parameters<typeof toPolicyPremiumTxn>[0] & {
  policyNumber?: string | null
  policy_number?: string | null
  policyEffectiveDate?: string | null
  policy_effective_date?: string | null
  policyExpirationDate?: string | null
  policy_expiration_date?: string | null
  producer?: string | null
  csr?: string | null
  carrier?: string | null
  mga?: string | null
  commissionType?: string | null
  commission_type?: string | null
  agencyCommissionPercentage?: number | null
  agency_commission_percentage?: number | string | null
  producerSplitPercentage?: number | null
  producer_split_percentage?: number | string | null
}): PolicyTermTxn {
  return {
    ...toPolicyPremiumTxn(input),
    policyNumber: input.policyNumber ?? input.policy_number ?? null,
    policyEffectiveDate: input.policyEffectiveDate ?? input.policy_effective_date ?? null,
    policyExpirationDate: input.policyExpirationDate ?? input.policy_expiration_date ?? null,
    producer: input.producer ?? null,
    csr: input.csr ?? null,
    carrier: input.carrier ?? null,
    mga: input.mga ?? null,
    commissionType: input.commissionType ?? input.commission_type ?? null,
    agencyCommissionPercentage: toNullableFinite(
      input.agencyCommissionPercentage ?? input.agency_commission_percentage,
    ),
    producerSplitPercentage: toNullableFinite(
      input.producerSplitPercentage ?? input.producer_split_percentage,
    ),
  }
}

export function resolveTermTransactionPolicyNumber(input: {
  snapshotPolicyNumber?: string | null
  termPolicyNumber?: string | null
  livePolicyNumber?: string | null
  isCurrentTerm: boolean
}): string {
  const snapshot = String(input.snapshotPolicyNumber ?? '').trim()
  if (snapshot && snapshot !== '—') return snapshot
  if (!input.isCurrentTerm) {
    const term = String(input.termPolicyNumber ?? '').trim()
    return term || '—'
  }
  return resolveDisplayedPolicyNumber({
    snapshotPolicyNumber: snapshot,
    currentPolicyNumber: input.livePolicyNumber,
  })
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
