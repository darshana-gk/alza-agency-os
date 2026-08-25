/**
 * Clients browse-page premium aggregation (query-row → displayed Total Premium).
 *
 * Same SoT as Policy Files / Policy Details / Client Details:
 *   per policy: policies.premium + SUM(non-archived txn amounts)
 *   per client: SUM(per-policy current premium)
 */

import { parseMoney } from './reconciliationMatching'
import {
  buildClientTotalPremiumByClientId,
  roundPolicyPremiumMoney,
} from './policyPremium'

function asId(value: unknown): string {
  return String(value ?? '').trim()
}

/** Coerce policies.premium from PostgREST (number | numeric string | money-ish). */
export function coercePolicyPremiumValue(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = parseMoney(value)
  if (parsed !== null) return parsed
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export type ClientsListPolicyRow = {
  id: unknown
  client_id: unknown
  /** Opening / stored premium from policies.premium */
  premium?: unknown
  /** Optional PostgREST alias: opening_premium:premium */
  opening_premium?: unknown
  archived_at?: unknown
}

export type ClientsListTransactionRow = {
  policy_id?: unknown
  amount?: unknown
  archived_at?: unknown
}

/**
 * Exact Clients-page aggregation used after Supabase returns policy (+ optional txn) rows.
 * Archived policy rows must already be excluded by the query (.is('archived_at', null)).
 */
export function aggregateClientsListPremiumFromRows(input: {
  policies: ClientsListPolicyRow[]
  /**
   * Non-archived transactions (optional if transactionPremiumSumByPolicyId provided).
   * Prefer policy_id sums — matches Policy Files / Client Details.
   */
  transactions?: ClientsListTransactionRow[]
  /** Pre-aggregated SUM(amount) by policy id (e.g. from fetchPolicyTransactionSummaries). */
  transactionPremiumSumByPolicyId?: Map<string, number> | Record<string, number>
}): {
  policyCountByClientId: Map<string, number>
  totalPremiumByClientId: Map<string, number>
} {
  const policyCountByClientId = new Map<string, number>()
  const policiesForPremium: Array<{ id: string; clientId: string; premium: number }> = []

  for (const row of input.policies) {
    const clientId = asId(row.client_id)
    const policyId = asId(row.id)
    if (!clientId || !policyId) continue

    policyCountByClientId.set(clientId, (policyCountByClientId.get(clientId) ?? 0) + 1)

    const premiumRaw =
      row.opening_premium !== undefined && row.opening_premium !== null
        ? row.opening_premium
        : row.premium
    policiesForPremium.push({
      id: policyId,
      clientId,
      premium: coercePolicyPremiumValue(premiumRaw),
    })
  }

  let transactionPremiumSumByPolicyId: Map<string, number>
  if (input.transactionPremiumSumByPolicyId instanceof Map) {
    transactionPremiumSumByPolicyId = input.transactionPremiumSumByPolicyId
  } else if (input.transactionPremiumSumByPolicyId) {
    transactionPremiumSumByPolicyId = new Map(
      Object.entries(input.transactionPremiumSumByPolicyId).map(([k, v]) => [
        k,
        roundPolicyPremiumMoney(Number(v) || 0),
      ]),
    )
  } else {
    transactionPremiumSumByPolicyId = new Map()
    for (const row of input.transactions ?? []) {
      const policyId = asId(row.policy_id)
      if (!policyId) continue
      const amount = coercePolicyPremiumValue(row.amount)
      transactionPremiumSumByPolicyId.set(
        policyId,
        roundPolicyPremiumMoney((transactionPremiumSumByPolicyId.get(policyId) ?? 0) + amount),
      )
    }
  }

  const totalPremiumByClientId = buildClientTotalPremiumByClientId({
    policies: policiesForPremium,
    transactionPremiumSumByPolicyId,
  })

  return { policyCountByClientId, totalPremiumByClientId }
}

/** Clients.tsx policies select — alias avoids any name collision with embeds. */
export const CLIENTS_LIST_POLICY_PREMIUM_SELECT =
  'id, client_id, opening_premium:premium' as const
