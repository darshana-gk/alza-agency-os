import { fetchActiveProducerNames, isMissingDirectoryColumnError } from './directory'
import { supabase } from './supabase'

export type ProducerSplitSource = 'producer_default' | 'policy_override' | 'transaction_override'

/** Look up producer default split % by exact producer_name (live directory preferred). */
export async function fetchProducerDefaultSplit(
  producerName: string,
): Promise<{ split: number | null; error: string | null }> {
  const name = producerName.trim()
  if (!name) return { split: null, error: null }

  const withStatus = await supabase
    .from('producers')
    .select('default_split_percentage, status, archived_at')
    .eq('producer_name', name)
    .is('archived_at', null)
    .order('status', { ascending: true })
    .limit(5)

  const statusMissing =
    Boolean(withStatus.error) &&
    /column .+status/i.test(withStatus.error?.message ?? '')
  const splitMissing =
    Boolean(withStatus.error) &&
    /default_split_percentage/i.test(withStatus.error?.message ?? '')

  // Staging producers may omit default_split_percentage — do not invent 0% or 100%.
  if (splitMissing) return { split: null, error: null }

  const queried =
    withStatus.error && statusMissing
      ? await supabase
          .from('producers')
          .select('default_split_percentage, archived_at')
          .eq('producer_name', name)
          .is('archived_at', null)
          .limit(5)
      : withStatus

  if (queried.error) {
    if (
      isMissingDirectoryColumnError(queried.error) ||
      /default_split_percentage/i.test(queried.error.message ?? '')
    ) {
      return { split: null, error: null }
    }
    return { split: null, error: queried.error.message }
  }

  const rows = (queried.data ?? []) as Array<{
    default_split_percentage?: number | string | null
    status?: string | null
  }>
  const active = rows.find((r) => String(r.status ?? 'active').toLowerCase() === 'active')
  const row = active ?? rows[0]
  if (!row || row.default_split_percentage === null || row.default_split_percentage === undefined) {
    return { split: null, error: null }
  }
  return { split: Number(row.default_split_percentage), error: null }
}

/**
 * Split % to prefill on Add Transaction.
 * A stored policy split (including override) wins over producer default.
 * Producer default is used only when the policy split is 0 / unset.
 * Split is a 0–100 percent, not a 0–1 fraction.
 */
export function splitPercentForNewTransaction(params: {
  policySplit: number
  policyOverride: boolean
  producerDefault: number | null
}): number {
  const policySplit = Number(params.policySplit)
  const policyHasSplit = Number.isFinite(policySplit) && policySplit > 0
  if (params.policyOverride || policyHasSplit) {
    return Number.isFinite(policySplit) ? policySplit : 0
  }
  if (params.producerDefault !== null && Number.isFinite(params.producerDefault)) {
    return params.producerDefault
  }
  return Number.isFinite(policySplit) ? policySplit : 0
}

export function resolveTransactionSplitSource(params: {
  split: number
  policySplit: number | null
  policyOverride: boolean
  producerDefault: number | null
}): ProducerSplitSource {
  const split = Number(params.split)
  if (
    params.policyOverride &&
    params.policySplit !== null &&
    Math.abs(split - Number(params.policySplit)) < 0.0001
  ) {
    return 'policy_override'
  }
  if (
    params.producerDefault !== null &&
    Math.abs(split - Number(params.producerDefault)) < 0.0001
  ) {
    return 'producer_default'
  }
  if (
    !params.policyOverride &&
    params.policySplit !== null &&
    Math.abs(split - Number(params.policySplit)) < 0.0001
  ) {
    // Policy stored producer default without override flag
    return 'producer_default'
  }
  return 'transaction_override'
}

export async function assertProducerAssignable(producerName: string): Promise<{
  ok: boolean
  message: string | null
}> {
  const name = producerName.trim()
  if (!name) return { ok: false, message: 'Producer is required.' }
  const { data } = await fetchActiveProducerNames()
  if (!data.includes(name)) {
    return {
      ok: false,
      message: `“${name}” is inactive or not in the active producer directory. Choose an active producer for new assignments.`,
    }
  }
  return { ok: true, message: null }
}
