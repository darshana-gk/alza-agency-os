/**
 * Clients browse-page premium aggregation (query-row → displayed Total Premium).
 *
 * Same Current Policy Premium SoT as Policy Files / Policy Details / Client Details:
 *   per policy: current-term premium (NB/Renewal + signed adjustments)
 *   per client: SUM(per-policy current-term premium)
 */

import { parseMoney } from './reconciliationMatching'
import {
  buildClientTotalPremiumByClientId,
  currentPolicyPremiumFromTransactions,
  roundPolicyPremiumMoney,
  toPolicyPremiumTxn,
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
  premium_amount?: unknown
  transaction_type?: unknown
  type?: unknown
  archived_at?: unknown
  voided_at?: unknown
  created_at?: unknown
  transaction_date?: unknown
  transaction_effective_date?: unknown
  transaction_expiration_date?: unknown
  id?: unknown
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
  /** Pre-aggregated current-term premium by policy id (fetchPolicyTransactionSummaries). */
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
    const liveByPolicy = new Map<string, ReturnType<typeof toPolicyPremiumTxn>[]>()
    for (const row of input.transactions ?? []) {
      if (row.archived_at || row.voided_at) continue
      const policyId = asId(row.policy_id)
      if (!policyId) continue
      const list = liveByPolicy.get(policyId) ?? []
      list.push(
        toPolicyPremiumTxn({
          id: asId(row.id) || undefined,
          type: String(row.type ?? row.transaction_type ?? ''),
          amount: row.amount ?? row.premium_amount,
          archived_at: row.archived_at ? String(row.archived_at) : null,
          voided_at: row.voided_at ? String(row.voided_at) : null,
          created_at: row.created_at ? String(row.created_at) : null,
          transaction_date: row.transaction_date ? String(row.transaction_date) : null,
          transaction_effective_date: row.transaction_effective_date
            ? String(row.transaction_effective_date)
            : null,
          transaction_expiration_date: row.transaction_expiration_date
            ? String(row.transaction_expiration_date)
            : null,
        }),
      )
      liveByPolicy.set(policyId, list)
    }
    for (const [policyId, txns] of liveByPolicy) {
      transactionPremiumSumByPolicyId.set(policyId, currentPolicyPremiumFromTransactions(txns))
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
