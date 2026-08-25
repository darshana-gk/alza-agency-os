/**
 * Master Agency Data import — one book-of-business spreadsheet → directory + clients + policies.
 *
 * Reuses evaluateOnboardingRows / create* persistence from individual onboarding flows.
 * Does NOT create transactions or synthetic opening ledger rows.
 */

import { recordActivity } from './activity'
import {
  canImportOnboardingEntity,
  emptyOnboardingCaches,
  evaluateOnboardingRows,
  executeOnboardingImport,
  loadOnboardingLookupCaches,
  normalizeOnboardingName,
  ONBOARDING_ENTITY_LABELS,
  requiredFieldsMapped,
  type OnboardingInsertDeps,
  type OnboardingLookupCaches,
  type OnboardingMapping,
  type OnboardingPreviewResult,
  type OnboardingPreviewRow,
} from './onboardingImport'
import { rejectUnlessRole } from './permissions'
import {
  createCarrier,
  createClient,
  createCsr,
  createMga,
  createPolicy,
  createProducer,
} from './directory'

export const MASTER_AGENCY_PENDING_CLIENT_PREFIX = '__pending_client__:'

export type MasterAgencyChildEntity =
  | 'carriers'
  | 'mgas'
  | 'producers'
  | 'csrs'
  | 'clients'
  | 'policies'

export const MASTER_AGENCY_IMPORT_ORDER: MasterAgencyChildEntity[] = [
  'carriers',
  'mgas',
  'producers',
  'csrs',
  'clients',
  'policies',
]

export interface MasterAgencyEntitySummary {
  entity: MasterAgencyChildEntity
  label: string
  /** Rows that will be inserted (ready). */
  newCount: number
  /** Existing ALZA matches skipped (never overwritten). */
  existingSkipped: number
  /** missing_required + invalid + possible_duplicate */
  invalid: number
  preview: OnboardingPreviewResult
}

export interface MasterAgencyPreviewResult {
  kind: 'master_agency'
  sourceRowCount: number
  mapping: OnboardingMapping
  entities: MasterAgencyEntitySummary[]
  /** Sum of newCount across all child entities. */
  totalNew: number
  /** Pending client id → display name (for execute remapping). */
  pendingClients: Array<{ pendingId: string; businessName: string }>
}

export interface MasterAgencyImportResult {
  entities: Array<{
    entity: MasterAgencyChildEntity
    label: string
    imported: number
    skippedDuplicate: number
    skippedValidation: number
    failed: number
    errors: string[]
  }>
  imported: number
  skippedDuplicate: number
  skippedValidation: number
  failed: number
  errors: string[]
  /** Always 0 — Master Agency Data never creates transactions. */
  createdTransactions: number
}

function mappedText(
  row: Record<string, unknown>,
  mapping: OnboardingMapping,
  fieldKey: string,
): string {
  const header = mapping[fieldKey]
  if (!header) return ''
  return String(row[header] ?? '').trim()
}

function pushName(map: Map<string, string[]>, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const key = normalizeOnboardingName(trimmed)
  const list = map.get(key) ?? []
  list.push(trimmed)
  map.set(key, list)
}

function cloneCaches(caches: OnboardingLookupCaches): OnboardingLookupCaches {
  return {
    clientsByName: new Map(
      [...caches.clientsByName.entries()].map(([k, v]) => [k, v.map((c) => ({ ...c }))]),
    ),
    clientsByNumber: new Map(
      [...caches.clientsByNumber.entries()].map(([k, v]) => [k, v.map((c) => ({ ...c }))]),
    ),
    carriersByName: new Map(
      [...caches.carriersByName.entries()].map(([k, v]) => [k, [...v]]),
    ),
    mgasByName: new Map([...caches.mgasByName.entries()].map(([k, v]) => [k, [...v]])),
    producersByName: new Map(
      [...caches.producersByName.entries()].map(([k, v]) => [k, [...v]]),
    ),
    producersByEmail: new Map(
      [...caches.producersByEmail.entries()].map(([k, v]) => [k, [...v]]),
    ),
    csrsByName: new Map([...caches.csrsByName.entries()].map(([k, v]) => [k, [...v]])),
    csrsByEmail: new Map([...caches.csrsByEmail.entries()].map(([k, v]) => [k, [...v]])),
    policiesByClientPolicy: new Set(caches.policiesByClientPolicy),
  }
}

function identityMapping(keys: string[]): OnboardingMapping {
  const mapping: OnboardingMapping = {}
  for (const key of keys) mapping[key] = key
  return mapping
}

