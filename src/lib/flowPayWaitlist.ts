import { supabase } from './supabase'
import { isAdminDirectoryRole, rejectUnlessRole } from './permissions'

export async function joinFlowPayWaitlist(input: {
  name: string
  workEmail: string
  agencyName: string
}): Promise<{ id: string | null; error: string | null }> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { id: null, error: authz.message }

  const name = input.name.trim()
  const workEmail = input.workEmail.trim()
  const agencyName = input.agencyName.trim()
  if (!name || !workEmail || !agencyName) {
    return { id: null, error: 'Name, work email, and agency name are required.' }
  }
  if (!workEmail.includes('@')) {
    return { id: null, error: 'Enter a valid work email.' }
  }

  const { data, error } = await supabase.rpc('join_flow_pay_waitlist', {
    p_name: name,
    p_work_email: workEmail,
    p_agency_name: agencyName,
  })
  if (error) {
    return { id: null, error: error.message || 'Could not join the Flow Pay waitlist.' }
  }
  const id = typeof data === 'string' ? data : data != null ? String(data) : ''
  return { id: id || null, error: null }
}
