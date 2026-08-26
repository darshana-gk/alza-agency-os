/**
 * Shared Integration Center provider catalog.
 * Single source of truth for cards — pages must not hardcode separate provider lists.
 *
 * SECURITY: This catalog must never contain API keys, OAuth secrets, or tokens.
 */

import type { IntegrationProviderDefinition } from './types'
import { INTEGRATION_CATEGORIES } from './types'

export const INTEGRATION_PROVIDER_CATALOG: readonly IntegrationProviderDefinition[] = [
  // —— AMS / Agency Management ——
  {
    id: 'ams360',
    name: 'AMS360',
    category: 'ams',
    description: 'Vertafore AMS360 agency management system.',
    availability: 'coming_soon',
    keywords: ['vertafore', 'ams'],
  },
  {
    id: 'applied_epic',
    name: 'Applied Epic',
    category: 'ams',
    description: 'Applied Epic agency management platform.',
    availability: 'coming_soon',
    keywords: ['applied', 'epic'],
  },
  {
    id: 'sagitta',
    name: 'Sagitta',
    category: 'ams',
    description: 'Vertafore Sagitta agency management system.',
    availability: 'coming_soon',
    keywords: ['vertafore'],
  },
  {
    id: 'hawksoft',
    name: 'HawkSoft',
    category: 'ams',
    description: 'HawkSoft agency management software.',
    availability: 'coming_soon',
  },
  {
    id: 'nowcerts',
    name: 'NowCerts',
    category: 'ams',
    description: 'NowCerts AMS / agency management.',
    availability: 'coming_soon',
  },
  {
    id: 'ezlynx',
    name: 'EZLynx',
    category: 'ams',
    description: 'EZLynx agency management and rating.',
    availability: 'coming_soon',
  },
  {
    id: 'qqcatalyst',
    name: 'QQCatalyst',
    category: 'ams',
    description: 'QQCatalyst agency management system.',
    availability: 'coming_soon',
    keywords: ['qq'],
  },
  {
    id: 'agency_matrix',
    name: 'Agency Matrix',
    category: 'ams',
    description: 'Agency Matrix AMS platform.',
    availability: 'coming_soon',
  },
  {
    id: 'applied_tam',
    name: 'Applied TAM',
    category: 'ams',
    description: 'Applied TAM agency management.',
    availability: 'coming_soon',
    keywords: ['applied', 'tam'],
  },
  {
    id: 'nexsure',
    name: 'Nexsure',
    category: 'ams',
    description: 'Nexsure agency management system.',
    availability: 'coming_soon',
  },
  {
    id: 'agencybloc',
    name: 'AgencyBloc',
    category: 'ams',
    description: 'AgencyBloc AMS / agency operations.',
    availability: 'coming_soon',
  },

  // —— CRM / Sales ——
  {
    id: 'agencyzoom',
    name: 'AgencyZoom',
    category: 'crm',
    description: 'Insurance CRM and sales pipeline.',
    availability: 'coming_soon',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    description: 'Salesforce CRM for agency sales and service.',
    availability: 'coming_soon',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    description: 'HubSpot CRM and marketing hub.',
    availability: 'coming_soon',
  },

  // —— Carrier / MGA Commission Feeds (REQUIRED) ——
  {
    id: 'carrier_commission_feed_generic',
    name: 'Carrier Commission Feeds',
    category: 'carrier_mga_commission_feeds',
    description:
      'Architecture for carrier commission statements via API, scheduled file, SFTP, or webhook — normalized into ALZA reconciliation staging (existing engine).',
    availability: 'coming_soon',
    feedKinds: ['api', 'scheduled_file', 'sftp', 'webhook', 'manual_upload'],
    keywords: ['carrier', 'commission', 'statement'],
  },
  {
    id: 'mga_commission_feed_generic',
    name: 'MGA Commission Feeds',
    category: 'carrier_mga_commission_feeds',
    description:
      'Architecture for MGA / wholesaler commission feeds that normalize into ALZA reconciliation staging without a second matching engine.',
    availability: 'coming_soon',
    feedKinds: ['api', 'scheduled_file', 'sftp', 'webhook', 'manual_upload'],
    keywords: ['mga', 'wholesaler', 'commission'],
  },
  {
    id: 'request_carrier_mga_integration',
    name: 'Request Carrier/MGA Integration',
    category: 'carrier_mga_commission_feeds',
    description:
      'Request a specific carrier, MGA, or wholesaler commission feed. Individual providers can be added later without redesigning ALZA.',
    availability: 'request',
    isRequestPlaceholder: true,
    feedKinds: ['api', 'scheduled_file', 'sftp', 'webhook'],
    keywords: ['request', 'carrier', 'mga'],
  },

  // —— Payments ——
  {
    id: 'ascend',
    name: 'Ascend',
    category: 'payments',
    description: 'Insurance payment / premium collection platform.',
    availability: 'coming_soon',
    keywords: ['payment', 'premium'],
  },
  {
    id: 'simply_easier_payments',
    name: 'Simply Easier Payments',
    category: 'payments',
    description: 'Insurance payment processing platform.',
    availability: 'coming_soon',
    keywords: ['sep', 'payment'],
  },
  {
    id: 'other_payment_platform',
    name: 'Other Insurance Payment Platform',
    category: 'payments',
    description: 'Placeholder for additional payment / premium collection platforms.',
    availability: 'coming_soon',
  },
  {
    id: 'request_payment_integration',
    name: 'Request Payment Integration',
    category: 'payments',
    description: 'Request a payment platform connector for your agency.',
    availability: 'request',
    isRequestPlaceholder: true,
  },

  // —— Banking ——
  {
    id: 'plaid',
    name: 'Plaid / Connected Bank',
    category: 'banking',
    description:
      'Bank connection architecture for deposit signals as commission evidence — not whole-premium bank reconciliation.',
    availability: 'coming_soon',
    keywords: ['bank', 'deposit'],
  },
  {
    id: 'other_bank_connection',
    name: 'Other Bank Connection',
    category: 'banking',
    description: 'Additional bank-connection providers (architecture only in V1).',
    availability: 'coming_soon',
  },

  // —— Accounting ——
  {
    id: 'quickbooks_online',
    name: 'QuickBooks Online',
    category: 'accounting',
    description: 'Accounting evidence: posted receipts, deposits, payment references.',
    availability: 'coming_soon',
    keywords: ['qbo', 'quickbooks'],
  },
  {
    id: 'xero',
    name: 'Xero',
    category: 'accounting',
    description: 'Xero accounting references and reconciliation evidence.',
    availability: 'coming_soon',
  },
  {
    id: 'other_accounting_system',
    name: 'Other Accounting System',
    category: 'accounting',
    description: 'Additional accounting systems (architecture only in V1).',
    availability: 'coming_soon',
  },

  // —— Documents ——
  {
    id: 'docusign',
    name: 'DocuSign',
    category: 'documents',
    description: 'eSignature and document workflows.',
    availability: 'coming_soon',
  },
  {
    id: 'adobe_acrobat_sign',
    name: 'Adobe Acrobat Sign',
    category: 'documents',
    description: 'Adobe Acrobat Sign eSignature.',
    availability: 'coming_soon',
    keywords: ['adobe'],
  },
  {
    id: 'other_documents',
    name: 'Other Documents / eSignature',
    category: 'documents',
    description: 'Additional document or eSignature providers.',
    availability: 'coming_soon',
  },

  // —— Email ——
  {
    id: 'microsoft_365_outlook',
    name: 'Microsoft 365 / Outlook',
    category: 'email',
    description: 'Email and calendar communications.',
    availability: 'coming_soon',
    keywords: ['microsoft', 'outlook', 'office'],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'email',
    description: 'Gmail / Google Workspace email.',
    availability: 'coming_soon',
    keywords: ['google'],
  },
  {
    id: 'other_email',
    name: 'Other Email / Communications',
    category: 'email',
    description: 'Additional email or communications providers.',
    availability: 'coming_soon',
  },

  // —— Telephony ——
  {
    id: 'dialpad',
    name: 'Dialpad',
    category: 'telephony',
    description: 'Telephony and SMS communications.',
    availability: 'coming_soon',
  },
  {
    id: 'other_telephony',
    name: 'Other Telephony / SMS',
    category: 'telephony',
    description: 'Additional telephony or SMS providers.',
    availability: 'coming_soon',
  },

  // —— Identity ——
  {
    id: 'microsoft_sso',
    name: 'Microsoft',
    category: 'identity',
    description: 'Microsoft identity / SSO.',
    availability: 'coming_soon',
    keywords: ['azure', 'entra', 'sso'],
  },
  {
    id: 'google_sso',
    name: 'Google',
    category: 'identity',
    description: 'Google identity / SSO.',
    availability: 'coming_soon',
    keywords: ['sso'],
  },
  {
    id: 'saml_enterprise_sso',
    name: 'SAML / Enterprise SSO',
    category: 'identity',
    description: 'Enterprise SAML single sign-on.',
    availability: 'coming_soon',
    keywords: ['saml', 'sso'],
  },
  {
    id: 'other_identity',
    name: 'Other Identity / SSO',
    category: 'identity',
    description: 'Additional identity providers.',
    availability: 'coming_soon',
  },

  // —— Data Import / Export (fallback to Onboarding — not a vendor connector) ——
  {
    id: 'alza_onboarding_import',
    name: 'Import Agency Data',
    category: 'data_import_export',
    description:
      'Universal fallback: Master Agency Data, Clients, Policies, Carriers, MGAs, Producers, and CSRs via Onboarding Import. Does not duplicate the onboarding engine.',
    availability: 'available',
    fallbackPath: '/onboarding',
    keywords: ['onboarding', 'csv', 'master', 'import', 'export'],
  },
] as const

