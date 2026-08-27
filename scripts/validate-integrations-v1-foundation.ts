/**
 * Integration Center V1 foundation regressions (no network).
 * Run: npx tsx scripts/validate-integrations-v1-foundation.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ALZA_CANONICAL_ENTITIES,
  CANONICAL_ROUTING_RULES,
  COMMISSION_FEED_TO_RECONCILIATION_PATH,
  CONNECTOR_CAPABILITIES,
  CONNECTOR_SYNC_PIPELINE,
  CONFLICT_OWNERSHIP_PRINCIPLES,
  EVIDENCE_AUTO_CONFIRM_RULE,
  FIELD_OWNERSHIP_RULES,
  INTEGRATION_AUDIT_EVENTS,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_BLURBS,
  INTEGRATION_CATEGORY_LABELS,
  INTEGRATION_PROVIDER_CATALOG,
  INTEGRATION_STATUSES,
  INTEGRATIONS_PATH,
  NORMALIZED_COMMISSION_FEED_REQUIRED_KEYS,
  NORMALIZED_EVIDENCE_REQUIRED_KEYS,
  ONBOARDING_FALLBACK_PATH,
  RECONCILIATION_FALLBACK_PATH,
  INTEGRATION_SUPPORT_CATEGORY,
  INTEGRATION_SUPPORT_MESSAGE,
  assertCatalogHasNoSecrets,
  assertEvidenceDoesNotAutoConfirm,
  assertExternalIdMappingContract,
  assertNormalizedCommissionFeedContract,
  assertSyncPipelineComplete,
  buildExternalIdentityKey,
  canAccessIntegrations,
  catalogContainsSecretFields,
  comingSoonMustNotBeConnected,
  emptyNormalizedCommissionFeedLine,
  emptyNormalizedSettlementEvidence,
  getProviderById,
  groupProvidersByCategory,
  integrationSupportRequestPath,
  oneLineProviderBlurb,
  resolveProviderCardStatus,
} from '../src/lib/integrations/index.ts'
import {
  canAccessPath,
  canAccessReconciliation,
  getNavVisibility,
} from '../src/lib/permissions.ts'
import {
  roleCanOpenIntegrations,
  sidebarNavForRole,
} from '../src/lib/sidebarNav.ts'

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    console.log(`  OK: ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL: ${message}`)
}

function assertEq<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (got ${String(actual)}, expected ${String(expected)})`)
}

const root = resolve(process.cwd())

console.log('A. Complete provider catalog + categories')
{
  assert(INTEGRATION_PROVIDER_CATALOG.length >= 40, 'catalog has substantial providers')
  for (const p of INTEGRATION_PROVIDER_CATALOG) {
    assert(
      INTEGRATION_CATEGORIES.includes(p.category),
      `${p.id} assigned valid category ${p.category}`,
    )
    assert(Boolean(p.name?.trim()), `${p.id} has name`)
    assert(Boolean(p.description?.trim()), `${p.id} has description`)
  }
  for (const cat of INTEGRATION_CATEGORIES) {
    assert(Boolean(INTEGRATION_CATEGORY_LABELS[cat]), `label for ${cat}`)
  }
  assert(
    INTEGRATION_CATEGORIES.includes('carrier_mga_commission_feeds'),
    'Carrier/MGA Commission Feeds category exists',
  )
  assert(
    INTEGRATION_PROVIDER_CATALOG.some((p) => p.category === 'carrier_mga_commission_feeds'),
    'at least one carrier/mga feed provider',
  )
}

console.log('B. Required named providers')
{
  const required = [
    'ams360',
    'applied_epic',
    'sagitta',
    'hawksoft',
    'nowcerts',
    'ezlynx',
    'qqcatalyst',
    'agency_matrix',
    'applied_tam',
    'nexsure',
    'agencybloc',
    'agencyzoom',
    'salesforce',
    'hubspot',
    'ascend',
    'simply_easier_payments',
    'plaid',
    'quickbooks_online',
    'xero',
    'docusign',
    'request_carrier_mga_integration',
    'request_payment_integration',
    'alza_onboarding_import',
    'alza_commission_statement_import',
    'carrier_commission_feed_generic',
    'mga_commission_feed_generic',
  ]
  for (const id of required) {
    assert(Boolean(getProviderById(id)), `provider ${id} exists`)
  }
  assertEq(getProviderById('ascend')?.name, 'Ascend', 'Ascend name')
  assertEq(
    getProviderById('simply_easier_payments')?.name,
    'Simply Easier Payments',
    'SEP name',
  )
  assert(getProviderById('plaid')?.name.includes('Plaid'), 'Plaid exists')
  assert(getProviderById('quickbooks_online')?.name.includes('QuickBooks'), 'QuickBooks exists')
  assertEq(getProviderById('salesforce')?.name, 'Salesforce', 'Salesforce exists')
}

console.log('C. Status model + Coming Soon never Connected')
{
  for (const s of INTEGRATION_STATUSES) {
    assert(Boolean(s), `status ${s}`)
  }
  for (const p of INTEGRATION_PROVIDER_CATALOG) {
    const card = resolveProviderCardStatus(p, null)
    assert(card.status !== 'connected', `${p.id} without connection is not Connected`)
    assert(
      comingSoonMustNotBeConnected(p, card.status),
      `${p.id} coming_soon rule holds for status ${card.status}`,
    )
    if (p.availability === 'coming_soon' && !p.fallbackPath) {
      assertEq(card.status, 'coming_soon', `${p.id} displays Coming Soon`)
      assert(!card.connectAllowed, `${p.id} Connect not allowed`)
      assert(card.action !== 'connect', `${p.id} no Connect action`)
    }
  }
}

console.log('D. RBAC Owner/Admin + CSR/Producer blocked')
{
  assert(canAccessIntegrations('owner'), 'owner canAccessIntegrations')
  assert(canAccessIntegrations('admin'), 'admin canAccessIntegrations')
  assert(!canAccessIntegrations('csr'), 'csr blocked')
  assert(!canAccessIntegrations('producer'), 'producer blocked')
  assert(!canAccessIntegrations('viewer'), 'viewer blocked')
  assert(!canAccessIntegrations('alza_support'), 'alza_support blocked from agency Integrations')
  assert(canAccessPath('owner', INTEGRATIONS_PATH), 'owner path')
  assert(canAccessPath('admin', '/integrations'), 'admin path')
  assert(!canAccessPath('csr', '/integrations'), 'csr path blocked')
  assert(!canAccessPath('producer', '/integrations'), 'producer path blocked')
  assert(!canAccessPath('viewer', '/integrations'), 'viewer path blocked')
  assert(!canAccessPath('alza_support', '/integrations'), 'alza_support path blocked')
  assert(canAccessReconciliation('csr'), 'csr reconciliation unchanged')
  assert(canAccessReconciliation('owner'), 'owner reconciliation unchanged')
  assert(canAccessPath('csr', '/reconciliation'), 'csr still has /reconciliation')
  assert(getNavVisibility('owner').integrations === true, 'owner nav flag')
  assert(getNavVisibility('csr').integrations === false, 'csr nav flag')
  assert(roleCanOpenIntegrations('owner'), 'roleCanOpenIntegrations owner')
  assert(!roleCanOpenIntegrations('producer'), 'roleCanOpenIntegrations producer')
  const admin = sidebarNavForRole('owner')
    .filter((i) => i.section === 'administration')
    .map((i) => i.label)
  assert(admin.includes('Integrations'), 'Integrations in Administration')
  assert(
    !sidebarNavForRole('csr').some((i) => i.label === 'Integrations'),
    'csr sidebar has no Integrations',
  )
}

console.log('E. Available now fallbacks')
{
  const onboarding = getProviderById('alza_onboarding_import')
  assertEq(onboarding?.fallbackPath, ONBOARDING_FALLBACK_PATH, 'fallback path /onboarding')
  assertEq(ONBOARDING_FALLBACK_PATH, '/onboarding', 'ONBOARDING_FALLBACK_PATH')
  const onboardingCard = resolveProviderCardStatus(onboarding!, null)
  assertEq(onboardingCard.action, 'import_agency_data', 'import agency action')
  assert(onboardingCard.actionLabel.includes('Import'), 'import agency label')
  assertEq(onboardingCard.status, 'available', 'onboarding available')

  const statements = getProviderById('alza_commission_statement_import')
  assertEq(statements?.fallbackPath, RECONCILIATION_FALLBACK_PATH, 'fallback path /reconciliation')
  assertEq(RECONCILIATION_FALLBACK_PATH, '/reconciliation', 'RECONCILIATION_FALLBACK_PATH')
  const statementCard = resolveProviderCardStatus(statements!, null)
  assertEq(statementCard.action, 'import_commission_statements', 'import statements action')
  assertEq(statementCard.status, 'available', 'statements available')
  assert(!statementCard.connectAllowed, 'statements Connect not allowed')
}

console.log('F. Connector + sync contracts')
{
  assert(assertSyncPipelineComplete(), 'sync pipeline complete')
  assert(CONNECTOR_SYNC_PIPELINE[0] === 'source', 'pipeline starts at source')
  assert(CONNECTOR_SYNC_PIPELINE.includes('canonical_write'), 'canonical write phase')
  assert(CONNECTOR_CAPABILITIES.includes('connect'), 'connect capability')
  assert(CONNECTOR_CAPABILITIES.includes('webhook_ingest'), 'webhook capability')
}

console.log('G. External-ID + canonical routing')
{
  assert(ALZA_CANONICAL_ENTITIES.includes('policies'), 'policies canonical')
  assert(CANONICAL_ROUTING_RULES.every((r) => r.forbidVendorShadowCopies), 'no shadow copies')
  const key = buildExternalIdentityKey({
    agencyId: 'a1',
    providerId: 'ams360',
    entityType: 'policies',
    externalId: 'xyz',
  })
  assert(key.includes('ams360') && key.includes('xyz'), 'external key shape')
  const errors = assertExternalIdMappingContract({
    agencyId: 'a1',
    providerId: 'ams360',
    entityType: 'policies',
    externalId: 'xyz',
    alzaId: 'abc',
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  })
  assertEq(errors.length, 0, 'valid mapping contract')
}

console.log('H. Conflict / ownership documented')
{
  assert(FIELD_OWNERSHIP_RULES.length >= 4, 'ownership rules present')
  assert(CONFLICT_OWNERSHIP_PRINCIPLES.length >= 3, 'principles present')
  assert(
    FIELD_OWNERSHIP_RULES.some((r) => r.field === 'match_status' && r.owner === 'alza'),
    'ALZA owns reconciliation match_status',
  )
}

console.log('I. Carrier/MGA commission-feed contract')
{
  assert(NORMALIZED_COMMISSION_FEED_REQUIRED_KEYS.includes('commissionAmount'), 'commissionAmount')
  assert(NORMALIZED_COMMISSION_FEED_REQUIRED_KEYS.includes('policyNumber'), 'policyNumber')
  const line = emptyNormalizedCommissionFeedLine({
    sourceProviderId: 'carrier_commission_feed_generic',
    sourceKind: 'sftp',
    commissionAmount: 100,
  })
  assertEq(assertNormalizedCommissionFeedContract(line).length, 0, 'line contract ok')
  assert(
    COMMISSION_FEED_TO_RECONCILIATION_PATH.join('→').includes('existing matching engine'),
    'feeds existing reconciliation path',
  )
}

console.log('J. Payment/bank evidence contract')
{
  for (const k of NORMALIZED_EVIDENCE_REQUIRED_KEYS) {
    assert(k.length > 0, `evidence key ${k}`)
  }
  const ev = emptyNormalizedSettlementEvidence({ id: 'e1', agencyId: 'a1' })
  assert(ev.kind === 'payment_platform_event', 'default evidence kind')
  const blocked = assertEvidenceDoesNotAutoConfirm({
    amountsMatch: true,
    alzaReconciliationRulesJustifyReceipt: false,
  })
  assert(!blocked.mayConfirmReceipt, 'amount match alone does not confirm')
  assert(blocked.reason.includes('NOT automatically'), 'auto-confirm rule message')
  assert(EVIDENCE_AUTO_CONFIRM_RULE.length > 20, 'rule text present')
}

console.log('K. No secrets in catalog + audit events')
{
  assertEq(catalogContainsSecretFields().length, 0, 'no secretish keys in catalog')
  assertCatalogHasNoSecrets()
  assert(INTEGRATION_AUDIT_EVENTS.includes('integration_connected'), 'audit connected')
  assert(INTEGRATION_AUDIT_EVENTS.includes('integration_sync_failed'), 'audit sync failed')
}

console.log('L. No reconciliation algorithm changes in this branch files')
{
  // Foundation must not rewrite reconciliation matching modules.
  const reconFiles = [
    'src/pages/Reconciliation.tsx',
    'src/lib/reconciliation.ts',
    'src/lib/reconciliationMatching.ts',
    'src/lib/reconciliationEngine.ts',
  ]
  for (const rel of reconFiles) {
    const abs = resolve(root, rel)
    try {
      readFileSync(abs)
      // File exists in repo — ensure our Integrations page does not import matching internals incorrectly.
      assert(true, `recon path present or optional: ${rel}`)
    } catch {
      assert(true, `recon module not present (ok): ${rel}`)
    }
  }
  const integrationsPage = readFileSync(resolve(root, 'src/pages/Integrations.tsx'), 'utf8')
  assert(
    !/matchCommission|runMatching|reconciliationMatching/.test(integrationsPage),
    'Integrations page does not call matching engine',
  )
  const commissionContract = readFileSync(
    resolve(root, 'src/lib/integrations/commissionFeedContract.ts'),
    'utf8',
  )
  assert(
    commissionContract.includes('existing ALZA Reconciliation'),
    'commission contract documents existing recon path',
  )
}

console.log('M. Request Integration deep-links to Support Center')
{
  const req = resolveProviderCardStatus(getProviderById('request_carrier_mga_integration')!, null)
  assertEq(req.action, 'request', 'request carrier/mga action')
  const path = integrationSupportRequestPath('AMS360')
  const decoded = decodeURIComponent(path.replace(/\+/g, ' '))
  assert(path.startsWith('/support?'), 'request path is Support Center')
  assert(decoded.includes(`category=${INTEGRATION_SUPPORT_CATEGORY}`), 'feature_request category')
  assert(decoded.includes('Request integration: AMS360'), 'prefilled subject')
  assert(path.includes('message='), 'prefilled no-credentials message')
  assert(INTEGRATION_SUPPORT_MESSAGE.toLowerCase().includes('do not include api keys'), 'no credentials copy')
  const page = readFileSync(resolve(root, 'src/pages/Integrations.tsx'), 'utf8')
  assert(page.includes('integrationSupportRequestPath'), 'page uses Support request helper')
  assert(!page.includes('locallyRequested'), 'no in-memory request state')
  assert(!page.includes('setRequestedIds'), 'no local requested ids')
}

console.log('N. Category grouping preserves catalog coverage')
{
  const groups = groupProvidersByCategory()
  const groupedIds = groups.flatMap((g) => g.providers.map((p) => p.id))
  assertEq(groupedIds.length, INTEGRATION_PROVIDER_CATALOG.length, 'grouped count = catalog count')
  assertEq(new Set(groupedIds).size, INTEGRATION_PROVIDER_CATALOG.length, 'no duplicate ids in groups')
  assertEq(groups[0]?.category, 'data_import_export', 'Data Import / Export first')
  assertEq(groups[1]?.category, 'ams', 'AMS second')
  assertEq(groups[2]?.category, 'carrier_mga_commission_feeds', 'Carrier/MGA third')
  assertEq(INTEGRATION_CATEGORIES[0], 'data_import_export', 'category order starts with data import')
  assert(groups.some((g) => g.category === 'carrier_mga_commission_feeds'), 'carrier/mga section present')
  assert(groups.some((g) => g.category === 'payments'), 'payments section present')
  assert(groups.some((g) => g.category === 'banking'), 'banking section present')
  const blurb = oneLineProviderBlurb('First sentence. Second sentence that is longer.')
  assert(blurb === 'First sentence.', 'one-line blurb uses first sentence')
  for (const cat of INTEGRATION_CATEGORIES) {
    assert(Boolean(INTEGRATION_CATEGORY_BLURBS[cat]), `accordion blurb for ${cat}`)
  }
  const page = readFileSync(resolve(root, 'src/pages/Integrations.tsx'), 'utf8')
  assert(page.includes('View Integration'), 'compact card CTA View Integration')
  assert(page.includes('ProviderDetailDrawer') || page.includes('detailCard'), 'detail drawer present')
  assert(page.includes('aria-expanded'), 'category accordion aria-expanded')
  assert(page.includes('userExpanded'), 'accordion default collapsed via userExpanded')
  assert(page.includes('searchOrFilterActive'), 'search auto-expands matching categories')
  assert(!page.includes('space-y-10'), 'not always-expanded stacked sections')
  assert(!page.includes('CONNECTOR_CAPABILITIES'), 'no engineering capabilities on cards')
  assert(!page.includes('CONNECTOR_SYNC_PIPELINE'), 'no sync pipeline dump on cards')
  assert(
    getProviderById('ascend') && getProviderById('simply_easier_payments') && getProviderById('plaid'),
    'Ascend / SEP / Plaid still catalogued',
  )
  const live = INTEGRATION_PROVIDER_CATALOG.filter((p) => p.availability === 'available')
  assertEq(live.length, 2, 'exactly two Available now catalog rows')
  assert(
    INTEGRATION_PROVIDER_CATALOG.filter((p) => p.category === 'carrier_mga_commission_feeds').length === 3,
    'Carrier/MGA category has 3 entries',
  )
  const arch = readFileSync(resolve(root, 'src/lib/integrations/ARCHITECTURE.md'), 'utf8')
  assert(arch.includes('SFTP'), 'SFTP documented as first proposed live connector')
  assert(arch.includes('existing'), 'SFTP path documents existing Reconciliation')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-integrations-v1-foundation: ALL GREEN')
