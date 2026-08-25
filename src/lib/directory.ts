import { supabase } from './supabase'
import {
  deriveCommission,
  normalizeCommissionType,
  type CommissionType,
} from './commission'
import { isAdminDirectoryRole, isOpsMutatorRole, rejectUnlessRole } from './permissions'
import { validateProducerSplitPercentage } from './producerSplitValidation'

export { isAdminDirectoryRole, isOpsMutatorRole } from './permissions'

export const POLICY_STATUSES = [
  'active',
  'pending',
  'expired',
  'cancelled',
  'renewal_due',
] as const

export type PolicyStatusValue = (typeof POLICY_STATUSES)[number]

export function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/** Policy default commission using locked pool math (agency + broker fee). */
export function derivePolicyCommission(
  premium: number,
  agencyCommissionPercentage: number | null,
  producerSplitPercentage: number,
  brokerFee = 0,
  commissionType: CommissionType = 'percentage',
  flatAgencyAmount: number | null = null,
) {
  return deriveCommission({
    commissionType,
    baseAmount: premium,
    agencyCommissionPercentage:
      commissionType === 'percentage' ? agencyCommissionPercentage : null,
    agencyCommissionAmount: commissionType === 'flat' ? flatAgencyAmount : null,
    brokerFee,
    producerSplitPercentage,
  })
}

function err(message: string, table: string, operation: string, details?: unknown) {
  return { error: { message, table, operation, details } }
}

/** Active, non-archived producer names for TEXT dropdowns (directory + Producer-role users). */
export async function fetchActiveProducerNames() {
  const [dirRes, usersRes, roleRes] = await Promise.all([
    supabase
      .from('producers')
      .select('producer_name')
      .is('archived_at', null)
      .eq('status', 'active')
      .order('producer_name', { ascending: true }),
    supabase
      .from('users')
      .select('id, full_name, role, status')
      .is('archived_at', null)
      .eq('status', 'active'),
    supabase.from('user_roles').select('user_id, role').eq('role', 'producer'),
  ])

  if (dirRes.error) return { data: [] as string[], error: dirRes.error }

  const producerUserIds = new Set(
    (roleRes.data ?? [])
      .map((r) => String(r.user_id ?? ''))
      .filter(Boolean),
  )
  const fromUsers = (usersRes.data ?? [])
    .filter((u) => {
      const legacy = String(u.role ?? '')
        .trim()
        .toLowerCase()
      return legacy === 'producer' || producerUserIds.has(String(u.id))
    })
    .map((u) => String(u.full_name ?? '').trim())
    .filter(Boolean)

  const names = [
    ...new Set([
      ...(dirRes.data ?? [])
        .map((r) => String(r.producer_name ?? '').trim())
        .filter(Boolean),
      ...fromUsers,
    ]),
  ].sort((a, b) => a.localeCompare(b))
  return { data: names, error: null }
}

/**
 * Ensure a producers-directory row exists and is linked when Producer role is enabled.
 * When Producer role is removed:
 * - does NOT delete the producer master record
 * - sets linked producer status to inactive (drops from active assignment dropdowns)
 * - keeps users.producer_id for stable historical linkage
 * Never creates a second row for the same person (match by producer_id, then email, then name).
 */
