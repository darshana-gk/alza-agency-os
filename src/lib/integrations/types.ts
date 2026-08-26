/**
 * Integration Center V1 — provider-agnostic foundation types.
 * No secrets. No live vendor credentials. No Connected without a real connection record.
 */

export const INTEGRATION_CATEGORIES = [
  'ams',
  'crm',
  'carrier_mga_commission_feeds',
  'payments',
  'banking',
  'accounting',
  'documents',
  'email',
  'telephony',
  'identity',
  'data_import_export',
] as const

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number]

export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  ams: 'AMS / Agency Management',
  crm: 'CRM / Sales',
  carrier_mga_commission_feeds: 'Carrier/MGA Commission Feeds',
  payments: 'Payment / Premium Collection',
  banking: 'Banking',
  accounting: 'Accounting',
  documents: 'Documents / eSignature',
  email: 'Email / Communications',
  telephony: 'Telephony / SMS',
  identity: 'Identity / SSO',
  data_import_export: 'Data Import / Export',
}

/** Catalog availability — what the product exposes in UI before a live connector exists. */
export const INTEGRATION_AVAILABILITIES = [
  'available',
  'coming_soon',
  'request',
] as const

export type IntegrationAvailability = (typeof INTEGRATION_AVAILABILITIES)[number]

/**
 * Runtime / display connection status.
 * Connected is reserved for a real authenticated connection record — never catalog fiction.
 */
export const INTEGRATION_STATUSES = [
  'available',
  'connected',
  'action_required',
  'syncing',
  'error',
  'coming_soon',
  'requested',
] as const

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  available: 'Available',
  connected: 'Connected',
  action_required: 'Action Required',
  syncing: 'Syncing',
  error: 'Error',
  coming_soon: 'Coming Soon',
  requested: 'Requested',
}

export type IntegrationFeedKind =
  | 'api'
  | 'scheduled_file'
  | 'sftp'
  | 'webhook'
  | 'manual_upload'
  | 'oauth'
  | 'other'

export type IntegrationCardAction =
  | 'none'
  | 'connect'
  | 'manage'
  | 'request'
  | 'import_agency_data'

export type IntegrationProviderDefinition = {
  id: string
  name: string
  category: IntegrationCategory
  description: string
  /** Catalog tier — drives badges and allowed CTAs. */
  availability: IntegrationAvailability
  /** Optional feed architecture hints (esp. carrier/MGA). */
  feedKinds?: IntegrationFeedKind[]
  /** True for "Request … Integration" catalog rows. */
  isRequestPlaceholder?: boolean
  /** Route for non-connector fallbacks (e.g. onboarding). */
  fallbackPath?: string
  keywords?: string[]
}

/**
 * Provider-agnostic connection record shape (future persistence).
 * Secrets/tokens MUST NOT appear here or in the browser catalog.
 */
export type IntegrationConnectionRecord = {
  id: string
  providerId: string
  category: IntegrationCategory
  agencyId: string
  status: Exclude<IntegrationStatus, 'coming_soon' | 'available'>
  externalAccountId: string | null
  externalTenantId: string | null
  createdAt: string
  lastSuccessfulSyncAt: string | null
  lastAttemptedSyncAt: string | null
  nextSyncAt: string | null
  syncDirection: 'inbound' | 'outbound' | 'bidirectional'
  syncMode: 'manual' | 'scheduled' | 'webhook' | 'hybrid'
  errorCode: string | null
  errorMessage: string | null
  reconnectRequired: boolean
  disconnectedAt: string | null
  /** Non-secret connector metadata only. */
  metadata: Record<string, string | number | boolean | null>
}

export type SyncDirection = IntegrationConnectionRecord['syncDirection']
export type SyncMode = IntegrationConnectionRecord['syncMode']
