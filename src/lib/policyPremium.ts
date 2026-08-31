/**
 * Current Policy Premium display / SoT helper.
 *
 * Formula (same as Dashboard / Phase 4F):
 *   current = SUM(non-archived, non-voided transactions.amount)
 *
 * policies.premium is a stored reference (Add Policy writes 0; onboarding may persist an
 * imported value) and is not added into live/current totals.
 */

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

/**
 * Resolve on-screen Current Policy Premium for one policy.
 * @param policyPremium unused stored reference; kept so callers do not need a signature change
 * @param transactionPremiumSum SUM(transactions.amount) for non-archived, non-voided rows (signed)
 */
export function resolveCurrentPolicyPremium(input: {
  policyPremium?: number | null | undefined
  transactionPremiumSum: number | null | undefined
}): number {
  return roundPolicyPremiumMoney(toFiniteMoney(input.transactionPremiumSum))
}

export function sumTransactionPremiumAmounts(
  amounts: Array<number | null | undefined>,
): number {
  return roundPolicyPremiumMoney(amounts.reduce<number>((sum, a) => sum + toFiniteMoney(a), 0))
}

/**
 * Client Total Premium = SUM(resolveCurrentPolicyPremium) across that client's
 * non-archived policies. Same SoT as Policy Files / Policy Details / Client Details.
 */
export function sumClientCurrentPremium(
  policies: Array<{
    policyPremium: number | null | undefined
    transactionPremiumSum: number | null | undefined
  }>,
): number {
  return roundPolicyPremiumMoney(
    policies.reduce(
      (sum, p) =>
        sum +
        resolveCurrentPolicyPremium({
          policyPremium: p.policyPremium,
          transactionPremiumSum: p.transactionPremiumSum,
        }),
      0,
    ),
  )
}

/**
 * Build per-client Total Premium maps from policy rows + per-policy txn sums.
 * Archived policies/transactions must be excluded by the caller before passing data.
 */
export function buildClientTotalPremiumByClientId(input: {
  policies: Array<{
    id: string
    clientId: string
    premium: number | null | undefined
  }>
  /** SUM(amount) by policy_id for non-archived, non-voided transactions only. */
  transactionPremiumSumByPolicyId: Map<string, number> | Record<string, number>
}): Map<string, number> {
  const txnMap =
    input.transactionPremiumSumByPolicyId instanceof Map
      ? input.transactionPremiumSumByPolicyId
      : new Map(Object.entries(input.transactionPremiumSumByPolicyId))

  const byClient = new Map<
    string,
    Array<{ policyPremium: number; transactionPremiumSum: number }>
  >()
  for (const policy of input.policies) {
    const clientId = String(policy.clientId ?? '').trim()
    if (!clientId) continue
    const list = byClient.get(clientId) ?? []
    list.push({
      policyPremium: toFiniteMoney(policy.premium),
      transactionPremiumSum: toFiniteMoney(txnMap.get(policy.id) ?? 0),
    })
    byClient.set(clientId, list)
  }

  const totals = new Map<string, number>()
  for (const [clientId, policies] of byClient) {
    totals.set(clientId, sumClientCurrentPremium(policies))
  }
  return totals
}