export async function syncProducerDirectoryForUser(input: {
  userId: string
  fullName: string
  email: string
  hasProducerRole: boolean
  userStatus: 'active' | 'inactive'
  defaultSplitPercentage?: number | null
  /**
   * Explicit producers.id from the Users Linked Producer selector.
   * When omitted/empty, auto-resolve by existing producer_id → email → name, then create.
   * Email auto-match always runs before create to prevent silent duplicates.
   */
  preferredProducerId?: string | null
}): Promise<{ producerId: string | null; created: boolean; error: string | null }> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) {
    return { producerId: null, created: false, error: authz.message }
  }

  const userId = input.userId.trim()
  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  if (!userId || !fullName) {
    return { producerId: null, created: false, error: 'User id and full name are required.' }
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, producer_id')
    .eq('id', userId)
    .is('archived_at', null)
    .maybeSingle()

  if (userErr) {
    return { producerId: null, created: false, error: userErr.message }
  }

  let producerId = (userRow?.producer_id as string | null) ?? null

  async function findExistingProducer(): Promise<string | null> {
    if (producerId) {
      const { data } = await supabase
        .from('producers')
        .select('id')
        .eq('id', producerId)
        .is('archived_at', null)
        .maybeSingle()
      if (data?.id) return String(data.id)
    }
    if (email) {
      const { data } = await supabase
        .from('producers')
        .select('id, email, producer_name')
        .is('archived_at', null)
        .ilike('email', email)
        .limit(5)
      const exact = (data ?? []).find(
        (r) => String(r.email ?? '').trim().toLowerCase() === email,
      )
      if (exact?.id) return String(exact.id)
    }
    const { data: byName } = await supabase
      .from('producers')
      .select('id, producer_name')
      .is('archived_at', null)
      .ilike('producer_name', fullName)
      .limit(10)
    const match = (byName ?? []).find(
      (r) => String(r.producer_name ?? '').trim().toLowerCase() === fullName.toLowerCase(),
    )
    return match?.id ? String(match.id) : null
  }

  if (!input.hasProducerRole) {
    const linkedId = producerId ?? (await findExistingProducer())
    if (linkedId) {
      await supabase
        .from('producers')
        .update({ status: 'inactive' })
        .eq('id', linkedId)
        .is('archived_at', null)
      // Keep users.producer_id so historical linkage remains; inactive status drops from dropdowns.
      if (!producerId) {
        await supabase.from('users').update({ producer_id: linkedId }).eq('id', userId)
      }
    }
    return { producerId: linkedId, created: false, error: null }
  }

  // Producer role enabled — prefer explicit selector, then safe auto-match, then create.
  let created = false
  const preferred = (input.preferredProducerId ?? '').trim()

  if (preferred) {
    const { data: preferredRow, error: preferredErr } = await supabase
      .from('producers')
      .select('id')
      .eq('id', preferred)
      .is('archived_at', null)
      .maybeSingle()
    if (preferredErr) {
      return { producerId: null, created: false, error: preferredErr.message }
    }
    if (!preferredRow?.id) {
      return {
        producerId: null,
        created: false,
        error: 'Selected Linked Producer was not found (or is archived).',
      }
    }
    producerId = String(preferredRow.id)
  } else {
    producerId = await findExistingProducer()
  }

  // Never create a duplicate when an email/name/existing link already matches.
  if (!producerId) {
    producerId = await findExistingProducer()
  }

  const splitPayload =
    input.defaultSplitPercentage === undefined
      ? {}
      : {
          default_split_percentage:
            input.defaultSplitPercentage === null ||
            !Number.isFinite(input.defaultSplitPercentage)
              ? null
              : input.defaultSplitPercentage,
        }

  if (producerId) {
    const { error: updErr } = await supabase
      .from('producers')
      .update({
        // Keep existing producer_name to preserve historical TEXT matches when linking by email.
        email: email || null,
        status: input.userStatus === 'active' ? 'active' : 'inactive',
        ...splitPayload,
      })
      .eq('id', producerId)
      .is('archived_at', null)
    if (updErr) {
      return { producerId, created: false, error: updErr.message }
    }
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('producers')
      .insert({
        producer_name: fullName,
        email: email || null,
        status: input.userStatus === 'active' ? 'active' : 'inactive',
        notes: 'Synced from users with Producer role for assignment dropdowns',
        ...splitPayload,
      })
      .select('id')
      .single()
    if (insErr || !inserted?.id) {
      return {
        producerId: null,
        created: false,
        error: insErr?.message ?? 'Failed to create producer directory row.',
      }
    }
    producerId = String(inserted.id)
    created = true
  }

  const { error: linkErr } = await supabase
    .from('users')
    .update({ producer_id: producerId })
    .eq('id', userId)
  if (linkErr) {
    return { producerId, created, error: linkErr.message }
  }

  return { producerId, created, error: null }
}

