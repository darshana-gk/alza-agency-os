/**
 * Agency-scoped Policy File number uniqueness.
 *
 * Applies to the current Policy File number only (policies.policy_number).
 * Historical transaction snapshots on the same file are not uniqueness keys
 * and are never rewritten by this check.
 * Other agencies may reuse the same number.
 */

import { supabase } from './supabase'

export type PolicyFileNumberOwner = {
  policyId: string
  policyNumber: string
  clientId: string
  clientName: string
}

export type PolicyNumberUniquenessMode = 'create' | 'rewrite' | 'renew' | 'edit'

/** Matches the live unique index: lower(btrim(policy_number)). */
export function normalizePolicyFileNumber(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function policyFileNumbersMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizePolicyFileNumber(left)
  const b = normalizePolicyFileNumber(right)
  return Boolean(a) && Boolean(b) && a === b
}

/**
 * Create and rewrite always check. Renew / edit only check when the Policy File
 * number is changing. Same-file historical snapshots are out of scope.
 */
export function shouldEnforceAgencyPolicyNumberUniqueness(input: {
  mode: PolicyNumberUniquenessMode
  currentPolicyNumber?: string | null
  nextPolicyNumber: string
}): boolean {
  if (!normalizePolicyFileNumber(input.nextPolicyNumber)) return false
  if (input.mode === 'create' || input.mode === 'rewrite') return true
  return !policyFileNumbersMatch(input.currentPolicyNumber, input.nextPolicyNumber)
}

export function findConflictingPolicyFileNumber(
  files: PolicyFileNumberOwner[],
  candidate: string,
  options?: { excludePolicyId?: string | null },
): PolicyFileNumberOwner | null {
  const wanted = normalizePolicyFileNumber(candidate)
  if (!wanted) return null
  const exclude = String(options?.excludePolicyId ?? '').trim()
  return (
    files.find((file) => {
      if (exclude && file.policyId === exclude) return false
      return policyFileNumbersMatch(file.policyNumber, wanted)
    }) ?? null
  )
}

export function formatPolicyNumberInUseMessage(owner: PolicyFileNumberOwner): string {
  const number = owner.policyNumber.trim() || 'this number'
  const client = owner.clientName.trim()
  if (client) {
    return `This policy number is already used by ${client} — ${number}. Choose a different Policy File number.`
  }
  return `This policy number is already used by another Policy File (${number}). Choose a different number.`
}

function clientNameFromEmbed(clients: unknown): string {
  if (Array.isArray(clients)) {
    const first = clients[0] as { business_name?: string | null } | undefined
    return String(first?.business_name ?? '').trim()
  }
  if (clients && typeof clients === 'object') {
    return String((clients as { business_name?: string | null }).business_name ?? '').trim()
  }
  return ''
}

export async function lookupAgencyPolicyNumberConflict(input: {
  agencyProfileId: string
  policyNumber: string
  excludePolicyId?: string | null
}): Promise<{ owner: PolicyFileNumberOwner | null; error: string | null }> {
  const agencyProfileId = String(input.agencyProfileId ?? '').trim()
  if (!agencyProfileId) {
    return { owner: null, error: 'Agency is required to check policy number uniqueness.' }
  }
  if (!normalizePolicyFileNumber(input.policyNumber)) {
    return { owner: null, error: null }
  }

  const { data, error } = await supabase
    .from('policies')
    .select(
      'id, policy_number, client_id, agency_profile_id, clients!policies_client_id_fkey ( business_name )',
    )
    .eq('agency_profile_id', agencyProfileId)
    .is('archived_at', null)

  if (error) return { owner: null, error: error.message }

  const files: PolicyFileNumberOwner[] = (data ?? []).map((row) => ({
    policyId: String(row.id ?? ''),
    policyNumber: String(row.policy_number ?? '').trim(),
    clientId: String(row.client_id ?? ''),
    clientName: clientNameFromEmbed(row.clients),
  }))

  return {
    owner: findConflictingPolicyFileNumber(files, input.policyNumber, {
      excludePolicyId: input.excludePolicyId,
    }),
    error: null,
  }
}

export async function assertNoAgencyPolicyNumberConflict(input: {
  agencyProfileId: string
  policyNumber: string
  excludePolicyId?: string | null
}): Promise<string | null> {
  const { owner, error } = await lookupAgencyPolicyNumberConflict(input)
  if (error) return error
  if (owner) return formatPolicyNumberInUseMessage(owner)
  return null
}
