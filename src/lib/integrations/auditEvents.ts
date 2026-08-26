/**
 * Activity History event catalog for integrations (design only — emitters later).
 * Never log secrets, tokens, or raw credentials.
 */

export const INTEGRATION_AUDIT_EVENTS = [
  'integration_connected',
  'integration_disconnected',
  'integration_sync_started',
  'integration_sync_completed',
  'integration_sync_failed',
  'integration_records_created',
  'integration_records_updated',
  'integration_records_skipped',
  'integration_connection_requires_attention',
  'integration_requested',
] as const

export type IntegrationAuditEvent = (typeof INTEGRATION_AUDIT_EVENTS)[number]

export const INTEGRATION_AUDIT_EVENT_LABELS: Record<IntegrationAuditEvent, string> = {
  integration_connected: 'Integration connected',
  integration_disconnected: 'Integration disconnected',
  integration_sync_started: 'Sync started',
  integration_sync_completed: 'Sync completed',
  integration_sync_failed: 'Sync failed',
  integration_records_created: 'Records created',
  integration_records_updated: 'Records updated',
  integration_records_skipped: 'Records skipped',
  integration_connection_requires_attention: 'Connection requires attention',
  integration_requested: 'Integration requested',
}

export type IntegrationAuditPayload = {
  event: IntegrationAuditEvent
  providerId: string
  agencyId: string
  connectionId?: string
  counts?: { created?: number; updated?: number; skipped?: number; errors?: number }
  message?: string
  /** Explicitly forbid secret fields in payloads. */
  secretsForbidden: true
}
