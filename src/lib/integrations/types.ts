/**
 * Integration Center V1 — provider-agnostic foundation types.
 * No secrets. No live vendor credentials. No Connected without a real connection record.
 */

/** Page/accordion order: live ALZA tools and core insurance first. */
export const INTEGRATION_CATEGORIES = [
  'data_import_export',
  'ams',
  'carrier_mga_commission_feeds',
  'crm',
  'accounting',
  'payments',
  'banking',
  'documents',
  'email',
  'telephony',
  'identity',
] as const

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number]

export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  data_import_export: 'Data Import / Export',
  ams: 'Agency Management Systems',
  carrier_mga_commission_feeds: 'Carrier/MGA Commission Feeds',
  crm: 'CRM & Sales',
  accounting: 'Accounting',
  payments: 'Payments & Premium Collection',
  banking: 'Banking',
  documents: 'Documents & eSignature',
  email: 'Email & Communications',
  telephony: 'Telephony & SMS',
  identity: 'Identity & SSO',
}

export const INTEGRATION_CATEGORY_BLURBS: Record<IntegrationCategory, string> = {
  data_import_export: 'CSV, XLSX, TXT, or paste',
  ams: 'Agency management systems',
  carrier_mga_commission_feeds: 'Commission statement feeds',
  crm: 'Sales and pipeline systems',
  accounting: 'Books and accounting references',
  payments: 'Premium collection platforms',
  banking: 'Deposit and bank signals',
  documents: 'eSignature and documents',
  email: 'Email and communications',
  telephony: 'Voice and SMS',
  identity: 'SSO and identity providers',
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
  | 'import_commission_statements'

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
