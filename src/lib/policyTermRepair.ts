/**
 * Owner/Admin repair of missing/legacy snapshots on a prior policy term.
 * Never writes the live Policy File and never overwrites a conflicting snapshot.
 */

import { recordActivity } from './activity'
import { fetchPolicyTermTxnRows } from './commission'
import { canRepairHistoricalPolicyTerm, rejectUnlessRole } from './permissions'
import {
  FILE_CURRENT_TERM_ID,
  listPolicyFileTerms,
  resolvePolicyFileTerm,
} from './policyPremium'
import { isoDateOnly } from './transactionDateSemantics'
import { supabase } from './supabase'

export type TermSnapshotRow = {
  id: string
  policyId: string
  transactionNumber?: string | null
  policyNumber?: string | null
  policyEffectiveDate?: string | null
  policyExpirationDate?: string | null
}

export type TermSnapshotPatch = {
  id: string
  policyNumber?: string
  policyEffectiveDate?: string
  policyExpirationDate?: string
}

export type TermSnapshotConflict = {
  id: string
  transactionNumber: string
  field: 'policy_number' | 'policy_effective_date' | 'policy_expiration_date'
  existing: string
  requested: string
}

export type HistoricalTermRepairPlan = {
  error: string | null
  updates: TermSnapshotPatch[]
  skippedIds: string[]
  conflicts: TermSnapshotConflict[]
}

export function isMissingTermSnapshotValue(value: string | null | undefined): boolean {
  const trimmed = String(value ?? '').trim()
  return !trimmed || trimmed === '—'
}

