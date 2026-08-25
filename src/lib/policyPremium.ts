/**
 * Current Policy Premium display / SoT helper.
 *
 * Formula:
 *   current = policies.premium + SUM(non-archived transactions.amount)
 *
 * Why:
 * - Add Policy writes policies.premium = 0, so current equals the live transaction ledger.
 * - Onboarding stores opening/current premium on policies.premium with zero transactions;
 *   later endorsements/audits/cancellations adjust via signed transaction amounts.
 * - Do not invent synthetic opening transactions (avoids double-count if both existed).
 */

function toFiniteMoney(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export function roundPolicyPremiumMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/**
 * Resolve on-screen Current Policy Premium for one policy.
 * @param policyPremium policies.premium (opening / stored reference; Add Policy = 0)
 * @param transactionPremiumSum SUM(transactions.amount) for non-archived rows (signed)
 */
export function resolveCurrentPolicyPremium(input: {
  policyPremium: number | null | undefined
  transactionPremiumSum: number | null | undefined
}): number {
  const stored = toFiniteMoney(input.policyPremium)
  const txnSum = toFiniteMoney(input.transactionPremiumSum)
  return roundPolicyPremiumMoney(stored + txnSum)
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
  /** SUM(amount) by policy_id for non-archived transactions only. */
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