export type ProducerLinkOption = {
  id: string
  producerName: string
  email: string
  status: string
  defaultSplitPercentage: number | null
}

/** Non-archived producers for Users → Linked Producer selector. */
export async function fetchProducerLinkOptions(): Promise<{
  data: ProducerLinkOption[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('producers')
    .select('id, producer_name, email, status, default_split_percentage')
    .is('archived_at', null)
    .order('producer_name', { ascending: true })

  if (error) {
    return { data: [], error: error.message }
  }

  return {
    data: (data ?? []).map((row) => ({
      id: String(row.id),
      producerName: String(row.producer_name ?? '').trim() || '—',
      email: String(row.email ?? '').trim(),
      status: String(row.status ?? '').trim().toLowerCase() || 'active',
      defaultSplitPercentage:
        row.default_split_percentage === null || row.default_split_percentage === undefined
          ? null
          : Number(row.default_split_percentage),
    })),
    error: null,
  }
}

/**
 * Pick the safest Linked Producer default: existing users.producer_id → email → exact name.
 */
export function suggestProducerLinkId(params: {
  options: ProducerLinkOption[]
  existingProducerId: string | null | undefined
  email: string
  fullName: string
}): { producerId: string | null; reason: 'linked' | 'email' | 'name' | null } {
  const existing = (params.existingProducerId ?? '').trim()
  if (existing && params.options.some((o) => o.id === existing)) {
    return { producerId: existing, reason: 'linked' }
  }

  const email = params.email.trim().toLowerCase()
  if (email) {
    const byEmail = params.options.find((o) => o.email.trim().toLowerCase() === email)
    if (byEmail) return { producerId: byEmail.id, reason: 'email' }
  }

  const name = params.fullName.trim().toLowerCase()
  if (name) {
    const byName = params.options.filter(
      (o) => o.producerName.trim().toLowerCase() === name,
    )
    if (byName.length === 1) return { producerId: byName[0].id, reason: 'name' }
  }

  return { producerId: null, reason: null }
}

/** Active, non-archived CSR names for TEXT dropdowns (directory + CSR-role users). */
export async function fetchActiveCsrNames() {
  const [dirRes, usersRes, roleRes] = await Promise.all([
    supabase
      .from('csrs')
      .select('csr_name')
      .is('archived_at', null)
      .eq('status', 'active')
      .order('csr_name', { ascending: true }),
    supabase
      .from('users')
      .select('id, full_name, role')
      .is('archived_at', null)
      .eq('status', 'active'),
    supabase.from('user_roles').select('user_id, role').eq('role', 'csr'),
  ])

  if (dirRes.error) return { data: [] as string[], error: dirRes.error }

  const csrUserIds = new Set(
    (roleRes.data ?? [])
      .map((r) => String(r.user_id ?? ''))
      .filter(Boolean),
  )
  const fromUsers = (usersRes.data ?? [])
    .filter((u) => {
      const legacy = String(u.role ?? '')
        .trim()
        .toLowerCase()
      return legacy === 'csr' || csrUserIds.has(String(u.id))
    })
    .map((u) => String(u.full_name ?? '').trim())
    .filter(Boolean)

  const names = [
    ...new Set([
      ...(dirRes.data ?? [])
        .map((r) => String(r.csr_name ?? '').trim())
        .filter(Boolean),
      ...fromUsers,
    ]),
  ].sort((a, b) => a.localeCompare(b))
  return { data: names, error: null }
}

export interface CreatePolicyInput {
  clientId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  effectiveDate: string
  expirationDate: string
  status: PolicyStatusValue
  notes?: string
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number | null
  producerSplitPercentage: number
  overrideSplit?: boolean
  /** Optional default broker fee inherited by new transactions (defaults to 0). */
  brokerFee?: number
}

export async function createPolicy(input: CreatePolicyInput) {
  const authz = await rejectUnlessRole(isOpsMutatorRole)
  if (!authz.ok) {
    return err(authz.message, 'policies', 'authorize')
  }
  if (!input.clientId.trim()) {
    return err('Client is required.', 'policies', 'validate')
  }
  if (!input.policyNumber.trim()) {
    return err('Policy number is required.', 'policies', 'validate')
  }

  const commissionType = normalizeCommissionType(input.commissionType)
  if (commissionType === 'percentage') {
    if (
      input.agencyCommissionPercentage === null ||
      !Number.isFinite(input.agencyCommissionPercentage) ||
      input.agencyCommissionPercentage < 0
    ) {
      return err('Agency commission % must be zero or greater.', 'policies', 'validate')
    }
  } else if (
    input.agencyCommissionAmount === null ||
    !Number.isFinite(input.agencyCommissionAmount)
  ) {
    return err('Enter a valid flat agency commission amount.', 'policies', 'validate')
  }

  const brokerFee = input.brokerFee === undefined ? 0 : Number(input.brokerFee)
  if (!Number.isFinite(brokerFee)) {
    return err('Enter a valid default broker fee (0, positive, or negative).', 'policies', 'validate')
  }
  const splitError = validateProducerSplitPercentage(input.producerSplitPercentage)
  if (splitError) {
    return err(splitError, 'policies', 'validate')
  }

  const policyNumber = input.policyNumber.trim()
  const clientId = input.clientId.trim()

  const { data: existing, error: dupError } = await supabase
    .from('policies')
    .select('id')
    .eq('client_id', clientId)
    .eq('policy_number', policyNumber)
    .is('archived_at', null)
    .limit(1)

  if (dupError) {
    return err(dupError.message, 'policies', 'duplicate_check', dupError)
  }
  if (existing && existing.length > 0) {
    return err(
      'A policy with this policy number already exists for this client.',
      'policies',
      'duplicate_check',
    )
  }

  // Money totals live on transactions. Policy stores defaults only — do not invent ledger
  // amounts from a policy premium (premium is no longer collected on create).
  const payload = {
    client_id: clientId,
    policy_number: policyNumber,
    policy_type: input.policyType.trim() || null,
    carrier: input.carrier.trim() || null,
    mga: input.mga.trim() || null,
    producer: input.producer.trim() || null,
    csr: input.csr.trim() || null,
    effective_date: input.effectiveDate.trim() || null,
    expiration_date: input.expirationDate.trim() || null,
    premium: 0,
    status: input.status,
    notes: input.notes?.trim() || null,
    commission_type: commissionType,
    agency_commission_percentage:
      commissionType === 'percentage' ? input.agencyCommissionPercentage : null,
    agency_commission_amount:
      commissionType === 'flat' ? roundMoney(Number(input.agencyCommissionAmount)) : 0,
    broker_fee: roundMoney(brokerFee),
    producer_split_percentage: roundMoney(input.producerSplitPercentage),
    producer_commission_amount: 0,
    agency_net_commission: 0,
    override_split: Boolean(input.overrideSplit),
  }

  const { data, error } = await supabase.from('policies').insert(payload).select('id').single()

  if (error) {
    return err(error.message, 'policies', 'insert', error)
  }

  return { data: { id: data.id as string }, error: null }
}

export interface UpdatePolicyInput {
  policyId: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  effectiveDate: string
  expirationDate: string
  status: PolicyStatusValue
  notes: string
  /**
   * When true, update commission *defaults* (rates / default broker fee / split).
   * Does not rewrite historical transaction snapshots and does not treat policy premium
   * as a ledger total.
   */
  unlockFinancials: boolean
  commissionType?: CommissionType
  agencyCommissionPercentage?: number | null
  agencyCommissionAmount?: number | null
  brokerFee?: number
  producerSplitPercentage?: number
  overrideSplit?: boolean
}

/** True when any linked txn is confirmed, batched, or paid — lock money fields. */
export async function policyHasLockedFinancialHistory(policyId: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, agency_commission_confirmed, payment_batch_id, producer_payment_status, paid_date, archived_at')
    .eq('policy_id', policyId)
    .is('archived_at', null)

  if (error) {
    return { locked: true, error }
  }

  const locked = (data ?? []).some((row) => {
    const payment = String(row.producer_payment_status ?? '').toLowerCase()
    return (
      Boolean(row.agency_commission_confirmed) ||
      Boolean(row.payment_batch_id) ||
      Boolean(row.paid_date) ||
      payment === 'paid'
    )
  })

  return { locked, error: null }
}

export async function updatePolicy(input: UpdatePolicyInput) {
  const authz = await rejectUnlessRole(isOpsMutatorRole)
  if (!authz.ok) {
    return err(authz.message, 'policies', 'authorize')
  }
  if (!input.policyId.trim()) {
    return err('Policy id is required.', 'policies', 'validate')
  }
  if (!input.policyNumber.trim()) {
    return err('Policy number is required.', 'policies', 'validate')
  }

  const { data: current, error: fetchError } = await supabase
    .from('policies')
    .select('id, client_id, policy_number')
    .eq('id', input.policyId)
    .maybeSingle()

  if (fetchError) return err(fetchError.message, 'policies', 'edit_fetch', fetchError)
  if (!current) return err('Policy not found.', 'policies', 'edit_validation')

  const clientId = String(current.client_id ?? '')
  const policyNumber = input.policyNumber.trim()

  if (policyNumber !== String(current.policy_number ?? '')) {
    const { data: existing, error: dupError } = await supabase
      .from('policies')
      .select('id')
      .eq('client_id', clientId)
      .eq('policy_number', policyNumber)
      .is('archived_at', null)
      .neq('id', input.policyId)
      .limit(1)

    if (dupError) return err(dupError.message, 'policies', 'duplicate_check', dupError)
    if (existing && existing.length > 0) {
      return err(
        'A policy with this policy number already exists for this client.',
        'policies',
        'duplicate_check',
      )
    }
  }

  const payload: Record<string, unknown> = {
    policy_number: policyNumber,
    policy_type: input.policyType.trim() || null,
    carrier: input.carrier.trim() || null,
    mga: input.mga.trim() || null,
    producer: input.producer.trim() || null,
    csr: input.csr.trim() || null,
    effective_date: input.effectiveDate.trim() || null,
    expiration_date: input.expirationDate.trim() || null,
    status: input.status,
    notes: input.notes.trim() || null,
  }

  if (input.unlockFinancials) {
    const commissionType = normalizeCommissionType(input.commissionType)
    const brokerFee = Number(input.brokerFee)
    const splitError = validateProducerSplitPercentage(input.producerSplitPercentage)
    if (splitError) {
      return err(splitError, 'policies', 'validate')
    }
    const splitPct = Number(input.producerSplitPercentage)
    if (commissionType === 'percentage') {
      const agencyPct = Number(input.agencyCommissionPercentage)
      if (!Number.isFinite(agencyPct) || agencyPct < 0) {
        return err('Agency commission % must be zero or greater.', 'policies', 'validate')
      }
      payload.agency_commission_percentage = agencyPct
      // Flat amount column is unused for percentage defaults; keep 0 (not a txn ledger total).
      payload.agency_commission_amount = 0
    } else if (
      input.agencyCommissionAmount === null ||
      input.agencyCommissionAmount === undefined ||
      !Number.isFinite(Number(input.agencyCommissionAmount))
    ) {
      return err('Enter a valid flat agency commission amount.', 'policies', 'validate')
    } else {
      payload.agency_commission_percentage = null
      payload.agency_commission_amount = roundMoney(Number(input.agencyCommissionAmount))
    }
    if (!Number.isFinite(brokerFee)) {
      return err('Enter a valid default broker fee.', 'policies', 'validate')
    }
    payload.commission_type = commissionType
    payload.broker_fee = roundMoney(brokerFee)
    payload.producer_split_percentage = roundMoney(splitPct)
    payload.override_split = Boolean(input.overrideSplit)
    // Do not rewrite policies.premium / producer_commission_amount / agency_net_commission —
    // those legacy columns are not the source of truth (transactions are).
  }

  const { data, error } = await supabase
    .from('policies')
    .update(payload)
    .eq('id', input.policyId)
    .select('id')
    .single()

  if (error) return err(error.message, 'policies', 'update', error)
  return { data: { id: data.id as string }, error: null }
}

export async function createProducer(input: {
  producerName: string
  email: string
  phone: string
  status: string
  notes: string
  licenseNumber?: string
  defaultSplitPercentage?: number | null
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'producers', 'authorize')
  if (!input.producerName.trim()) {
    return err('Producer name is required.', 'producers', 'validate')
  }

  const payload: Record<string, unknown> = {
    producer_name: input.producerName.trim(),
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
    status: input.status.trim() || 'active',
    notes: input.notes.trim() || null,
  }
  if (input.licenseNumber !== undefined) {
    payload.license_number = input.licenseNumber.trim() || null
  }
  if (
    input.defaultSplitPercentage !== undefined &&
    input.defaultSplitPercentage !== null &&
    Number.isFinite(input.defaultSplitPercentage)
  ) {
    payload.default_split_percentage = input.defaultSplitPercentage
  }

  const { data, error } = await supabase.from('producers').insert(payload).select('id').single()

  if (error) return err(error.message, 'producers', 'insert', error)
  return { data: { id: data.id as string }, error: null }
}

export async function updateProducer(input: {
  id: string
  email: string
  phone: string
  status: string
  notes: string
  licenseNumber: string
  defaultSplitPercentage: number | null
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'producers', 'authorize')
  if (!input.id.trim()) return err('Producer id is required.', 'producers', 'validate')

  const payload: Record<string, unknown> = {
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
    status: input.status.trim() || 'active',
    notes: input.notes.trim() || null,
    license_number: input.licenseNumber.trim() || null,
    default_split_percentage:
      input.defaultSplitPercentage === null || !Number.isFinite(input.defaultSplitPercentage)
        ? null
        : input.defaultSplitPercentage,
  }

  const { data, error } = await supabase
    .from('producers')
    .update(payload)
    .eq('id', input.id)
    .is('archived_at', null)
    .select('id')
    .single()

  if (error) return err(error.message, 'producers', 'update', error)
  return { data: { id: data.id as string }, error: null }
}

export async function archiveProducer(id: string) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'producers', 'authorize')
  if (!id.trim()) return err('Producer id is required.', 'producers', 'validate')
  const { data, error } = await supabase
    .from('producers')
    .update({ archived_at: new Date().toISOString(), status: 'inactive' })
    .eq('id', id)
    .is('archived_at', null)
    .select('id')
    .single()
  if (error) return err(error.message, 'producers', 'archive', error)
  return { data: { id: data.id as string }, error: null }
}

