/**
 * Phase 4E storage object paths.
 * Agency ID must be supplied from authenticated membership or a tenant-safe parent row.
 * Never derive agency from singleton / first-agency lookup.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LogoExt = 'png' | 'jpg' | 'webp'
export type SupportingDocEntityType = 'transaction' | 'recovery'

export const AGENCY_BRANDING_BUCKET = 'agency-branding'
export const SUPPORTING_DOCUMENTS_BUCKET = 'supporting-documents'
export const RECONCILIATION_STATEMENTS_BUCKET = 'reconciliation-statements'
export const LOGO_EXTS: LogoExt[] = ['png', 'jpg', 'webp']

export function isAgencyProfileId(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value))
}

export function agencyBrandingLogoPath(agencyProfileId: string, ext: LogoExt): string {
  return `${agencyProfileId}/logo.${ext}`
}

/** Phase 3D compatibility read path. App writes must not use this after 4E. */
export function legacyAgencyBrandingLogoPath(agencyProfileId: string, ext: LogoExt): string {
  return `logo/${agencyProfileId}.${ext}`
}

export function supportingDocumentObjectPath(
  agencyProfileId: string,
  entityType: SupportingDocEntityType,
  entityId: string,
  filename: string,
): string {
  return `${agencyProfileId}/${entityType}/${entityId}/${filename}`
}

export function reconciliationStatementObjectPath(
  agencyProfileId: string,
  statementId: string,
  filename: string,
): string {
  return `${agencyProfileId}/${statementId}/${filename}`
}

export function parseLegacyBrandingLogoPath(
  name: string,
): { agencyProfileId: string; ext: LogoExt } | null {
  const match = name.match(/^logo\/([0-9a-f-]{36})\.(png|jpg|jpeg|webp)$/i)
  if (!match || !isAgencyProfileId(match[1])) return null
  const raw = match[2].toLowerCase()
  const ext: LogoExt = raw === 'jpeg' ? 'jpg' : (raw as LogoExt)
  return { agencyProfileId: match[1], ext }
}

export function parsePrefixedBrandingLogoPath(
  name: string,
): { agencyProfileId: string; ext: LogoExt } | null {
  const match = name.match(/^([0-9a-f-]{36})\/logo\.(png|jpg|jpeg|webp)$/i)
  if (!match || !isAgencyProfileId(match[1])) return null
  const raw = match[2].toLowerCase()
  const ext: LogoExt = raw === 'jpeg' ? 'jpg' : (raw as LogoExt)
  return { agencyProfileId: match[1], ext }
}

export function parseLegacySupportingDocumentPath(name: string): {
  entityType: SupportingDocEntityType
  entityId: string
  rest: string
} | null {
  const match = name.match(/^(transaction|recovery)\/([^/]+)\/(.+)$/)
  if (!match) return null
  return {
    entityType: match[1] as SupportingDocEntityType,
    entityId: match[2],
    rest: match[3],
  }
}

export function parsePrefixedSupportingDocumentPath(name: string): {
  agencyProfileId: string
  entityType: SupportingDocEntityType
  entityId: string
  rest: string
} | null {
  const match = name.match(/^([0-9a-f-]{36})\/(transaction|recovery)\/([^/]+)\/(.+)$/i)
  if (!match || !isAgencyProfileId(match[1])) return null
  return {
    agencyProfileId: match[1],
    entityType: match[2] as SupportingDocEntityType,
    entityId: match[3],
    rest: match[4],
  }
}

export function logoExtFromMime(mime: string): LogoExt | null {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/jpeg') return 'jpg'
  return null
}
