import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { fail } from './http.ts'

export type OpsCallerProfile = {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
  status: string | null
  archived_at: string | null
  agency_profile_id: string | null
}

export type OpsAuthContext = {
  callerAuth: User
  callerProfile: OpsCallerProfile
  profileId: string
  agencyProfileId: string
  roles: string[]
}

function collectRoles(
  primaryRole: string | null | undefined,
  extraRoles: Array<{ role?: string | null }> | null | undefined,
): string[] {
  return [
    ...new Set(
      [String(primaryRole ?? ''), ...(extraRoles ?? []).map((r) => String(r.role ?? ''))]
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}

function isActiveAgencyOpsProfile(
  profile: OpsCallerProfile | null | undefined,
  roles: string[],
): profile is OpsCallerProfile {
  if (!profile?.id) return false
  if (profile.archived_at) return false
  if (String(profile.status ?? '').toLowerCase() !== 'active') return false
  if (roles.includes('alza_support')) return false
  const agencyId = String(profile.agency_profile_id ?? '').trim()
  return Boolean(agencyId)
}

/** Fail closed when a service-role path must stay within the caller's agency workspace. */
export function assertCallerAgencyMatches(
  callerAgencyProfileId: string | null | undefined,
  targetAgencyProfileId: string | null | undefined,
): string | null {
  const caller = String(callerAgencyProfileId ?? '').trim()
  const target = String(targetAgencyProfileId ?? '').trim()
  if (!caller || !target || caller !== target) {
    return 'Agency mismatch — access denied.'
  }
  return null
}

export function callerJwtClient(authHeader: string): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
}

async function authorizeAgencyOpsStaff(
  adminClient: SupabaseClient,
  authHeader: string,
  forbiddenMessage: string,
): Promise<{ context: OpsAuthContext } | { error: Response }> {
  if (!authHeader) {
    return { error: fail('unauthorized', 'Unauthorized.', 401) }
  }

  const callerClient = callerJwtClient(authHeader)
  const {
    data: { user: callerAuth },
    error: callerAuthError,
  } = await callerClient.auth.getUser()

  if (callerAuthError || !callerAuth) {
    return { error: fail('unauthorized', 'Unauthorized.', 401) }
  }

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('users')
    .select('id, full_name, email, role, status, archived_at, agency_profile_id')
    .eq('auth_user_id', callerAuth.id)
    .maybeSingle()

  if (callerProfileError) {
    return {
      error: fail(
        'caller_profile_load_failed',
        `Unable to load caller profile: ${callerProfileError.message}`,
        500,
      ),
    }
  }

  const { data: extraRoles } = await adminClient
    .from('user_roles')
    .select('role')
    .eq('user_id', callerProfile?.id ?? '')

  const roles = collectRoles(callerProfile?.role, extraRoles)

  if (!isActiveAgencyOpsProfile(callerProfile, roles)) {
    return { error: fail('forbidden', forbiddenMessage, 403) }
  }

  return {
    context: {
      callerAuth,
      callerProfile: callerProfile as OpsCallerProfile,
      profileId: String(callerProfile.id),
      agencyProfileId: String(callerProfile.agency_profile_id),
      roles,
    },
  }
}

export async function authorizeOpsStaff(adminClient: SupabaseClient, authHeader: string) {
  const result = await authorizeAgencyOpsStaff(
    adminClient,
    authHeader,
    'Only active Owner, Admin, or CSR with agency membership may run reconciliation.',
  )
  if ('error' in result) return result
  const { context } = result
  if (!['owner', 'admin', 'csr'].some((r) => context.roles.includes(r))) {
    return {
      error: fail('forbidden', 'Only Owner, Admin, or CSR may run reconciliation.', 403),
    }
  }
  return {
    callerAuth: context.callerAuth,
    callerProfile: context.callerProfile,
    profileId: context.profileId,
    agencyProfileId: context.agencyProfileId,
    roles: context.roles,
  }
}

/** Owner/Admin only — agency commission receipt confirmation and similar financial actions. */
export async function authorizeOwnerAdmin(adminClient: SupabaseClient, authHeader: string) {
  const result = await authorizeAgencyOpsStaff(
    adminClient,
    authHeader,
    'Only active Owner or Admin with agency membership may confirm agency commission receipts.',
  )
  if ('error' in result) return result
  const { context } = result
  const roles = new Set(context.roles)
  if (!roles.has('owner') && !roles.has('admin')) {
    return {
      error: fail('forbidden', 'Only Owner or Admin may confirm agency commission receipts.', 403),
    }
  }
  return {
    callerAuth: context.callerAuth,
    callerProfile: context.callerProfile,
    profileId: context.profileId,
    agencyProfileId: context.agencyProfileId,
    roles: context.roles,
  }
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
