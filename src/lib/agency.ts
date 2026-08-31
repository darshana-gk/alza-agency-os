import { supabase } from './supabase'
import { isAdminDirectoryRole, rejectUnlessRole } from './permissions'
import {
  isProducerPayoutSchedule,
  type ProducerPayoutSchedule,
} from './producerPayoutSchedule'
import {
  AGENCY_BRANDING_BUCKET,
  LOGO_EXTS,
  agencyBrandingLogoPath,
  logoExtFromMime,
  type LogoExt,
} from './storagePaths'

export interface AgencyProfile {
  id: string
  agencyName: string
  legalName: string
  logoUrl: string | null
  phone: string
  email: string
  website: string
  address: string
  timezone: string
  producerPayoutSchedule: ProducerPayoutSchedule | null
  producerPayoutScheduleNotes: string
  producerPayoutAnchorDate: string | null
}

export interface AgencyProfileInput {
  agencyName: string
  legalName: string
  phone: string
  email: string
  website: string
  address: string
  timezone: string
  producerPayoutSchedule?: ProducerPayoutSchedule | '' | null
  producerPayoutScheduleNotes?: string
  producerPayoutAnchorDate?: string | null
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

const AGENCY_SELECT_WITH_SCHEDULE = `
      id, agency_name, legal_name, logo_url, phone, email, website, address, timezone,
      producer_payout_schedule, producer_payout_schedule_notes, producer_payout_anchor_date
    `

const AGENCY_SELECT_LEGACY =
  'id, agency_name, legal_name, logo_url, phone, email, website, address, timezone'

function isMissingColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  const msg = (error.message ?? '').toLowerCase()
  const code = error.code ?? ''
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    msg.includes('producer_payout_schedule')
  )
}

function mapAgency(row: Record<string, unknown>): AgencyProfile {
  const scheduleRaw = String(row.producer_payout_schedule ?? '').trim()
  return {
    id: String(row.id ?? ''),
    agencyName: String(row.agency_name ?? '').trim() || 'Agency Workspace',
    legalName: String(row.legal_name ?? '').trim(),
    logoUrl: (row.logo_url as string | null) ?? null,
    phone: String(row.phone ?? '').trim(),
    email: String(row.email ?? '').trim(),
    website: String(row.website ?? '').trim(),
    address: String(row.address ?? '').trim(),
    timezone: String(row.timezone ?? '').trim() || 'America/New_York',
    producerPayoutSchedule: isProducerPayoutSchedule(scheduleRaw) ? scheduleRaw : null,
    producerPayoutScheduleNotes: String(row.producer_payout_schedule_notes ?? '').trim(),
    producerPayoutAnchorDate: (row.producer_payout_anchor_date as string | null) ?? null,
  }
}

/** Resolve the authenticated user's agency from membership (never LIMIT 1 / singleton). */
export async function resolveCurrentAgencyProfileId(): Promise<{
  agencyProfileId: string | null
  error: string | null
}> {
  const { data, error } = await supabase.rpc('current_user_agency_profile_id')
  if (error) {
    return { agencyProfileId: null, error: error.message }
  }
  const id = data == null || data === '' ? null : String(data)
  return { agencyProfileId: id, error: null }
}

async function fetchAgencyProfileById(agencyProfileId: string): Promise<{
  data: AgencyProfile | null
  error: string | null
  missingTable?: boolean
}> {
  const first = await supabase
    .from('agency_profile')
    .select(AGENCY_SELECT_WITH_SCHEDULE)
    .eq('id', agencyProfileId)
    .maybeSingle()

  let data: unknown = first.data
  let error = first.error

  if (error && isMissingColumnError(error)) {
    const retry = await supabase
      .from('agency_profile')
      .select(AGENCY_SELECT_LEGACY)
      .eq('id', agencyProfileId)
      .maybeSingle()
    data = retry.data
    error = retry.error
  }

  if (error) {
    const missing =
      error.message.toLowerCase().includes('agency_profile') ||
      error.code === '42P01' ||
      error.code === 'PGRST205'
    return {
      data: null,
      error: error.message,
      missingTable: missing,
    }
  }

  if (!data) {
    return {
      data: null,
      error: 'Agency profile was not found for your membership.',
    }
  }
  return { data: mapAgency(data as Record<string, unknown>), error: null }
}