function extractUniqueNames(
  rows: Record<string, unknown>[],
  mapping: OnboardingMapping,
  fieldKey: string,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const name = mappedText(row, mapping, fieldKey)
    if (!name) continue
    const key = normalizeOnboardingName(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** First occurrence wins for client producer/csr attributes. */
function extractUniqueClients(
  rows: Record<string, unknown>[],
  mapping: OnboardingMapping,
): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const businessName = mappedText(row, mapping, 'client_name')
    if (!businessName) continue
    const key = normalizeOnboardingName(businessName)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      business_name: businessName,
      producer: mappedText(row, mapping, 'producer'),
      csr: mappedText(row, mapping, 'csr'),
      status: 'active',
    })
  }
  return out
}

function summarizeEntity(
  entity: MasterAgencyChildEntity,
  preview: OnboardingPreviewResult,
): MasterAgencyEntitySummary {
  return {
    entity,
    label: ONBOARDING_ENTITY_LABELS[entity],
    newCount: preview.ready,
    existingSkipped: preview.skippedDuplicate,
    invalid: preview.missingRequired + preview.invalid + preview.possibleDuplicate,
    preview,
  }
}

function seedDirectoryFromReady(
  caches: OnboardingLookupCaches,
  entity: 'carriers' | 'mgas' | 'producers' | 'csrs',
  preview: OnboardingPreviewResult,
) {
  for (const row of preview.rows) {
    if (row.status !== 'ready') continue
    if (entity === 'carriers') pushName(caches.carriersByName, String(row.payload.carrierName ?? ''))
    if (entity === 'mgas') pushName(caches.mgasByName, String(row.payload.mgaName ?? ''))
    if (entity === 'producers') {
      pushName(caches.producersByName, String(row.payload.producerName ?? ''))
    }
    if (entity === 'csrs') pushName(caches.csrsByName, String(row.payload.csrName ?? ''))
  }
}

function seedPendingClients(
  caches: OnboardingLookupCaches,
  clientsPreview: OnboardingPreviewResult,
): Array<{ pendingId: string; businessName: string }> {
  const pending: Array<{ pendingId: string; businessName: string }> = []
  for (const row of clientsPreview.rows) {
    if (row.status !== 'ready') continue
    const businessName = String(row.payload.businessName ?? '').trim()
    if (!businessName) continue
    const key = normalizeOnboardingName(businessName)
    const pendingId = `${MASTER_AGENCY_PENDING_CLIENT_PREFIX}${key}`
    caches.clientsByName.set(key, [{ id: pendingId, businessName }])
    pending.push({ pendingId, businessName })
  }
  return pending
}

/**
 * Pure Master Agency evaluate: extract uniques → per-entity evaluate → provisional cache seed → policies.
 */
export function evaluateMasterAgencyImport(input: {
  rows: Record<string, unknown>[]
  mapping: OnboardingMapping
  caches: OnboardingLookupCaches
}): MasterAgencyPreviewResult {
  const working = cloneCaches(input.caches)

  const carrierNames = extractUniqueNames(input.rows, input.mapping, 'carrier')
  const mgaNames = extractUniqueNames(input.rows, input.mapping, 'mga')
  const producerNames = extractUniqueNames(input.rows, input.mapping, 'producer')
  const csrNames = extractUniqueNames(input.rows, input.mapping, 'csr')
  const clientRows = extractUniqueClients(input.rows, input.mapping)

  const carriersPreview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: carrierNames.map((carrier_name) => ({ carrier_name })),
    mapping: identityMapping(['carrier_name']),
    caches: working,
  })
  seedDirectoryFromReady(working, 'carriers', carriersPreview)

  const mgasPreview = evaluateOnboardingRows({
    entity: 'mgas',
    rows: mgaNames.map((mga_name) => ({ mga_name })),
    mapping: identityMapping(['mga_name']),
    caches: working,
  })
  seedDirectoryFromReady(working, 'mgas', mgasPreview)

  const producersPreview = evaluateOnboardingRows({
    entity: 'producers',
    rows: producerNames.map((producer_name) => ({ producer_name })),
    mapping: identityMapping(['producer_name']),
    caches: working,
  })
  seedDirectoryFromReady(working, 'producers', producersPreview)

  const csrsPreview = evaluateOnboardingRows({
    entity: 'csrs',
    rows: csrNames.map((csr_name) => ({ csr_name })),
    mapping: identityMapping(['csr_name']),
    caches: working,
  })
  seedDirectoryFromReady(working, 'csrs', csrsPreview)

  const clientsPreview = evaluateOnboardingRows({
    entity: 'clients',
    rows: clientRows,
    mapping: identityMapping(['business_name', 'producer', 'csr', 'status']),
    caches: working,
  })
  const pendingClients = seedPendingClients(working, clientsPreview)

  // Policies use the original master mapping + provisional caches so in-file
  // directory/client creates are not treated as "unknown".
  const policiesPreview = evaluateOnboardingRows({
    entity: 'policies',
    rows: input.rows,
    mapping: input.mapping,
    caches: working,
  })

  const entities = [
    summarizeEntity('carriers', carriersPreview),
    summarizeEntity('mgas', mgasPreview),
    summarizeEntity('producers', producersPreview),
    summarizeEntity('csrs', csrsPreview),
    summarizeEntity('clients', clientsPreview),
    summarizeEntity('policies', policiesPreview),
  ]

  return {
    kind: 'master_agency',
    sourceRowCount: input.rows.length,
    mapping: input.mapping,
    entities,
    totalNew: entities.reduce((sum, e) => sum + e.newCount, 0),
    pendingClients,
  }
}