export async function createCsr(input: {
  csrName: string
  email: string
  phone: string
  status: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'csrs', 'authorize')
  if (!input.csrName.trim()) {
    return err('CSR name is required.', 'csrs', 'validate')
  }

  const { data, error } = await supabase
    .from('csrs')
    .insert({
      csr_name: input.csrName.trim(),
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      status: input.status.trim() || 'active',
      notes: input.notes.trim() || null,
    })
    .select('id')
    .single()

  if (error) return err(error.message, 'csrs', 'insert', error)
  return { data: { id: data.id as string }, error: null }
}

export async function updateCsr(input: {
  id: string
  email: string
  phone: string
  status: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'csrs', 'authorize')
  if (!input.id.trim()) return err('CSR id is required.', 'csrs', 'validate')

  const { data, error } = await supabase
    .from('csrs')
    .update({
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      status: input.status.trim() || 'active',
      notes: input.notes.trim() || null,
    })
    .eq('id', input.id)
    .is('archived_at', null)
    .select('id')
    .single()

  if (error) return err(error.message, 'csrs', 'update', error)
  return { data: { id: data.id as string }, error: null }
}

export async function archiveCsr(id: string) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'csrs', 'authorize')
  if (!id.trim()) return err('CSR id is required.', 'csrs', 'validate')
  const { data, error } = await supabase
    .from('csrs')
    .update({ archived_at: new Date().toISOString(), status: 'inactive' })
    .eq('id', id)
    .is('archived_at', null)
    .select('id')
    .single()
  if (error) return err(error.message, 'csrs', 'archive', error)
  return { data: { id: data.id as string }, error: null }
}

