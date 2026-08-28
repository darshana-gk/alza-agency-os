/**
 * Field ownership / conflict model (framework only — no complex resolution yet).
 *
 * Intent:
 * - External systems may own operational source fields (policy number, effective dates).
 * - ALZA owns reconciliation status and internal commission workflow fields.
 * - Manual ALZA edits must not be silently overwritten without explicit rules.
 */

import type { AlzaCanonicalEntity } from './canonicalRouting'

export type FieldOwner = 'external_source' | 'alza' | 'manual_alza' | 'shared'

export type FieldOwnershipRule = {
  entityType: AlzaCanonicalEntity | 'transactions' | 'reconciliation'
  field: string
  owner: FieldOwner
  notes: string
}

export const FIELD_OWNERSHIP_RULES: readonly FieldOwnershipRule[] = [
  {
    entityType: 'policies',
    field: 'policy_number',
    owner: 'external_source',
    notes: 'AMS may own policy number when connected; ALZA stores durable external id mapping.',
  },
  {
    entityType: 'policies',
    field: 'effective_date',
    owner: 'external_source',
    notes: 'AMS may own effective/expiration dates.',
  },
  {
    entityType: 'policies',
    field: 'expiration_date',
    owner: 'external_source',
    notes: 'AMS may own effective/expiration dates.',
  },
  {
    entityType: 'reconciliation',
    field: 'match_status',
    owner: 'alza',
    notes: 'ALZA owns reconciliation matching outcomes — never overwritten by AMS sync.',
  },
  {
    entityType: 'reconciliation',
    field: 'receipt_confirmation',
    owner: 'alza',
    notes: 'Commission receipt confirmation stays ALZA-owned.',
  },
  {
    entityType: 'transactions',
    field: 'agency_commission_confirmed',
    owner: 'alza',
    notes: 'Internal commission workflow fields are ALZA-owned.',
  },
  {
    entityType: 'clients',
    field: 'business_name',
    owner: 'shared',
    notes: 'Shared until conflict rules land; manual ALZA edits must not be silently overwritten.',
  },
] as const

export const CONFLICT_OWNERSHIP_PRINCIPLES = [
  'Prefer durable external IDs over name matching for sync upserts.',
  'ALZA reconciliation and commission workflow fields are never source-of-truth from AMS/CRM.',
  'Manual ALZA edits require explicit ownership or conflict policy before overwrite.',
  'V1 foundation documents ownership; complex conflict resolution is deferred.',
] as const