function normalizeSnapshotValue(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

function distinctExisting(
  rows: TermSnapshotRow[],
  read: (row: TermSnapshotRow) => string | null | undefined,
): string[] {
  const found = new Set<string>()
  for (const row of rows) {
    const value = normalizeSnapshotValue(read(row))
    if (!isMissingTermSnapshotValue(value)) found.add(value)
  }
  return [...found].sort()
}

function conflictMessage(conflicts: TermSnapshotConflict[]): string {
  const numbers = [
    ...new Set(conflicts.filter((c) => c.field === 'policy_number').map((c) => c.existing)),
  ]
  if (numbers.length > 1) {
    return `Cannot repair this term: transactions already have conflicting policy number snapshots (${numbers.join(', ')}). Existing snapshots are not overwritten.`
  }
  if (numbers.length === 1) {
    const count = conflicts.filter((c) => c.field === 'policy_number').length
    return `Cannot repair this term: ${count} transaction(s) already have a different policy number snapshot (${numbers[0]}). Existing snapshots are not overwritten.`
  }
  const dates = [
    ...new Set(
      conflicts
        .filter((c) => c.field !== 'policy_number')
        .map((c) => `${c.field.replace(/_/g, ' ')}=${c.existing}`),
    ),
  ]
  return `Cannot repair this term: ${conflicts.length} transaction(s) already have a different term date snapshot (${dates.join('; ')}). Existing snapshots are not overwritten.`
}

/**
 * Decide which selected-term transactions may receive missing snapshot values.
 * Rejects current terms, other-policy rows, and any already-valid conflicting snapshot.
 */
export function planHistoricalTermSnapshotRepair(input: {
  policyId: string
  termId: string
  isCurrent: boolean
  termTransactionIds: string[]
  rows: TermSnapshotRow[]
  policyNumber: string
  policyEffectiveDate?: string | null
  policyExpirationDate?: string | null
}): HistoricalTermRepairPlan {
  const empty: HistoricalTermRepairPlan = {
    error: null,
    updates: [],
    skippedIds: [],
    conflicts: [],
  }
  if (input.isCurrent || input.termId === FILE_CURRENT_TERM_ID) {
    return { ...empty, error: 'The current policy term is edited on the Policy File, not here.' }
  }
  const policyId = input.policyId.trim()
  const termId = input.termId.trim()
  if (!policyId || !termId) {
    return { ...empty, error: 'Policy term is required.' }
  }
  const policyNumber = normalizeSnapshotValue(input.policyNumber)
  if (!policyNumber) {
    return { ...empty, error: 'Policy number is required.' }
  }
  const requestedEff = isoDateOnly(input.policyEffectiveDate ?? '')
  const requestedExp = isoDateOnly(input.policyExpirationDate ?? '')
  if (requestedEff && requestedExp && requestedExp < requestedEff) {
    return { ...empty, error: 'Expiration date must be on or after effective date.' }
  }

  const allowedIds = new Set(input.termTransactionIds.map((id) => String(id).trim()).filter(Boolean))
  if (allowedIds.size === 0) {
    return { ...empty, error: 'This term has no transactions to repair.' }
  }

  const termRows: TermSnapshotRow[] = []
  for (const row of input.rows) {
    const id = String(row.id ?? '').trim()
    if (!id || !allowedIds.has(id)) continue
    if (String(row.policyId ?? '').trim() !== policyId) {
      return { ...empty, error: 'A selected transaction does not belong to this Policy File.' }
    }
    termRows.push(row)
  }

  const existingNumbers = distinctExisting(termRows, (row) => row.policyNumber)
  const conflicts: TermSnapshotConflict[] = []
  if (existingNumbers.length > 1) {
    for (const row of termRows) {
      const existing = normalizeSnapshotValue(row.policyNumber)
      if (!isMissingTermSnapshotValue(existing) && existing !== policyNumber) {
        conflicts.push({
          id: row.id,
          transactionNumber: String(row.transactionNumber ?? row.id),
          field: 'policy_number',
          existing,
          requested: policyNumber,
        })
      }
    }
  } else if (existingNumbers.length === 1 && existingNumbers[0] !== policyNumber) {
    for (const row of termRows) {
      const existing = normalizeSnapshotValue(row.policyNumber)
      if (!isMissingTermSnapshotValue(existing)) {
        conflicts.push({
          id: row.id,
          transactionNumber: String(row.transactionNumber ?? row.id),
          field: 'policy_number',
          existing,
          requested: policyNumber,
        })
      }
    }
  }

  if (requestedEff) {
    const existingEff = distinctExisting(termRows, (row) => row.policyEffectiveDate)
    if (existingEff.length > 1 || (existingEff.length === 1 && existingEff[0] !== requestedEff)) {
      for (const row of termRows) {
        const existing = isoDateOnly(row.policyEffectiveDate)
        if (existing && existing !== requestedEff) {
          conflicts.push({
            id: row.id,
            transactionNumber: String(row.transactionNumber ?? row.id),
            field: 'policy_effective_date',
            existing,
            requested: requestedEff,
          })
        }
      }
    }
  }
  if (requestedExp) {
    const existingExp = distinctExisting(termRows, (row) => row.policyExpirationDate)
    if (existingExp.length > 1 || (existingExp.length === 1 && existingExp[0] !== requestedExp)) {
      for (const row of termRows) {
        const existing = isoDateOnly(row.policyExpirationDate)
        if (existing && existing !== requestedExp) {
          conflicts.push({
            id: row.id,
            transactionNumber: String(row.transactionNumber ?? row.id),
            field: 'policy_expiration_date',
            existing,
            requested: requestedExp,
          })
        }
      }
    }
  }

  if (conflicts.length > 0) {
    return { error: conflictMessage(conflicts), updates: [], skippedIds: [], conflicts }
  }

  const updates: TermSnapshotPatch[] = []
  const skippedIds: string[] = []
  for (const row of termRows) {
    const patch: TermSnapshotPatch = { id: row.id }
    if (isMissingTermSnapshotValue(row.policyNumber)) patch.policyNumber = policyNumber
    if (requestedEff && isMissingTermSnapshotValue(row.policyEffectiveDate)) {
      patch.policyEffectiveDate = requestedEff
    }
    if (requestedExp && isMissingTermSnapshotValue(row.policyExpirationDate)) {
      patch.policyExpirationDate = requestedExp
    }
    if (patch.policyNumber || patch.policyEffectiveDate || patch.policyExpirationDate) {
      updates.push(patch)
    } else {
      skippedIds.push(row.id)
    }
  }

  return { error: null, updates, skippedIds, conflicts: [] }
}

export async function repairHistoricalTermSnapshots(input: {
  policyId: string
  termId: string
  policyNumber: string
  policyEffectiveDate?: string | null
  policyExpirationDate?: string | null
}): Promise<{ data: { updatedCount: number; updatedIds: string[] } | null; error: string | null }> {
  const authz = await rejectUnlessRole(
    canRepairHistoricalPolicyTerm,
    'Only Owner/Admin can repair historical term details.',
  )
  if (!authz.ok) return { data: null, error: authz.message }

  const policyId = input.policyId.trim()
  const termId = input.termId.trim()
  if (!policyId || !termId) return { data: null, error: 'Policy term is required.' }

  const { data: policyRow, error: policyError } = await supabase
    .from('policies')
    .select(
      'id, client_id, agency_profile_id, policy_number, effective_date, expiration_date, producer, csr, carrier, mga, premium',
    )
    .eq('id', policyId)
    .is('archived_at', null)
    .maybeSingle()
  if (policyError) return { data: null, error: policyError.message }
  if (!policyRow) return { data: null, error: 'Policy was not found.' }

  if (authz.profileId) {
    const { data: userRow } = await supabase
      .from('users')
      .select('agency_profile_id')
      .eq('id', authz.profileId)
      .maybeSingle()
    const userAgency = String(userRow?.agency_profile_id ?? '').trim()
    const policyAgency = String(policyRow.agency_profile_id ?? '').trim()
    if (userAgency && policyAgency && userAgency !== policyAgency) {
      return { data: null, error: 'Policy term must belong to your agency.' }
    }
  }

  const termTxnRes = await fetchPolicyTermTxnRows([policyId])
  if (termTxnRes.error) return { data: null, error: termTxnRes.error.message }
  const terms = listPolicyFileTerms(termTxnRes.data[policyId] ?? [], {
    policyNumber: String(policyRow.policy_number ?? ''),
    effectiveDate: String(policyRow.effective_date ?? ''),
    expirationDate: String(policyRow.expiration_date ?? ''),
    producer: String(policyRow.producer ?? ''),
    csr: String(policyRow.csr ?? ''),
    carrier: String(policyRow.carrier ?? ''),
    mga: String(policyRow.mga ?? ''),
    premium: Number(policyRow.premium ?? 0) || 0,
  })
  const term = resolvePolicyFileTerm(terms, termId)
  if (!term || term.termId !== termId) {
    return { data: null, error: 'That policy term was not found.' }
  }
  if (term.isCurrent) {
    return { data: null, error: 'The current policy term is edited on the Policy File, not here.' }
  }

  const termIds = term.transactionIds.filter(Boolean)
  if (termIds.length === 0) return { data: null, error: 'This term has no transactions to repair.' }

  const { data: rows, error: rowError } = await supabase
    .from('transactions')
    .select(
      'id, policy_id, transaction_number, policy_number, policy_effective_date, policy_expiration_date, archived_at',
    )
    .eq('policy_id', policyId)
    .in('id', termIds)
    .is('archived_at', null)
  if (rowError) return { data: null, error: rowError.message }

  const snapshotRows: TermSnapshotRow[] = (rows ?? []).map((row) => ({
    id: String(row.id),
    policyId: String(row.policy_id ?? ''),
    transactionNumber: row.transaction_number as string | null,
    policyNumber: row.policy_number as string | null,
    policyEffectiveDate: row.policy_effective_date as string | null,
    policyExpirationDate: row.policy_expiration_date as string | null,
  }))

  const plan = planHistoricalTermSnapshotRepair({
    policyId,
    termId: term.termId,
    isCurrent: term.isCurrent,
    termTransactionIds: termIds,
    rows: snapshotRows,
    policyNumber: input.policyNumber,
    policyEffectiveDate: input.policyEffectiveDate,
    policyExpirationDate: input.policyExpirationDate,
  })
  if (plan.error) return { data: null, error: plan.error }
  if (plan.updates.length === 0) {
    return { data: { updatedCount: 0, updatedIds: [] }, error: null }
  }

  const updatedIds: string[] = []
  for (const update of plan.updates) {
    const patch: Record<string, string> = {}
    if (update.policyNumber) patch.policy_number = update.policyNumber
    if (update.policyEffectiveDate) patch.policy_effective_date = update.policyEffectiveDate
    if (update.policyExpirationDate) patch.policy_expiration_date = update.policyExpirationDate
    const { error } = await supabase
      .from('transactions')
      .update(patch)
      .eq('id', update.id)
      .eq('policy_id', policyId)
      .in('id', termIds)
      .is('archived_at', null)
    if (error) return { data: null, error: error.message }
    updatedIds.push(update.id)
  }

  await recordActivity({
    action: 'policy_term_snapshot_repair',
    entityType: 'policy',
    entityId: policyId,
    recordReference: normalizeSnapshotValue(input.policyNumber),
    clientId: String(policyRow.client_id ?? '') || null,
    policyId,
    oldValue: {
      term_id: term.termId,
      snapshots: snapshotRows
        .filter((row) => updatedIds.includes(row.id))
        .map((row) => ({
          id: row.id,
          transaction_number: row.transactionNumber,
          policy_number: row.policyNumber,
          policy_effective_date: row.policyEffectiveDate,
          policy_expiration_date: row.policyExpirationDate,
        })),
    },
    newValue: {
      term_id: term.termId,
      policy_number: normalizeSnapshotValue(input.policyNumber),
      policy_effective_date: isoDateOnly(input.policyEffectiveDate ?? '') || null,
      policy_expiration_date: isoDateOnly(input.policyExpirationDate ?? '') || null,
      updated_transaction_ids: updatedIds,
    },
  })

  return { data: { updatedCount: updatedIds.length, updatedIds }, error: null }
}