export async function createMga(input: {
  mgaName: string
  contactPerson: string
  email: string
  phone: string
  status: string
  states: string
  linesOfBusiness: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'mgas', 'authorize')
  if (!input.mgaName.trim()) {
    return err('MGA name is required.', 'mgas', 'validate')
  }

  const { data, error } = await supabase
    .from('mgas')
    .insert({
      mga_name: input.mgaName.trim(),
      contact_person: input.contactPerson.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      status: input.status.trim() || 'active',
      states: input.states.trim() || null,
      lines_of_business: input.linesOfBusiness.trim() || null,
      notes: input.notes.trim() || null,
    })
    .select('id')
    .single()

  if (error) return err(error.message, 'mgas', 'insert', error)
  return { data: { id: data.id as string }, error: null }
}

export async function createCarrier(input: {
  carrierName: string
  naic: string
  status: string
  appointmentStatus: string
  billingType: string
  linesOfBusiness: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'carriers', 'authorize')
  if (!input.carrierName.trim()) {
    return err('Carrier name is required.', 'carriers', 'validate')
  }

  const { data, error } = await supabase
    .from('carriers')
    .insert({
      carrier_name: input.carrierName.trim(),
      naic: input.naic.trim() || null,
      status: input.status.trim() || 'active',
      appointment_status: input.appointmentStatus.trim() || null,
      billing_type: input.billingType.trim() || null,
      lines_of_business: input.linesOfBusiness.trim() || null,
      notes: input.notes.trim() || null,
    })
    .select('id')
    .single()

  if (error) return err(error.message, 'carriers', 'insert', error)
  return { data: { id: data.id as string }, error: null }
}