const SECRETISH_KEYS = [
  'apiKey',
  'api_key',
  'clientSecret',
  'client_secret',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'password',
  'secret',
  'token',
  'oauth',
] as const

export function getProviderById(id: string): IntegrationProviderDefinition | undefined {
  return INTEGRATION_PROVIDER_CATALOG.find((p) => p.id === id)
}

export function providersInCategory(
  category: IntegrationProviderDefinition['category'],
): IntegrationProviderDefinition[] {
  return INTEGRATION_PROVIDER_CATALOG.filter((p) => p.category === category)
}

/** Preserve catalog order within each category (no business-priority re-sort). */
export function groupProvidersByCategory(
  providers: readonly IntegrationProviderDefinition[] = INTEGRATION_PROVIDER_CATALOG,
): Array<{ category: IntegrationProviderDefinition['category']; providers: IntegrationProviderDefinition[] }> {
  const buckets = new Map<
    IntegrationProviderDefinition['category'],
    IntegrationProviderDefinition[]
  >()
  for (const p of providers) {
    const list = buckets.get(p.category) ?? []
    list.push(p)
    buckets.set(p.category, list)
  }
  return INTEGRATION_CATEGORIES.filter((c) => buckets.has(c)).map((category) => ({
    category,
    providers: buckets.get(category) ?? [],
  }))
}

export function oneLineProviderBlurb(description: string, maxLen = 88): string {
  const first = description.split(/(?<=\.)\s+/)[0]?.trim() || description.trim()
  if (first.length <= maxLen) return first
  return `${first.slice(0, maxLen - 1).trimEnd()}…`
}

export function catalogContainsSecretFields(
  catalog: readonly IntegrationProviderDefinition[] = INTEGRATION_PROVIDER_CATALOG,
): string[] {
  const hits: string[] = []
  for (const provider of catalog) {
    const blob = JSON.stringify(provider).toLowerCase()
    for (const key of SECRETISH_KEYS) {
      if (blob.includes(`"${key.toLowerCase()}"`)) {
        hits.push(`${provider.id}:${key}`)
      }
    }
  }
  return hits
}

export function assertCatalogHasNoSecrets(
  catalog: readonly IntegrationProviderDefinition[] = INTEGRATION_PROVIDER_CATALOG,
): void {
  const hits = catalogContainsSecretFields(catalog)
  if (hits.length > 0) {
    throw new Error(`Provider catalog must not store secrets: ${hits.join(', ')}`)
  }
}
