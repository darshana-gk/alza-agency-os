import { fetchActiveProducerNames } from './directory'
import { supabase } from './supabase'

export type ProducerSplitSource = 'producer_default' | 'policy_override' | 'transaction_override'

/** Look up producer default split % by exact producer_name (active preferred). */
export async function fetchProducerDefaultSplit(
  producerName: string,
): Promise<{ split: number | null; error: string | null }> {
  const name = producerName.trim()
  if (!name) return { split: null, error: null }
  const { data, error } = await supabase
    .from('producers')
    .select('default_split_percentage, status, archived_at')
    .eq('producer_name', name)
    .is('archived_at', null)
    .order('status', { ascending: true })
    .limit(5)

  if (error) return { split: null, error: error.message }
  const active = (data ?? []).find((r) => String(r.status ?? '').toLowerCase() === 'active')
  const row = active ?? data?.[0]
  if (!row || row.default_split_percentage === null || row.default_split_percentage === undefined) {
    return { split: null, error: null }
  }
  return { split: Number(row.default_split_percentage), error: null }
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
