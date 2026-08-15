import { supabase } from './supabase'
import { isAdminDirectoryRole, rejectUnlessRole } from './permissions'

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
}

export interface AgencyProfileInput {
  agencyName: string
  legalName: string
  phone: string
  email: string
  website: string
  address: string
  timezone: string
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

function mapAgency(row: Record<string, unknown>): AgencyProfile {
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
  }
}

export async function fetchAgencyProfile(): Promise<{
  data: AgencyProfile | null
  error: string | null
  missingTable?: boolean
}> {
  const { data, error } = await supabase
    .from('agency_profile')
    .select(
      'id, agency_name, legal_name, logo_url, phone, email, website, address, timezone',
    )
    .limit(1)
    .maybeSingle()

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

  if (!data) return { data: null, error: null }
  return { data: mapAgency(data as Record<string, unknown>), error: null }
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

  const payload = {
    agency_name: agencyName,
    legal_name: input.legalName.trim() || null,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    website: input.website.trim() || null,
    address: input.address.trim() || null,
    timezone: input.timezone.trim() || 'America/New_York',
    updated_at: new Date().toISOString(),
  }

  const existing = await fetchAgencyProfile()
  if (existing.error && existing.missingTable) {
    return {
      data: null,
      error:
        'agency_profile table is not available. Apply migration 20260812220000_agency_profile_and_user_invite_foundation.sql first.',
    }
  }

  if (existing.data?.id) {
    const { data, error } = await supabase
      .from('agency_profile')
      .update(payload)
      .eq('id', existing.data.id)
      .select(
        'id, agency_name, legal_name, logo_url, phone, email, website, address, timezone',
      )
      .single()
    if (error) return { data: null, error: error.message }
    return { data: mapAgency(data as Record<string, unknown>), error: null }
  }

  const { data, error } = await supabase
    .from('agency_profile')
    .insert({ ...payload, singleton_key: true })
    .select(
      'id, agency_name, legal_name, logo_url, phone, email, website, address, timezone',
    )
    .single()

  if (error) return { data: null, error: error.message }
  return { data: mapAgency(data as Record<string, unknown>), error: null }
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

  const profile = await fetchAgencyProfile()
  if (profile.error || !profile.data?.id) {
    return {
      logoUrl: null,
      error:
        profile.error ??
        'Save agency profile first (or apply agency_profile migration).',
    }
  }

  const ext =
    file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `logo/${profile.data.id}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('agency-branding')
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

  const { data: publicData } = supabase.storage.from('agency-branding').getPublicUrl(path)
  const logoUrl = `${publicData.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('agency_profile')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', profile.data.id)

  if (updateError) return { logoUrl: null, error: updateError.message }
  return { logoUrl, error: null }
}
