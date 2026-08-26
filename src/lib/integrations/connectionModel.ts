/**
 * Connection lifecycle + status resolution.
 * Connected is only returned when a real connection record exists and is authenticated.
 */

import type {
  IntegrationCardAction,
  IntegrationConnectionRecord,
  IntegrationProviderDefinition,
  IntegrationStatus,
} from './types'
import { INTEGRATION_STATUS_LABELS } from './types'

export type ResolvedProviderCard = {
  provider: IntegrationProviderDefinition
  status: IntegrationStatus
  statusLabel: string
  lastSuccessfulSyncAt: string | null
  action: IntegrationCardAction
  actionLabel: string
  connectAllowed: boolean
}

/**
 * Resolve display status for a catalog provider given optional live connection rows.
 * Without a connection record, Coming Soon / Request / Available never become Connected.
 */
export function resolveProviderCardStatus(
  provider: IntegrationProviderDefinition,
  connection: IntegrationConnectionRecord | null | undefined,
  options?: { locallyRequested?: boolean },
): ResolvedProviderCard {
  if (provider.fallbackPath) {
    return {
      provider,
      status: 'available',
      statusLabel: INTEGRATION_STATUS_LABELS.available,
      lastSuccessfulSyncAt: null,
      action: 'import_agency_data',
      actionLabel: 'Import Agency Data',
      connectAllowed: false,
    }
  }

  if (connection && !connection.disconnectedAt) {
    const safeStatus: IntegrationStatus = connection.status
    const manageLike =
      safeStatus === 'connected' ||
      safeStatus === 'action_required' ||
      safeStatus === 'syncing' ||
      safeStatus === 'error'
    return {
      provider,
      status: safeStatus,
      statusLabel: INTEGRATION_STATUS_LABELS[safeStatus],
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      action: manageLike ? 'manage' : 'none',
      actionLabel: manageLike ? 'Manage' : '',
      connectAllowed: false,
    }
  }

  if (provider.availability === 'request' || provider.isRequestPlaceholder) {
    const requested = Boolean(options?.locallyRequested)
    return {
      provider,
      status: requested ? 'requested' : 'available',
      statusLabel: requested
        ? INTEGRATION_STATUS_LABELS.requested
        : INTEGRATION_STATUS_LABELS.available,
      lastSuccessfulSyncAt: null,
      action: 'request',
      actionLabel: requested ? 'Requested' : 'Request Integration',
      connectAllowed: false,
    }
  }

  if (provider.availability === 'coming_soon') {
    return {
      provider,
      status: 'coming_soon',
      statusLabel: INTEGRATION_STATUS_LABELS.coming_soon,
      lastSuccessfulSyncAt: null,
      action: 'request',
      actionLabel: 'Request Integration',
      connectAllowed: false,
    }
  }

  // availability === 'available' but no live connector yet → no Connect CTA
  return {
    provider,
    status: 'available',
    statusLabel: INTEGRATION_STATUS_LABELS.available,
    lastSuccessfulSyncAt: null,
    action: 'request',
    actionLabel: 'Request Integration',
    connectAllowed: false,
  }
}

/** Hard rule: Coming Soon catalog rows must never render as Connected. */
export function comingSoonMustNotBeConnected(
  provider: IntegrationProviderDefinition,
  status: IntegrationStatus,
): boolean {
  if (provider.availability === 'coming_soon' && !provider.fallbackPath) {
    return status !== 'connected'
  }
  return true
}

export function connectionLifecycleStages(): readonly string[] {
  return [
    'discover',
    'authorize',
    'connect',
    'test_connection',
    'initial_sync',
    'incremental_sync',
    'manual_sync',
    'webhook_ingest',
    'action_required',
    'reconnect',
    'disconnect',
  ] as const
}