export async function updateMga(input: {
  id: string
  contactPerson: string
  email: string
  phone: string
  status: string
  states: string
  linesOfBusiness: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'mgas', 'authorize')
  if (!input.id.trim()) return err('MGA id is required.', 'mgas', 'validate')

  const { data, error } = await supabase
    .from('mgas')
    .update({
      contact_person: input.contactPerson.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      status: input.status.trim() || 'active',
      states: input.states.trim() || null,
      lines_of_business: input.linesOfBusiness.trim() || null,
      notes: input.notes.trim() || null,
    })
    .eq('id', input.id)
    .is('archived_at', null)
    .select('id')
    .single()

  if (error) return err(error.message, 'mgas', 'update', error)
  return { data: { id: data.id as string }, error: null }
}

export async function archiveMga(id: string) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'mgas', 'authorize')
  if (!id.trim()) return err('MGA id is required.', 'mgas', 'validate')
  const { data, error } = await supabase
    .from('mgas')
    .update({ archived_at: new Date().toISOString(), status: 'inactive' })
    .eq('id', id)
    .is('archived_at', null)
    .select('id')
    .single()
  if (error) return err(error.message, 'mgas', 'archive', error)
  return { data: { id: data.id as string }, error: null }
}

export async function updateCarrier(input: {
  id: string
  naic: string
  status: string
  appointmentStatus: string
  billingType: string
  linesOfBusiness: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'carriers', 'authorize')
  if (!input.id.trim()) return err('Carrier id is required.', 'carriers', 'validate')

  const { data, error } = await supabase
    .from('carriers')
    .update({
      naic: input.naic.trim() || null,
      status: input.status.trim() || 'active',
      appointment_status: input.appointmentStatus.trim() || null,
      billing_type: input.billingType.trim() || null,
      lines_of_business: input.linesOfBusiness.trim() || null,
      notes: input.notes.trim() || null,
    })
    .eq('id', input.id)
    .is('archived_at', null)
    .select('id')
    .single()

  if (error) return err(error.message, 'carriers', 'update', error)
  return { data: { id: data.id as string }, error: null }
}