export async function fetchAgencyProfile(): Promise<{
  data: AgencyProfile | null
  error: string | null
  missingTable?: boolean
}> {
  const { agencyProfileId, error: resolveError } = await resolveCurrentAgencyProfileId()
  if (resolveError) {
    return { data: null, error: resolveError }
  }
  if (!agencyProfileId) {
    return {
      data: null,
      error: 'Agency membership is required to load agency profile.',
    }
  }
  return fetchAgencyProfileById(agencyProfileId)
}

export async function saveAgencyProfile(input: AgencyProfileInput): Promise<{
  data: AgencyProfile | null
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { data: null, error: authz.message }

  const agencyName = input.agencyName.trim()
  if (!agencyName) {
    return { data: null, error: 'Agency display name is required.' }
  }

  const { agencyProfileId, error: resolveError } = await resolveCurrentAgencyProfileId()
  if (resolveError) return { data: null, error: resolveError }
  if (!agencyProfileId) {
    return {
      data: null,
      error: 'Agency membership is required to save agency profile.',
    }
  }

  const identityPayload = {
    agency_name: agencyName,
    legal_name: input.legalName.trim() || null,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    website: input.website.trim() || null,
    address: input.address.trim() || null,
    timezone: input.timezone.trim() || 'America/New_York',
    updated_at: new Date().toISOString(),
  }

  const scheduleRaw = (input.producerPayoutSchedule ?? '').trim()
  const schedulePayload = {
    producer_payout_schedule: isProducerPayoutSchedule(scheduleRaw) ? scheduleRaw : null,
    producer_payout_schedule_notes: input.producerPayoutScheduleNotes?.trim() || null,
    producer_payout_anchor_date: input.producerPayoutAnchorDate?.trim() || null,
  }
  const payload = { ...identityPayload, ...schedulePayload }

  async function persist(rowPayload: Record<string, unknown>, select: string) {
    return supabase
      .from('agency_profile')
      .update(rowPayload)
      .eq('id', agencyProfileId)
      .select(select)
      .single()
  }

  let result = await persist(payload, AGENCY_SELECT_WITH_SCHEDULE)
  if (result.error && isMissingColumnError(result.error)) {
    result = await persist(identityPayload, AGENCY_SELECT_LEGACY)
  }
  if (result.error) {
    const missing =
      result.error.message.toLowerCase().includes('agency_profile') ||
      result.error.code === '42P01' ||
      result.error.code === 'PGRST205'
    if (missing) {
      return {
        data: null,
        error:
          'agency_profile table is not available. Apply migration 20260812220000_agency_profile_and_user_invite_foundation.sql first.',
      }
    }
    return { data: null, error: result.error.message }
  }
  if (!result.data) return { data: null, error: 'Agency profile save returned no row.' }
  return { data: mapAgency(result.data as unknown as Record<string, unknown>), error: null }
}

export async function uploadAgencyLogo(file: File): Promise<{
  logoUrl: string | null
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { logoUrl: null, error: authz.message }

  if (!LOGO_MIME.has(file.type)) {
    return { logoUrl: null, error: 'Logo must be PNG, JPG, or WebP.' }
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { logoUrl: null, error: 'Logo must be 2 MB or smaller.' }
  }

  const { agencyProfileId, error: resolveError } = await resolveCurrentAgencyProfileId()
  if (resolveError) return { logoUrl: null, error: resolveError }
  if (!agencyProfileId) {
    return {
      logoUrl: null,
      error: 'Agency membership is required before uploading a logo.',
    }
  }

  const ext = logoExtFromMime(file.type)
  if (!ext) {
    return { logoUrl: null, error: 'Logo must be PNG, JPG, or WebP.' }
  }
  const path = agencyBrandingLogoPath(agencyProfileId, ext)

  const { error: uploadError } = await supabase.storage
    .from(AGENCY_BRANDING_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) {
    return {
      logoUrl: null,
      error:
        uploadError.message.includes('Bucket not found') ||
        uploadError.message.toLowerCase().includes('not found')
          ? 'Storage bucket agency-branding is not available. Apply the agency profile migration first.'
          : uploadError.message,
    }
  }

  const stale = LOGO_EXTS.filter((other: LogoExt) => other !== ext).map((other) =>
    agencyBrandingLogoPath(agencyProfileId, other),
  )
  if (stale.length) {
    await supabase.storage.from(AGENCY_BRANDING_BUCKET).remove(stale)
  }

  const { data: publicData } = supabase.storage.from(AGENCY_BRANDING_BUCKET).getPublicUrl(path)
  const logoUrl = `${publicData.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('agency_profile')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', agencyProfileId)

  if (updateError) return { logoUrl: null, error: updateError.message }
  return { logoUrl, error: null }
}