export async function buildMasterAgencyPreview(input: {
  rows: Record<string, unknown>[]
  mapping: OnboardingMapping
  /** Test-only: inject caches instead of loading from Supabase. */
  caches?: OnboardingLookupCaches
  bypassAuth?: boolean
}): Promise<{ data: MasterAgencyPreviewResult | null; error: string | null }> {
  if (!input.bypassAuth) {
    const authz = await rejectUnlessRole(
      (role) => canImportOnboardingEntity(role, 'master_agency'),
      'You do not have permission to import this data type.',
    )
    if (!authz.ok) return { data: null, error: authz.message }
  }

  const mapped = requiredFieldsMapped('master_agency', input.mapping)
  if (!mapped.ok) {
    return { data: null, error: `Map required fields first: ${mapped.missing.join(', ')}.` }
  }

  const caches = input.caches ?? (await loadOnboardingLookupCaches())
  return {
    data: evaluateMasterAgencyImport({
      rows: input.rows,
      mapping: input.mapping,
      caches,
    }),
    error: null,
  }
}

function entitySummary(
  preview: MasterAgencyPreviewResult,
  entity: MasterAgencyChildEntity,
): MasterAgencyEntitySummary {
  const found = preview.entities.find((e) => e.entity === entity)
  if (!found) {
    return summarizeEntity(entity, {
      entity,
      total: 0,
      ready: 0,
      skippedDuplicate: 0,
      missingRequired: 0,
      invalid: 0,
      possibleDuplicate: 0,
      rows: [],
    })
  }
  return found
}

/**
 * Execute Master Agency Data in dependency order using the same create* paths
 * as individual imports (via executeOnboardingImport per child entity).
 */
