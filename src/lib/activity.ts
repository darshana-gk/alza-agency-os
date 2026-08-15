import { supabase } from './supabase'

export type ActivityEntityType =
  | 'client'
  | 'policy'
  | 'transaction'
  | 'recovery'
  | 'payment_batch'
  | 'document'
  | 'user'
  | 'agency'
  | 'producer'
  | 'other'

export interface ActivityHistoryRow {
  id: string
  actorUserId: string | null
  actorName: string
  actorRole: string
  action: string
  entityType: string
  entityId: string | null
  recordReference: string
  clientId: string | null
  policyId: string | null
  transactionId: string | null
  oldValue: unknown
  newValue: unknown
  metadata: Record<string, unknown>
  createdAt: string
}

export interface RecordActivityInput {
  action: string
  entityType: ActivityEntityType | string
  entityId?: string | null
  recordReference?: string | null
  clientId?: string | null
  policyId?: string | null
  transactionId?: string | null
  oldValue?: unknown
  newValue?: unknown
  metadata?: Record<string, unknown>
}

async function resolveActor(): Promise<{
  id: string | null
  name: string | null
  role: string | null
}> {
  const { data: authData } = await supabase.auth.getUser()
  const authUserId = authData.user?.id
  if (!authUserId) return { id: null, name: null, role: null }
  const { data } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return {
    id: (data?.id as string | undefined) ?? null,
    name: (data?.full_name as string | undefined) ?? null,
    role: (data?.role as string | undefined) ?? null,
  }
}

/** Append-only audit write. Never throws into UX; returns error for callers that care. */
export async function recordActivity(input: RecordActivityInput): Promise<{ error: string | null }> {
  try {
    const actor = await resolveActor()
    const { error } = await supabase.from('activity_history').insert({
      actor_user_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      record_reference: input.recordReference ?? null,
      client_id: input.clientId ?? null,
      policy_id: input.policyId ?? null,
      transaction_id: input.transactionId ?? null,
      old_value: input.oldValue ?? null,
      new_value: input.newValue ?? null,
      metadata: input.metadata ?? {},
    })
    return { error: error?.message ?? null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to write activity history.' }
  }
}

export async function fetchActivityHistory(filters?: {
  entityType?: string
  entityId?: string
  transactionId?: string
  policyId?: string
  clientId?: string
  actorUserId?: string
  action?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
}): Promise<{ data: ActivityHistoryRow[]; error: string | null }> {
  let query = supabase
    .from('activity_history')
    .select(
      `
      id, actor_user_id, actor_name, actor_role, action, entity_type, entity_id,
      record_reference, client_id, policy_id, transaction_id,
      old_value, new_value, metadata, created_at
    `,
    )
    .order('created_at', { ascending: false })
    .limit(filters?.limit ?? 200)

  if (filters?.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters?.entityId) query = query.eq('entity_id', filters.entityId)
  if (filters?.transactionId) query = query.eq('transaction_id', filters.transactionId)
  if (filters?.policyId) query = query.eq('policy_id', filters.policyId)
  if (filters?.clientId) query = query.eq('client_id', filters.clientId)
  if (filters?.actorUserId) query = query.eq('actor_user_id', filters.actorUserId)
  if (filters?.action) query = query.eq('action', filters.action)
  if (filters?.dateFrom) query = query.gte('created_at', `${filters.dateFrom}T00:00:00`)
  if (filters?.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59`)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }

  return {
    data: (data ?? []).map((row) => ({
      id: String(row.id),
      actorUserId: (row.actor_user_id as string | null) ?? null,
      actorName: String(row.actor_name ?? '—'),
      actorRole: String(row.actor_role ?? ''),
      action: String(row.action ?? ''),
      entityType: String(row.entity_type ?? ''),
      entityId: (row.entity_id as string | null) ?? null,
      recordReference: String(row.record_reference ?? '—'),
      clientId: (row.client_id as string | null) ?? null,
      policyId: (row.policy_id as string | null) ?? null,
      transactionId: (row.transaction_id as string | null) ?? null,
      oldValue: row.old_value,
      newValue: row.new_value,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: String(row.created_at ?? ''),
    })),
    error: null,
  }
}
