/**
 * Canonical ALZA routing + durable external identifiers.
 * AMS/CRM connectors must reuse existing Clients/Policies/Carriers/MGAs/Producers/CSRs —
 * never AMS-specific copies of those entities.
 */

export const ALZA_CANONICAL_ENTITIES = [
  'clients',
  'policies',
  'carriers',
  'mgas',
  'producers',
  'csrs',
] as const

export type AlzaCanonicalEntity = (typeof ALZA_CANONICAL_ENTITIES)[number]

/**
 * Durable source ↔ ALZA identity map for incremental sync and dedupe.
 * Do not rely on names alone for ongoing synchronization.
 */
export type ExternalIdentityMapping = {
  agencyId: string
  providerId: string
  entityType: AlzaCanonicalEntity
  externalId: string
  alzaId: string
  externalSecondaryIds?: Record<string, string>
  lastSeenAt: string
  createdAt: string
}

export type CanonicalRoutingRule = {
  entityType: AlzaCanonicalEntity
  /** Reuse Onboarding V1 validation/dedupe principles (existing directory + import paths). */
  reuseOnboardingPrinciples: true
  /** Forbidden: vendor-specific shadow tables of the same business entity. */
  forbidVendorShadowCopies: true
}

export const CANONICAL_ROUTING_RULES: readonly CanonicalRoutingRule[] =
  ALZA_CANONICAL_ENTITIES.map((entityType) => ({
    entityType,
    reuseOnboardingPrinciples: true as const,
    forbidVendorShadowCopies: true as const,
  }))

export function buildExternalIdentityKey(input: {
  agencyId: string
  providerId: string
  entityType: AlzaCanonicalEntity
  externalId: string
}): string {
  return [
    input.agencyId.trim(),
    input.providerId.trim(),
    input.entityType,
    input.externalId.trim(),
  ].join('::')
}

export function assertExternalIdMappingContract(mapping: ExternalIdentityMapping): string[] {
  const errors: string[] = []
  if (!mapping.agencyId?.trim()) errors.push('agencyId required')
  if (!mapping.providerId?.trim()) errors.push('providerId required')
  if (!ALZA_CANONICAL_ENTITIES.includes(mapping.entityType)) {
    errors.push('entityType invalid')
  }
  if (!mapping.externalId?.trim()) errors.push('externalId required')
  if (!mapping.alzaId?.trim()) errors.push('alzaId required')
  return errors
}
