/**
 * Connector sync interfaces (provider-agnostic).
 * Implementations come later per vendor — this phase defines the contract only.
 */

export type ConnectorSyncPhase =
  | 'source'
  | 'fetch'
  | 'normalize'
  | 'map'
  | 'validate'
  | 'deduplicate'
  | 'canonical_write'
  | 'result'

export const CONNECTOR_SYNC_PIPELINE: readonly ConnectorSyncPhase[] = [
  'source',
  'fetch',
  'normalize',
  'map',
  'validate',
  'deduplicate',
  'canonical_write',
  'result',
] as const

export type ConnectorSyncResult = {
  ok: boolean
  providerId: string
  startedAt: string
  finishedAt: string
  createdCount: number
  updatedCount: number
  skippedCount: number
  errorCount: number
  errors: Array<{ code: string; message: string; externalId?: string }>
  /** Never include secrets. */
  summary?: string
}

export type ConnectorCapability =
  | 'connect'
  | 'disconnect'
  | 'test_connection'
  | 'initial_sync'
  | 'incremental_sync'
  | 'manual_sync'
  | 'webhook_ingest'
  | 'sync_history'
  | 'sync_errors'

export const CONNECTOR_CAPABILITIES: readonly ConnectorCapability[] = [
  'connect',
  'disconnect',
  'test_connection',
  'initial_sync',
  'incremental_sync',
  'manual_sync',
  'webhook_ingest',
  'sync_history',
  'sync_errors',
] as const

/**
 * Future vendor connectors implement this interface.
 * No concrete vendor classes in V1 foundation.
 */
export type IntegrationConnector = {
  providerId: string
  capabilities: readonly ConnectorCapability[]
  connect: (input: { agencyId: string }) => Promise<{ connectionId: string }>
  disconnect: (input: { connectionId: string }) => Promise<void>
  testConnection: (input: { connectionId: string }) => Promise<{ ok: boolean; message?: string }>
  initialSync: (input: { connectionId: string }) => Promise<ConnectorSyncResult>
  incrementalSync: (input: { connectionId: string }) => Promise<ConnectorSyncResult>
  manualSync: (input: { connectionId: string }) => Promise<ConnectorSyncResult>
  ingestWebhook?: (input: {
    connectionId: string
    payload: unknown
  }) => Promise<ConnectorSyncResult>
}

export function assertSyncPipelineComplete(
  phases: readonly ConnectorSyncPhase[] = CONNECTOR_SYNC_PIPELINE,
): boolean {
  return (
    phases.length === CONNECTOR_SYNC_PIPELINE.length &&
    CONNECTOR_SYNC_PIPELINE.every((p, i) => phases[i] === p)
  )
}
