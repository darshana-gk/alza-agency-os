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
