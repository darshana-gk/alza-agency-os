import { supabase } from './supabase'

export type AgencyDirectoryRow = {
  id: string
  agency_name: string
  agency_email: string | null
  phone: string | null
  website: string | null
  created_at: string
  owner_user_id: string | null
  owner_name: string | null
  owner_email: string | null
  invite_status: string | null
  owner_status: string | null
  subscription_status: string | null
  user_band_key: string | null
  billing_interval: string | null
  plan_key: string | null
}

export const PROVISION_PLAN_OPTIONS = [
  { value: 'users_1_3', label: '1–3 users' },
  { value: 'users_4_10', label: '4–10' },
  { value: 'users_11_25', label: '11–25' },
  { value: 'users_26_50', label: '26–50' },
  { value: 'users_51_100', label: '51–100' },
  { value: 'users_100_plus', label: '100+ Custom' },
] as const

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('provision-alza-customer', { body })
  const payload = (data ?? {}) as { ok?: boolean; message?: string; code?: string }
  if (error) {
    return { data: null as Record<string, unknown> | null, error: payload.message || error.message }
  }
  if (payload.ok === false) {
    return { data: null as Record<string, unknown> | null, error: payload.message || 'Request failed.' }
  }
  return { data: data as Record<string, unknown>, error: null as string | null }
}

export async function listPlatformAgencies() {
  const result = await invoke({ action: 'list' })
  const agencies = (result.data?.agencies ?? []) as AgencyDirectoryRow[]
  return { data: agencies, error: result.error }
}

export async function createProvisionedCustomer(input: {
  agencyName: string
  agencyEmail: string
  agencyPhone?: string
  website?: string
  ownerFirstName: string
  ownerLastName: string
  ownerEmail: string
  intendedPlan: string
  billingInterval: 'monthly' | 'annual'
}) {
  return invoke({
    action: 'create',
    agency_name: input.agencyName,
    agency_email: input.agencyEmail,
    agency_phone: input.agencyPhone ?? '',
    website: input.website ?? '',
    owner_first_name: input.ownerFirstName,
    owner_last_name: input.ownerLastName,
    owner_email: input.ownerEmail,
    intended_plan: input.intendedPlan,
    billing_interval: input.billingInterval,
  })
}

export async function resendOwnerInvitation(ownerUserId: string) {
  return invoke({ action: 'resend', owner_user_id: ownerUserId })
}

export async function activateManualSubscription(input: {
  agencyId: string
  userBand: string
  billingInterval: 'monthly' | 'annual'
  periodStart: string
  periodEnd: string
  externalReference?: string
}) {
  return invoke({
    action: 'activate',
    agency_id: input.agencyId,
    user_band: input.userBand,
    billing_interval: input.billingInterval,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    external_reference: input.externalReference ?? '',
  })
}
