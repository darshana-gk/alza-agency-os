import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { fail } from './http.ts'

export async function authorizeOpsStaff(adminClient: SupabaseClient, authHeader: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user: callerAuth },
    error: callerAuthError,
  } = await callerClient.auth.getUser()

  if (callerAuthError || !callerAuth) {
    return { error: fail('unauthorized', 'Unauthorized.', 401) }
  }

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('users')
    .select('id, full_name, email, role, status, archived_at')
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

  const roles = new Set(
    [String(callerProfile?.role ?? ''), ...(extraRoles ?? []).map((r) => String(r.role ?? ''))]
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  )

  const callerActive =
    callerProfile &&
    !callerProfile.archived_at &&
    String(callerProfile.status ?? '').toLowerCase() === 'active'

  if (!callerActive || !['owner', 'admin', 'csr'].some((r) => roles.has(r))) {
    return {
      error: fail('forbidden', 'Only Owner, Admin, or CSR may run reconciliation.', 403),
    }
  }

  return { callerAuth, callerProfile, roles: [...roles] }
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
