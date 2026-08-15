import { supabase } from './supabase'
import { normalizeAppRole } from './permissions'

export interface ReviewerOption {
  id: string
  fullName: string
  email: string
  role: 'owner' | 'admin'
  label: string
}

/** Active Owner/Admin users eligible as transaction reviewers. */
export async function fetchActiveReviewers(): Promise<{
  data: ReviewerOption[]
  error: { message: string } | null
}> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, status, archived_at')
    .in('role', ['owner', 'admin'])
    .eq('status', 'active')
    .is('archived_at', null)
    .order('full_name')

  if (error) {
    return { data: [], error: { message: error.message } }
  }

  const rows = (data ?? [])
    .map((row) => {
      const role = normalizeAppRole(row.role)
      if (role !== 'owner' && role !== 'admin') return null
      const fullName = String(row.full_name ?? '').trim() || 'Unknown user'
      const email = String(row.email ?? '').trim()
      const roleLabel = role === 'owner' ? 'Owner' : 'Admin'
      return {
        id: String(row.id),
        fullName,
        email,
        role,
        label: `${fullName} · ${roleLabel}`,
      } satisfies ReviewerOption
    })
    .filter((row): row is ReviewerOption => Boolean(row))

  return { data: rows, error: null }
}