export async function archiveCarrier(id: string) {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return err(authz.message, 'carriers', 'authorize')
  if (!id.trim()) return err('Carrier id is required.', 'carriers', 'validate')
  const { data, error } = await supabase
    .from('carriers')
    .update({ archived_at: new Date().toISOString(), status: 'inactive' })
    .eq('id', id)
    .is('archived_at', null)
    .select('id')
    .single()
  if (error) return err(error.message, 'carriers', 'archive', error)
  return { data: { id: data.id as string }, error: null }
}

export async function createClient(input: {
  clientNumber: string
  businessName: string
  dba: string
  fein: string
  contactName: string
  email: string
  phone: string
  mailingAddress: string
  physicalAddress: string
  producer: string
  csr: string
  status: string
  renewalMonth: number | null
  renewalDay: number | null
  notes: string
}) {
  const authz = await rejectUnlessRole(isOpsMutatorRole)
  if (!authz.ok) return err(authz.message, 'clients', 'authorize')
  if (!input.businessName.trim()) {
    return err('Business Name is required.', 'clients', 'validate')
  }
  if (!input.clientNumber.trim()) {
    return err('Client number is required.', 'clients', 'validate')
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({
      client_number: input.clientNumber.trim(),
      business_name: input.businessName.trim(),
      dba: input.dba.trim() || null,
      fein: input.fein.trim() || null,
      contact_name: input.contactName.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      mailing_address: input.mailingAddress.trim() || null,
      physical_address: input.physicalAddress.trim() || null,
      producer: input.producer.trim() || null,
      csr: input.csr.trim() || null,
      status: input.status.trim() || 'active',
      renewal_month: input.renewalMonth,
      renewal_day: input.renewalDay,
      notes: input.notes.trim() || null,
    })
    .select('id')
    .single()

  if (error) return err(error.message, 'clients', 'insert', error)
  return { data: { id: data.id as string }, error: null }
}

export async function updateClient(input: {
  id: string
  businessName: string
  dba: string
  fein: string
  contactName: string
  email: string
  phone: string
  mailingAddress: string
  physicalAddress: string
  producer: string
  csr: string
  status: string
  notes: string
}) {
  const authz = await rejectUnlessRole(isOpsMutatorRole)
  if (!authz.ok) return err(authz.message, 'clients', 'authorize')
  if (!input.id.trim()) return err('Client id is required.', 'clients', 'validate')
  if (!input.businessName.trim()) {
    return err('Business Name is required.', 'clients', 'validate')
  }

  const { data, error } = await supabase
    .from('clients')
    .update({
      business_name: input.businessName.trim(),
      dba: input.dba.trim() || null,
      fein: input.fein.trim() || null,
      contact_name: input.contactName.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      mailing_address: input.mailingAddress.trim() || null,
      physical_address: input.physicalAddress.trim() || null,
      producer: input.producer.trim() || null,
      csr: input.csr.trim() || null,
      status: input.status.trim() || 'active',
      notes: input.notes.trim() || null,
    })
    .eq('id', input.id)
    .select('id')
    .single()

  if (error) return err(error.message, 'clients', 'update', error)
  return { data: { id: data.id as string }, error: null }
}