export async function executeMasterAgencyImport(input: {
  preview: MasterAgencyPreviewResult
  deps?: OnboardingInsertDeps
}): Promise<{ data: MasterAgencyImportResult | null; error: string | null }> {
  if (input.preview.kind !== 'master_agency') {
    return { data: null, error: 'Invalid Master Agency preview.' }
  }

  if (!input.deps?.bypassAuth) {
    const authz = await rejectUnlessRole(
      (role) => canImportOnboardingEntity(role, 'master_agency'),
      'You do not have permission to import this data type.',
    )
    if (!authz.ok) return { data: null, error: authz.message }
  }

  const pendingToReal = new Map<string, string>()

  const createClientTracked: NonNullable<OnboardingInsertDeps['createClient']> = async (args) => {
    const result = input.deps?.createClient
      ? await input.deps.createClient(args)
      : await createClient(args)
    const id =
      result && typeof result === 'object' && 'data' in result && result.data && typeof result.data === 'object'
        ? String((result.data as { id?: string }).id ?? '')
        : ''
    if (id) {
      const pendingId = `${MASTER_AGENCY_PENDING_CLIENT_PREFIX}${normalizeOnboardingName(args.businessName)}`
      pendingToReal.set(pendingId, id)
    }
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      const message =
        typeof result.error === 'object' && result.error && 'message' in result.error
          ? String((result.error as { message: string }).message)
          : 'Client create failed.'
      return { data: null, error: { message } }
    }
    return { data: id ? { id } : null, error: id ? null : { message: 'Client create returned no id.' } }
  }

  const deps: OnboardingInsertDeps = {
    bypassAuth: true,
    skipActivity: true,
    createCarrier: input.deps?.createCarrier ?? createCarrier,
    createMga: input.deps?.createMga ?? createMga,
    createProducer: input.deps?.createProducer ?? createProducer,
    createCsr: input.deps?.createCsr ?? createCsr,
    createClient: createClientTracked,
    createPolicy: input.deps?.createPolicy ?? createPolicy,
    allocateClientNumbers: input.deps?.allocateClientNumbers,
  }

  const entityResults: MasterAgencyImportResult['entities'] = []
  const allErrors: string[] = []
  let imported = 0
  let skippedDuplicate = 0
  let skippedValidation = 0
  let failed = 0

  for (const entity of MASTER_AGENCY_IMPORT_ORDER) {
    const summary = entitySummary(input.preview, entity)
    let childPreview = summary.preview

    if (entity === 'policies') {
      const remappedRows: OnboardingPreviewRow[] = childPreview.rows.map((row) => {
        if (row.status !== 'ready') return row
        const clientId = String(row.payload.clientId ?? '')
        if (!clientId.startsWith(MASTER_AGENCY_PENDING_CLIENT_PREFIX)) return row
        const realId = pendingToReal.get(clientId)
        if (!realId) {
          return {
            ...row,
            status: 'invalid' as const,
            reasons: [
              ...row.reasons,
              'Client created in this master import could not be resolved to a production id.',
            ],
            payload: { ...row.payload, clientId: null },
          }
        }
        return {
          ...row,
          payload: { ...row.payload, clientId: realId },
        }
      })
      childPreview = {
        ...childPreview,
        rows: remappedRows,
        ready: remappedRows.filter((r) => r.status === 'ready').length,
        invalid: remappedRows.filter((r) => r.status === 'invalid').length,
      }
    }

    const childDeps: OnboardingInsertDeps = { ...deps }

    const out = await executeOnboardingImport({
      entity,
      preview: childPreview,
      deps: childDeps,
    })

    if (out.error || !out.data) {
      return {
        data: null,
        error: out.error || `Master import failed while creating ${ONBOARDING_ENTITY_LABELS[entity]}.`,
      }
    }

    const result = out.data
    entityResults.push({
      entity,
      label: ONBOARDING_ENTITY_LABELS[entity],
      imported: result.imported,
      skippedDuplicate: result.skippedDuplicate,
      skippedValidation: result.skippedValidation,
      failed: result.failed,
      errors: result.errors,
    })
    imported += result.imported
    skippedDuplicate += result.skippedDuplicate
    skippedValidation += result.skippedValidation
    failed += result.failed
    for (const e of result.errors) {
      allErrors.push(`${ONBOARDING_ENTITY_LABELS[entity]}: ${e}`)
    }
  }

  if (!input.deps?.skipActivity) {
    await recordActivity({
      action: 'onboarding_bulk_import',
      entityType: 'onboarding',
      entityId: 'master_agency',
      recordReference: 'master_agency',
      newValue: {
        imported,
        skippedDuplicate,
        skippedValidation,
        failed,
        sourceRowCount: input.preview.sourceRowCount,
        entities: entityResults.map((e) => ({
          entity: e.entity,
          imported: e.imported,
          skippedDuplicate: e.skippedDuplicate,
          failed: e.failed,
        })),
        createdTransactions: 0,
      },
    })
  }

  return {
    data: {
      entities: entityResults,
      imported,
      skippedDuplicate,
      skippedValidation,
      failed,
      errors: allErrors.slice(0, 80),
      createdTransactions: 0,
    },
    error: null,
  }
}

export function buildMasterAgencyResultLogCsv(
  preview: MasterAgencyPreviewResult,
  result: MasterAgencyImportResult,
): string {
  const lines = ['entity,row,status,details,notes,result']
  for (const entity of preview.entities) {
    for (const row of entity.preview.rows) {
      const details = Object.entries(row.display)
        .map(([k, v]) => `${k}: ${v || '—'}`)
        .join(' · ')
      const notes = row.reasons.join(' ') || '—'
      let resultCol = 'skipped_validation'
      if (row.status === 'ready') resultCol = 'imported_or_attempted'
      else if (row.status === 'skipped_duplicate') resultCol = 'skipped_duplicate'
      lines.push(
        [
          entity.entity,
          String(row.rowIndex),
          row.status,
          csvEscape(details),
          csvEscape(notes),
          csvEscape(resultCol),
        ].join(','),
      )
    }
  }
  lines.push(
    `totals,,,imported=${result.imported};failed=${result.failed};txns=${result.createdTransactions},,`,
  )
  return lines.join('\n')
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Test helper — empty caches. */
export function emptyMasterCaches(): OnboardingLookupCaches {
  return emptyOnboardingCaches()
}
