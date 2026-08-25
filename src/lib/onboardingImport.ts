import { parseMoney, roundMoney } from './reconciliationMatching'
import { parseIsoDate } from './reconciliation'
import {
  createCarrier,
  createClient,
  createCsr,
  createMga,
  createPolicy,
  createProducer,
  POLICY_STATUSES,
  type PolicyStatusValue,
} from './directory'
import { isAdminDirectoryRole, rejectUnlessRole, type RoleInput } from './permissions'
import {
  PRODUCER_SPLIT_REQUIRED_MESSAGE,
  validateProducerSplitPercentage,
} from './producerSplitValidation'
import { supabase } from './supabase'
import { recordActivity } from './activity'

export type OnboardingEntity =
  | 'clients'
  | 'policies'
  | 'carriers'
  | 'mgas'
  | 'producers'
  | 'csrs'

export type OnboardingRowStatus =
  | 'ready'
  | 'missing_required'
  | 'invalid'
  | 'possible_duplicate'
  | 'skipped_duplicate'
  | 'failed'

export interface OnboardingFieldDef {
  key: string
  label: string
  required: boolean
}

export const ONBOARDING_ENTITY_LABELS: Record<OnboardingEntity, string> = {
  clients: 'Clients',
  policies: 'Policies',
  carriers: 'Carriers',
  mgas: 'MGAs',
  producers: 'Producers',
  csrs: 'CSRs',
}

export const ONBOARDING_FIELDS: Record<OnboardingEntity, OnboardingFieldDef[]> = {
  clients: [
    { key: 'business_name', label: 'Business Name', required: true },
    { key: 'client_number', label: 'Client Number', required: false },
    { key: 'dba', label: 'DBA', required: false },
    { key: 'fein', label: 'FEIN', required: false },
    { key: 'contact_name', label: 'Contact Name', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'producer', label: 'Producer', required: false },
    { key: 'csr', label: 'CSR', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'mailing_address', label: 'Mailing Address', required: false },
    { key: 'physical_address', label: 'Physical Address', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  policies: [
    { key: 'client_name', label: 'Client Name', required: true },
    { key: 'policy_number', label: 'Policy Number', required: true },
    { key: 'policy_type', label: 'Policy Type / Line of Business', required: false },
    { key: 'carrier', label: 'Carrier', required: false },
    { key: 'mga', label: 'MGA', required: false },
    { key: 'effective_date', label: 'Effective Date', required: false },
    { key: 'expiration_date', label: 'Expiration Date', required: false },
    { key: 'reference_premium', label: 'Current Policy Premium', required: false },
    { key: 'commission_type', label: 'Commission Type', required: false },
    { key: 'agency_commission_percentage', label: 'Agency Commission %', required: false },
    { key: 'agency_commission_amount', label: 'Agency Commission Amount', required: false },
    { key: 'producer', label: 'Producer', required: false },
    { key: 'producer_split_percentage', label: 'Producer Split %', required: true },
    { key: 'csr', label: 'CSR', required: false },
    { key: 'broker_fee', label: 'Default Broker Fee', required: false },
    { key: 'status', label: 'Policy Status', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  carriers: [
    { key: 'carrier_name', label: 'Carrier Name', required: true },
    { key: 'naic', label: 'NAIC', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'appointment_status', label: 'Appointment Status', required: false },
    { key: 'billing_type', label: 'Billing Type', required: false },
    { key: 'lines_of_business', label: 'Lines of Business', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  mgas: [
    { key: 'mga_name', label: 'MGA Name', required: true },
    { key: 'contact_person', label: 'Contact Person', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'states', label: 'States', required: false },
    { key: 'lines_of_business', label: 'Lines of Business', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  producers: [
    { key: 'producer_name', label: 'Producer Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'license_number', label: 'License Number', required: false },
    { key: 'default_split_percentage', label: 'Default Split %', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
  csrs: [
    { key: 'csr_name', label: 'CSR Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'notes', label: 'Notes', required: false },
  ],
}

/**
 * Explicit approved header aliases per ALZA field (no fuzzy/includes matching).
 * Matching uses normalizeHeaderMatchKey so spaces / underscores / hyphens / # collapse.
 */
const FIELD_ALIASES: Record<OnboardingEntity, Record<string, string[]>> = {
  clients: {
    business_name: [
      'business name',
      'business_name',
      'businessname',
      'client name',
      'client_name',
      'clientname',
      'name',
      'insured',
      'named insured',
      'named_insured',
      'customer',
      'account name',
      'account_name',
      'company name',
      'company_name',
    ],
    client_number: [
      'client number',
      'client_number',
      'clientnumber',
      'client #',
      'client#',
      'account number',
      'account_number',
      'accountnumber',
    ],
    dba: ['dba', 'doing business as', 'trade name', 'trade_name'],
    fein: ['fein', 'tax id', 'tax_id', 'taxid', 'ein', 'federal id', 'federal_id'],
    contact_name: [
      'contact name',
      'contact_name',
      'contactname',
      'contact',
      'primary contact',
      'primary_contact',
    ],
    email: ['email', 'e mail', 'e_mail', 'email address', 'email_address', 'emailaddress'],
    phone: [
      'phone',
      'telephone',
      'mobile',
      'phone number',
      'phone_number',
      'phonenumber',
    ],
    producer: ['producer', 'agent', 'producer name', 'producer_name', 'producername', 'agent name'],
    csr: ['csr', 'account manager', 'account_manager', 'csr name', 'csr_name', 'csrname'],
    status: ['status', 'client status', 'client_status'],
    mailing_address: [
      'mailing address',
      'mailing_address',
      'mailingaddress',
      'mail address',
      'mail_address',
      'address',
      'street address',
      'street_address',
    ],
    physical_address: [
      'physical address',
      'physical_address',
      'physicaladdress',
      'location address',
      'location_address',
    ],
    notes: ['notes', 'comments', 'remarks'],
  },
  policies: {
    client_name: [
      'client name',
      'client_name',
      'clientname',
      'client',
      'insured',
      'named insured',
      'named_insured',
      'customer',
      'business name',
      'business_name',
      'account name',
      'account_name',
    ],
    policy_number: [
      'policy number',
      'policy_number',
      'policynumber',
      'policy no',
      'policy_no',
      'policy #',
      'policy#',
      'policy',
    ],
    policy_type: [
      'policy type',
      'policy_type',
      'policytype',
      'line of business',
      'line_of_business',
      'lob',
      'type',
      'coverage type',
      'coverage_type',
      'policy type line of business',
    ],
    carrier: [
      'carrier',
      'carrier name',
      'carrier_name',
      'carriername',
      'writing company',
      'writing_company',
      'writing co',
      'writing_co',
      'company',
    ],
    mga: ['mga', 'mga name', 'mga_name', 'mganame', 'wholesaler', 'broker'],
    effective_date: [
      'effective date',
      'effective_date',
      'effectivedate',
      'eff date',
      'eff_date',
      'eff',
      'inception date',
      'inception_date',
      'start date',
      'start_date',
    ],
    expiration_date: [
      'expiration date',
      'expiration_date',
      'expirationdate',
      'exp date',
      'exp_date',
      'exp',
      'expiry date',
      'expiry_date',
      'end date',
      'end_date',
    ],
    reference_premium: [
      'current policy premium',
      'current_policy_premium',
      'currentpolicypremium',
      'policy premium',
      'policy_premium',
      'written premium',
      'written_premium',
      'premium',
      'annual premium',
      'annual_premium',
    ],
    commission_type: [
      'commission type',
      'commission_type',
      'commissiontype',
      'comm type',
      'comm_type',
      'basis',
    ],
    agency_commission_percentage: [
      'agency commission %',
      'agency commission percent',
      'agency_commission_percentage',
      'agency_commission_percent',
      'agency commission percentage',
      'agency commission percent',
      'agencycommpercent',
      'agency comm %',
      'comm %',
      'commission %',
      'commission percent',
      'commission percentage',
      'carrier commission %',
      'carrier commission percent',
      'carrier_commission_percent',
      'carrier_commission_percentage',
      'carriercommissionpercent',
    ],
    agency_commission_amount: [
      'agency commission amount',
      'agency_commission_amount',
      'agency commission',
      'flat commission',
      'commission amount',
      'commission_amount',
    ],
    producer: ['producer', 'agent', 'producer name', 'producer_name', 'producername', 'agent name'],
    producer_split_percentage: [
      'producer split %',
      'producer split',
      'producer_split',
      'producer_split_percent',
      'producer_split_percentage',
      'producer split percent',
      'producer split percentage',
      'producersplit',
      'producersplitpercent',
      'split %',
      'split percent',
      'producer percent',
    ],
    csr: ['csr', 'account manager', 'account_manager', 'csr name', 'csr_name', 'csrname'],
    broker_fee: [
      'default broker fee',
      'default_broker_fee',
      'broker fee',
      'broker_fee',
      'brokerfee',
      'fee',
    ],
    status: ['policy status', 'policy_status', 'status'],
    notes: ['notes', 'comments', 'remarks'],
  },
  carriers: {
    carrier_name: [
      'carrier name',
      'carrier_name',
      'carriername',
      'carrier',
      'name',
      'company',
      'writing company',
      'writing_company',
      'writing co',
      'writing_co',
    ],
    naic: [
      'naic',
      'naic code',
      'naic_code',
      'naiccode',
      'naic number',
      'naic_number',
      'naicnumber',
      'naic #',
      'naic#',
      'naic no',
      'naic_no',
    ],
    status: ['status', 'carrier status', 'carrier_status'],
    appointment_status: [
      'appointment status',
      'appointment_status',
      'appointmentstatus',
      'appointment',
    ],
    billing_type: [
      'billing type',
      'billing_type',
      'billingtype',
      'billing',
      'bill type',
      'bill_type',
    ],
    lines_of_business: [
      'lines of business',
      'lines_of_business',
      'linesofbusiness',
      'lob',
      'lines',
    ],
    notes: ['notes', 'comments'],
  },
  mgas: {
    mga_name: [
      'mga name',
      'mga_name',
      'mganame',
      'mga',
      'name',
      'wholesaler',
      'broker',
    ],
    contact_person: [
      'contact person',
      'contact_person',
      'contactperson',
      'contact name',
      'contact_name',
      'contact',
    ],
    email: ['email', 'e mail', 'e_mail', 'email address', 'email_address'],
    phone: ['phone', 'telephone', 'phone number', 'phone_number'],
    status: ['status', 'mga status', 'mga_status'],
    states: ['states', 'state'],
    lines_of_business: [
      'lines of business',
      'lines_of_business',
      'linesofbusiness',
      'lob',
      'lines',
    ],
    notes: ['notes', 'comments'],
  },
  producers: {
    producer_name: [
      'producer name',
      'producer_name',
      'producername',
      'producer',
      'name',
      'agent',
      'agent name',
      'agent_name',
      'agentname',
    ],
    email: ['email', 'e mail', 'e_mail', 'email address', 'email_address'],
    phone: ['phone', 'telephone', 'phone number', 'phone_number'],
    license_number: [
      'license number',
      'license_number',
      'licensenumber',
      'license',
      'license #',
      'license#',
    ],
    default_split_percentage: [
      'default split %',
      'default_split_percentage',
      'default split',
      'default_split',
      'default producer split %',
      'default producer split',
      'split %',
      'split percent',
    ],
    status: ['status', 'producer status', 'producer_status'],
    notes: ['notes', 'comments'],
  },
  csrs: {
    csr_name: [
      'csr name',
      'csr_name',
      'csrname',
      'csr',
      'name',
      'account manager',
      'account_manager',
      'accountmanager',
    ],
    email: ['email', 'e mail', 'e_mail', 'email address', 'email_address'],
    phone: ['phone', 'telephone', 'phone number', 'phone_number'],
    status: ['status', 'csr status', 'csr_status'],
    notes: ['notes', 'comments'],
  },
}

const REFERENCE_PREMIUM_PERSIST_NOTE =
  'Current Policy Premium is saved on policies.premium. UI Current Policy Premium = policies.premium + SUM(related transaction amounts); no synthetic opening transaction is created.'

export type OnboardingMapping = Record<string, string | undefined>

/** Space-separated normalized header (trim, lowercase, collapse separators). */
export function normalizeHeaderKey(value: string): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[%#./]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Compact match key: ignore spaces, underscores, hyphens, and harmless punctuation
 * so Carrier Name / carrier_name / CarrierName all match.
 */
export function normalizeHeaderMatchKey(value: string): string {
  return normalizeHeaderKey(value).replace(/\s+/g, '')
}

/** Single shared accept list for the onboarding file input (wizard must use one input only). */
export const ONBOARDING_FILE_ACCEPT =
  '.csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Upload file control always switches to file mode and opens the shared file picker.
 * Drop-zone clicks use the same picker; do not mount a second hidden input.
 */
export function resolveUploadFileControlAction(_currentMode: 'file' | 'paste'): {
  nextMode: 'file'
  openFilePicker: true
} {
  return { nextMode: 'file', openFilePicker: true }
}

/** Manual mapping override; clears the same spreadsheet column from other ALZA fields. */
export function applyOnboardingMappingChange(
  mapping: OnboardingMapping,
  fieldKey: string,
  header: string | undefined,
): OnboardingMapping {
  const next: OnboardingMapping = { ...mapping, [fieldKey]: header || undefined }
  if (header) {
    for (const key of Object.keys(next)) {
      if (key !== fieldKey && next[key] === header) {
        next[key] = undefined
      }
    }
  }
  return next
}

/** Owner/Admin only — CSR and Producer are blocked. */
export function canAccessOnboardingImport(role: RoleInput): boolean {
  return isAdminDirectoryRole(role)
}

/** Owner/Admin only for every entity type. */
export function canImportOnboardingEntity(role: RoleInput, _entity: OnboardingEntity): boolean {
  return isAdminDirectoryRole(role)
}

export function formatOnboardingStatus(status: OnboardingRowStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready to Import'
    case 'missing_required':
      return 'Missing Required'
    case 'invalid':
      return 'Invalid'
    case 'possible_duplicate':
      return 'Possible Duplicate'
    case 'skipped_duplicate':
      return 'Skipped (Duplicate)'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}

/** Lower number = higher severity (used when escalating / counting). */
export function statusPriority(status: OnboardingRowStatus): number {
  switch (status) {
    case 'failed':
      return 0
    case 'skipped_duplicate':
      // Existing ALZA rows win — surface duplicate over other validation noise.
      return 1
    case 'missing_required':
      return 2
    case 'invalid':
      return 3
    case 'possible_duplicate':
      return 4
    case 'ready':
      return 5
    default:
      return 99
  }
}

function escalateStatus(
  current: OnboardingRowStatus,
  next: OnboardingRowStatus,
): OnboardingRowStatus {
  return statusPriority(next) < statusPriority(current) ? next : current
}

function findHeaderMatch(
  normalized: Array<{ raw: string; matchKey: string }>,
  usedHeaders: Set<string>,
  needles: string[],
): { raw: string; matchKey: string } | undefined {
  const compactNeedles = needles.map(normalizeHeaderMatchKey).filter(Boolean)
  return normalized.find(
    (h) =>
      !usedHeaders.has(h.raw) &&
      h.matchKey &&
      compactNeedles.some((n) => n === h.matchKey),
  )
}

/**
 * Auto-map spreadsheet headers → ALZA fields.
 * Priority per field: (1) exact canonical key/label match (2) explicit alias (3) leave unmapped.
 * No fuzzy/includes matching. Each spreadsheet column maps to at most one ALZA field.
 */
export function suggestOnboardingMapping(
  entity: OnboardingEntity,
  headers: string[],
): OnboardingMapping {
  const mapping: OnboardingMapping = {}
  const aliases = FIELD_ALIASES[entity]
  const normalized = headers.map((h) => ({
    raw: h,
    matchKey: normalizeHeaderMatchKey(h),
  }))
  const usedHeaders = new Set<string>()

  for (const field of ONBOARDING_FIELDS[entity]) {
    const canonicalHit = findHeaderMatch(normalized, usedHeaders, [field.key, field.label])
    if (canonicalHit) {
      mapping[field.key] = canonicalHit.raw
      usedHeaders.add(canonicalHit.raw)
      continue
    }
    const aliasHit = findHeaderMatch(normalized, usedHeaders, aliases[field.key] ?? [])
    if (aliasHit) {
      mapping[field.key] = aliasHit.raw
      usedHeaders.add(aliasHit.raw)
    }
  }
  return mapping
}

/**
 * Exact UI-state contract after parse: headers + rows + auto-mapping object
 * that OnboardingImportWizard feeds into the mapping <select>s.
 */
export function buildOnboardingMappingUiState(
  entity: OnboardingEntity,
  parsed: { headers: string[]; rows: Record<string, unknown>[] },
): {
  headers: string[]
  rows: Record<string, unknown>[]
  mapping: OnboardingMapping
} {
  return {
    headers: parsed.headers,
    rows: parsed.rows,
    mapping: suggestOnboardingMapping(entity, parsed.headers),
  }
}

/** Per-field select contract actually rendered on the mapping step. */
export interface OnboardingMappingSelectRow {
  fieldKey: string
  label: string
  required: boolean
  /** Controlled <select value>; empty string means “— Not mapped —”. */
  value: string
  /** <option value> list (spreadsheet headers). */
  options: string[]
}

export function buildOnboardingMappingSelectModel(
  entity: OnboardingEntity,
  mapping: OnboardingMapping,
  headers: string[],
): OnboardingMappingSelectRow[] {
  return ONBOARDING_FIELDS[entity].map((field) => ({
    fieldKey: field.key,
    label: field.label,
    required: field.required,
    value: mapping[field.key] ?? '',
    options: headers,
  }))
}

/**
 * Same transition the wizard runs in applyParsed → mapping step render.
 * Returns mapping state AND the select values that must appear selected.
 */
export function runOnboardingParseToMappingStep(
  entity: OnboardingEntity,
  parsed: { headers: string[]; rows: Record<string, unknown>[] },
): {
  step: 3
  headers: string[]
  rows: Record<string, unknown>[]
  mapping: OnboardingMapping
  selects: OnboardingMappingSelectRow[]
} {
  const ui = buildOnboardingMappingUiState(entity, parsed)
  return {
    step: 3,
    headers: ui.headers,
    rows: ui.rows,
    mapping: ui.mapping,
    selects: buildOnboardingMappingSelectModel(entity, ui.mapping, ui.headers),
  }
}

export function requiredFieldsMapped(
  entity: OnboardingEntity,
  mapping: OnboardingMapping,
): { ok: boolean; missing: string[] } {
  const missing = ONBOARDING_FIELDS[entity]
    .filter((f) => f.required && !mapping[f.key])
    .map((f) => f.label)
  return { ok: missing.length === 0, missing }
}

function cell(row: Record<string, unknown>, mapping: OnboardingMapping, key: string): unknown {
  const header = mapping[key]
  if (!header) return null
  return row[header]
}

function text(row: Record<string, unknown>, mapping: OnboardingMapping, key: string): string {
  return String(cell(row, mapping, key) ?? '').trim()
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function normalizeClientNumber(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/** Agency commission % helper (Excel may store 0.15 for 15%). */
function parsePercent(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value <= 1) return roundMoney(value * 100)
    return roundMoney(value)
  }
  const raw = String(value).trim().replace(/%/g, '')
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n > 0 && n <= 1 && !String(value).includes('%')) return roundMoney(n * 100)
  return roundMoney(n)
}

export interface OnboardingPreviewRow {
  rowIndex: number
  status: OnboardingRowStatus
  reasons: string[]
  display: Record<string, string>
  payload: Record<string, unknown>
}

export interface OnboardingPreviewResult {
  entity: OnboardingEntity
  total: number
  ready: number
  skippedDuplicate: number
  missingRequired: number
  invalid: number
  possibleDuplicate: number
  rows: OnboardingPreviewRow[]
}

export interface OnboardingLookupCaches {
  clientsByName: Map<string, { id: string; businessName: string }[]>
  clientsByNumber: Map<string, { id: string; clientNumber: string }[]>
  carriersByName: Map<string, string[]>
  mgasByName: Map<string, string[]>
  producersByName: Map<string, string[]>
  producersByEmail: Map<string, string[]>
  csrsByName: Map<string, string[]>
  csrsByEmail: Map<string, string[]>
  policiesByClientPolicy: Set<string>
}

export function emptyOnboardingCaches(): OnboardingLookupCaches {
  return {
    clientsByName: new Map(),
    clientsByNumber: new Map(),
    carriersByName: new Map(),
    mgasByName: new Map(),
    producersByName: new Map(),
    producersByEmail: new Map(),
    csrsByName: new Map(),
    csrsByEmail: new Map(),
    policiesByClientPolicy: new Set(),
  }
}

async function loadLookupCaches(): Promise<OnboardingLookupCaches> {
  // Include archived records for duplicate safety (do NOT filter archived_at IS NULL).
  const [clients, carriers, mgas, producers, csrs, policies] = await Promise.all([
    supabase.from('clients').select('id, business_name, client_number'),
    supabase.from('carriers').select('carrier_name'),
    supabase.from('mgas').select('mga_name'),
    supabase.from('producers').select('producer_name, email'),
    supabase.from('csrs').select('csr_name, email'),
    supabase.from('policies').select('client_id, policy_number'),
  ])

  const caches = emptyOnboardingCaches()

  for (const row of clients.data ?? []) {
    const name = String(row.business_name ?? '').trim()
    if (name) {
      const key = normalizeName(name)
      const list = caches.clientsByName.get(key) ?? []
      list.push({ id: String(row.id), businessName: name })
      caches.clientsByName.set(key, list)
    }
    const clientNumber = String(row.client_number ?? '').trim()
    if (clientNumber) {
      const key = normalizeClientNumber(clientNumber)
      const list = caches.clientsByNumber.get(key) ?? []
      list.push({ id: String(row.id), clientNumber })
      caches.clientsByNumber.set(key, list)
    }
  }

  function pushName(map: Map<string, string[]>, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const key = normalizeName(trimmed)
    const list = map.get(key) ?? []
    list.push(trimmed)
    map.set(key, list)
  }

  function pushEmail(map: Map<string, string[]>, email: string, label: string) {
    const key = normalizeEmail(email)
    if (!key) return
    const list = map.get(key) ?? []
    list.push(label)
    map.set(key, list)
  }

  for (const row of carriers.data ?? []) {
    pushName(caches.carriersByName, String(row.carrier_name ?? ''))
  }
  for (const row of mgas.data ?? []) {
    pushName(caches.mgasByName, String(row.mga_name ?? ''))
  }
  for (const row of producers.data ?? []) {
    const name = String(row.producer_name ?? '')
    pushName(caches.producersByName, name)
    pushEmail(caches.producersByEmail, String(row.email ?? ''), name.trim() || String(row.email ?? ''))
  }
  for (const row of csrs.data ?? []) {
    const name = String(row.csr_name ?? '')
    pushName(caches.csrsByName, name)
    pushEmail(caches.csrsByEmail, String(row.email ?? ''), name.trim() || String(row.email ?? ''))
  }

  for (const row of policies.data ?? []) {
    caches.policiesByClientPolicy.add(
      `${row.client_id}::${String(row.policy_number ?? '').trim().toLowerCase()}`,
    )
  }

  return caches
}

function resolveUniqueName(
  map: Map<string, string[]>,
  value: string,
  label: string,
):
  | { ok: true; name: string }
  | { ok: false; reason: string }
  | { ok: true; name: ''; empty: true } {
  if (!value.trim()) return { ok: true, name: '', empty: true }
  const hits = map.get(normalizeName(value)) ?? []
  if (hits.length === 0) return { ok: false, reason: `Unknown ${label}: “${value.trim()}”.` }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: `Ambiguous ${label}: “${value.trim()}” matches ${hits.length} records.`,
    }
  }
  return { ok: true, name: hits[0] }
}

function parsePolicyStatus(raw: string): PolicyStatusValue {
  const v = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if ((POLICY_STATUSES as readonly string[]).includes(v)) return v as PolicyStatusValue
  if (!v) return 'pending'
  if (v === 'renewal due' || v === 'renewal') return 'renewal_due'
  return 'pending'
}

function mark(
  state: { status: OnboardingRowStatus; reasons: string[] },
  next: OnboardingRowStatus,
  reason: string,
) {
  state.status = escalateStatus(state.status, next)
  state.reasons.push(reason)
}

function countPreview(rows: OnboardingPreviewRow[], entity: OnboardingEntity): OnboardingPreviewResult {
  return {
    entity,
    total: rows.length,
    ready: rows.filter((r) => r.status === 'ready').length,
    skippedDuplicate: rows.filter((r) => r.status === 'skipped_duplicate').length,
    missingRequired: rows.filter((r) => r.status === 'missing_required').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    possibleDuplicate: rows.filter((r) => r.status === 'possible_duplicate').length,
    rows,
  }
}

/** Pure pipeline (no network) — evaluate mapped rows against lookup caches. */
export function evaluateOnboardingRows(input: {
  entity: OnboardingEntity
  rows: Record<string, unknown>[]
  mapping: OnboardingMapping
  caches: OnboardingLookupCaches
}): OnboardingPreviewResult {
  const previewRows: OnboardingPreviewRow[] = []
  const seenInFile = new Set<string>()

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i]
    const state: { status: OnboardingRowStatus; reasons: string[] } = {
      status: 'ready',
      reasons: [],
    }
    const display: Record<string, string> = {}
    const payload: Record<string, unknown> = {}

    if (input.entity === 'clients') {
      const businessName = text(row, input.mapping, 'business_name')
      const clientNumber = text(row, input.mapping, 'client_number')
      display['Business Name'] = businessName
      if (clientNumber) display['Client Number'] = clientNumber

      if (!businessName) {
        mark(state, 'missing_required', 'Business Name is required.')
      }

      payload.businessName = businessName
      payload.clientNumber = clientNumber
      payload.dba = text(row, input.mapping, 'dba')
      payload.fein = text(row, input.mapping, 'fein')
      payload.contactName = text(row, input.mapping, 'contact_name')
      payload.email = text(row, input.mapping, 'email')
      payload.phone = text(row, input.mapping, 'phone')
      payload.producer = text(row, input.mapping, 'producer')
      payload.csr = text(row, input.mapping, 'csr')
      payload.status = text(row, input.mapping, 'status') || 'active'
      payload.mailingAddress = text(row, input.mapping, 'mailing_address')
      payload.physicalAddress = text(row, input.mapping, 'physical_address')
      payload.notes = text(row, input.mapping, 'notes')

      if (businessName) {
        const nameHits = input.caches.clientsByName.get(normalizeName(businessName)) ?? []
        if (nameHits.length >= 1) {
          mark(state, 'skipped_duplicate', 'Client already exists (matching Business Name, including archived).')
          payload.existingId = nameHits[0].id
        }
        const fileNameKey = `client::name::${normalizeName(businessName)}`
        if (seenInFile.has(fileNameKey)) {
          mark(state, 'possible_duplicate', 'Duplicate Business Name within this file.')
        }
        seenInFile.add(fileNameKey)
      }

      if (clientNumber) {
        const numHits = input.caches.clientsByNumber.get(normalizeClientNumber(clientNumber)) ?? []
        if (numHits.length >= 1) {
          mark(
            state,
            'skipped_duplicate',
            'Client Number already exists (exact match, including archived).',
          )
          payload.existingId = payload.existingId ?? numHits[0].id
        }
        const fileNumKey = `client::number::${normalizeClientNumber(clientNumber)}`
        if (seenInFile.has(fileNumKey)) {
          mark(state, 'possible_duplicate', 'Duplicate Client Number within this file.')
        }
        seenInFile.add(fileNumKey)
      }
    }

    if (input.entity === 'carriers') {
      const carrierName = text(row, input.mapping, 'carrier_name')
      display['Carrier Name'] = carrierName
      if (!carrierName) {
        mark(state, 'missing_required', 'Carrier Name is required.')
      } else {
        const hits = input.caches.carriersByName.get(normalizeName(carrierName)) ?? []
        if (hits.length >= 1) {
          mark(state, 'skipped_duplicate', 'Carrier already exists (including archived).')
        }
        const fileKey = `carrier::${normalizeName(carrierName)}`
        if (seenInFile.has(fileKey)) {
          mark(state, 'possible_duplicate', 'Duplicate Carrier Name within this file.')
        }
        seenInFile.add(fileKey)
      }
      payload.carrierName = carrierName
      payload.naic = text(row, input.mapping, 'naic')
      payload.status = text(row, input.mapping, 'status') || 'active'
      payload.appointmentStatus = text(row, input.mapping, 'appointment_status')
      payload.billingType = text(row, input.mapping, 'billing_type')
      payload.linesOfBusiness = text(row, input.mapping, 'lines_of_business')
      payload.notes = text(row, input.mapping, 'notes')
    }

    if (input.entity === 'mgas') {
      const mgaName = text(row, input.mapping, 'mga_name')
      display['MGA Name'] = mgaName
      if (!mgaName) {
        mark(state, 'missing_required', 'MGA Name is required.')
      } else {
        const hits = input.caches.mgasByName.get(normalizeName(mgaName)) ?? []
        if (hits.length >= 1) {
          mark(state, 'skipped_duplicate', 'MGA already exists (including archived).')
        }
        const fileKey = `mga::${normalizeName(mgaName)}`
        if (seenInFile.has(fileKey)) {
          mark(state, 'possible_duplicate', 'Duplicate MGA Name within this file.')
        }
        seenInFile.add(fileKey)
      }
      payload.mgaName = mgaName
      payload.contactPerson = text(row, input.mapping, 'contact_person')
      payload.email = text(row, input.mapping, 'email')
      payload.phone = text(row, input.mapping, 'phone')
      payload.status = text(row, input.mapping, 'status') || 'active'
      payload.states = text(row, input.mapping, 'states')
      payload.linesOfBusiness = text(row, input.mapping, 'lines_of_business')
      payload.notes = text(row, input.mapping, 'notes')
    }

    if (input.entity === 'producers') {
      const producerName = text(row, input.mapping, 'producer_name')
      const email = text(row, input.mapping, 'email')
      display['Producer Name'] = producerName
      if (email) display['Email'] = email

      if (!producerName) {
        mark(state, 'missing_required', 'Producer Name is required.')
      } else {
        const hits = input.caches.producersByName.get(normalizeName(producerName)) ?? []
        if (hits.length >= 1) {
          mark(state, 'skipped_duplicate', 'Producer already exists (matching name, including archived).')
        }
        const fileKey = `producer::name::${normalizeName(producerName)}`
        if (seenInFile.has(fileKey)) {
          mark(state, 'possible_duplicate', 'Duplicate Producer Name within this file.')
        }
        seenInFile.add(fileKey)
      }

      if (email) {
        const emailHits = input.caches.producersByEmail.get(normalizeEmail(email)) ?? []
        if (emailHits.length >= 1) {
          mark(state, 'skipped_duplicate', 'Producer email already exists (including archived).')
        }
        const fileEmailKey = `producer::email::${normalizeEmail(email)}`
        if (seenInFile.has(fileEmailKey)) {
          mark(state, 'possible_duplicate', 'Duplicate Producer email within this file.')
        }
        seenInFile.add(fileEmailKey)
      }

      const splitRaw = text(row, input.mapping, 'default_split_percentage')
      let defaultSplit: number | null = null
      if (splitRaw || typeof cell(row, input.mapping, 'default_split_percentage') === 'number') {
        const splitErr = validateProducerSplitPercentage(
          typeof cell(row, input.mapping, 'default_split_percentage') === 'number'
            ? (cell(row, input.mapping, 'default_split_percentage') as number)
            : splitRaw,
        )
        if (splitErr) {
          mark(state, 'invalid', 'Default Split % is invalid.')
        } else {
          const rawCell = cell(row, input.mapping, 'default_split_percentage')
          defaultSplit =
            typeof rawCell === 'number' && Number.isFinite(rawCell)
              ? rawCell
              : Number(splitRaw)
        }
      }

      payload.producerName = producerName
      payload.email = email
      payload.phone = text(row, input.mapping, 'phone')
      payload.licenseNumber = text(row, input.mapping, 'license_number')
      payload.defaultSplitPercentage = defaultSplit
      payload.status = text(row, input.mapping, 'status') || 'active'
      payload.notes = text(row, input.mapping, 'notes')
    }

    if (input.entity === 'csrs') {
      const csrName = text(row, input.mapping, 'csr_name')
      const email = text(row, input.mapping, 'email')
      display['CSR Name'] = csrName
      if (email) display['Email'] = email

      if (!csrName) {
        mark(state, 'missing_required', 'CSR Name is required.')
      } else {
        const hits = input.caches.csrsByName.get(normalizeName(csrName)) ?? []
        if (hits.length >= 1) {
          mark(state, 'skipped_duplicate', 'CSR already exists (matching name, including archived).')
        }
        const fileKey = `csr::name::${normalizeName(csrName)}`
        if (seenInFile.has(fileKey)) {
          mark(state, 'possible_duplicate', 'Duplicate CSR Name within this file.')
        }
        seenInFile.add(fileKey)
      }

      if (email) {
        const emailHits = input.caches.csrsByEmail.get(normalizeEmail(email)) ?? []
        if (emailHits.length >= 1) {
          mark(state, 'skipped_duplicate', 'CSR email already exists (including archived).')
        }
        const fileEmailKey = `csr::email::${normalizeEmail(email)}`
        if (seenInFile.has(fileEmailKey)) {
          mark(state, 'possible_duplicate', 'Duplicate CSR email within this file.')
        }
        seenInFile.add(fileEmailKey)
      }

      payload.csrName = csrName
      payload.email = email
      payload.phone = text(row, input.mapping, 'phone')
      payload.status = text(row, input.mapping, 'status') || 'active'
      payload.notes = text(row, input.mapping, 'notes')
    }

    if (input.entity === 'policies') {
      const clientName = text(row, input.mapping, 'client_name')
      const policyNumber = text(row, input.mapping, 'policy_number')

      if (!clientName) {
        mark(state, 'missing_required', 'Client Name is required.')
      }
      if (!policyNumber) {
        mark(state, 'missing_required', 'Policy Number is required.')
      }

      let clientId: string | null = null
      if (clientName) {
        const hits = input.caches.clientsByName.get(normalizeName(clientName)) ?? []
        if (hits.length === 0) {
          mark(
            state,
            'invalid',
            `Unknown client: “${clientName}”. Import or create the client first.`,
          )
        } else if (hits.length > 1) {
          mark(
            state,
            'invalid',
            `Ambiguous client: “${clientName}” matches ${hits.length} records.`,
          )
        } else {
          clientId = hits[0].id
        }
      }

      const carrierRaw = text(row, input.mapping, 'carrier')
      const mgaRaw = text(row, input.mapping, 'mga')
      const producerRaw = text(row, input.mapping, 'producer')
      const csrRaw = text(row, input.mapping, 'csr')

      let carrier = ''
      let mga = ''
      let producer = ''
      let csr = ''

      if (carrierRaw) {
        const r = resolveUniqueName(input.caches.carriersByName, carrierRaw, 'Carrier')
        if (!r.ok) mark(state, 'invalid', r.reason)
        else if (!('empty' in r)) carrier = r.name
      }
      if (mgaRaw) {
        const r = resolveUniqueName(input.caches.mgasByName, mgaRaw, 'MGA')
        if (!r.ok) mark(state, 'invalid', r.reason)
        else if (!('empty' in r)) mga = r.name
      }
      if (producerRaw) {
        const r = resolveUniqueName(input.caches.producersByName, producerRaw, 'Producer')
        if (!r.ok) mark(state, 'invalid', r.reason)
        else if (!('empty' in r)) producer = r.name
      }
      if (csrRaw) {
        const r = resolveUniqueName(input.caches.csrsByName, csrRaw, 'CSR')
        if (!r.ok) mark(state, 'invalid', r.reason)
        else if (!('empty' in r)) csr = r.name
      }

      const effRaw = cell(row, input.mapping, 'effective_date')
      const expRaw = cell(row, input.mapping, 'expiration_date')
      const effectiveDate = text(row, input.mapping, 'effective_date')
        ? parseIsoDate(effRaw)
        : null
      const expirationDate = text(row, input.mapping, 'expiration_date')
        ? parseIsoDate(expRaw)
        : null
      if (text(row, input.mapping, 'effective_date') && !effectiveDate) {
        mark(state, 'invalid', 'Effective Date is invalid.')
      }
      if (text(row, input.mapping, 'expiration_date') && !expirationDate) {
        mark(state, 'invalid', 'Expiration Date is invalid.')
      }

      // Current Policy Premium → policies.premium via createPolicy (Add Policy leaves 0).
      const premiumRaw = cell(row, input.mapping, 'reference_premium')
      const premiumText = text(row, input.mapping, 'reference_premium')
      const premiumMapped = Boolean(input.mapping.reference_premium)
      let policyPremium: number | null = null
      if (premiumMapped && (premiumText || typeof premiumRaw === 'number')) {
        const parsed = parseMoney(premiumRaw)
        if (parsed === null || parsed < 0) {
          mark(state, 'invalid', 'Current Policy Premium is invalid.')
        } else {
          policyPremium = parsed
          state.reasons.push(REFERENCE_PREMIUM_PERSIST_NOTE)
        }
      } else if (premiumMapped && !premiumText && !(typeof premiumRaw === 'number')) {
        // Mapped but blank — treat as 0 reference, still optional.
        policyPremium = 0
      }

      const pctMapped = Boolean(input.mapping.agency_commission_percentage)
      const amtMapped = Boolean(input.mapping.agency_commission_amount)
      const typeRaw = text(row, input.mapping, 'commission_type').toLowerCase()
      const pct = parsePercent(cell(row, input.mapping, 'agency_commission_percentage'))
      const amt = parseMoney(cell(row, input.mapping, 'agency_commission_amount'))
      let commissionType: 'percentage' | 'flat' | null = null
      if (typeRaw.includes('flat') || typeRaw === 'amount') commissionType = 'flat'
      else if (typeRaw.includes('percent') || typeRaw === '%' || typeRaw === 'percentage') {
        commissionType = 'percentage'
      } else if (pctMapped && pct !== null && !(amtMapped && amt !== null)) {
        commissionType = 'percentage'
      } else if (amtMapped && amt !== null && !(pctMapped && pct !== null)) {
        commissionType = 'flat'
      } else if (pctMapped && pct !== null) {
        commissionType = 'percentage'
      }

      if (!commissionType) {
        mark(
          state,
          'missing_required',
          'Agency commission is required (map Agency Commission % or Agency Commission Amount, or Commission Type).',
        )
      } else if (commissionType === 'percentage') {
        if (pct === null || pct < 0) {
          mark(state, 'missing_required', 'Agency Commission % is required and must be zero or greater.')
        }
      } else if (amt === null) {
        mark(state, 'missing_required', 'Agency Commission Amount is required for flat commission.')
      }

      // Producer Split: blank = missing_required; never default to 60 or 0.
      // Excel may store 0.6 for 60% — parsePercent normalizes, then shared validator runs.
      const splitCell = cell(row, input.mapping, 'producer_split_percentage')
      const splitMapped = Boolean(input.mapping.producer_split_percentage)
      const splitText = text(row, input.mapping, 'producer_split_percentage')
      const splitBlank =
        splitMapped &&
        !splitText &&
        !(typeof splitCell === 'number' && Number.isFinite(splitCell))
      let producerSplitPercentage: number | null = null
      if (!splitMapped || splitBlank) {
        mark(state, 'missing_required', PRODUCER_SPLIT_REQUIRED_MESSAGE)
      } else {
        const parsedSplit = parsePercent(splitCell)
        if (parsedSplit === null) {
          mark(state, 'invalid', PRODUCER_SPLIT_REQUIRED_MESSAGE)
        } else {
          const splitErr = validateProducerSplitPercentage(parsedSplit)
          if (splitErr) {
            mark(state, 'invalid', splitErr)
          } else {
            producerSplitPercentage = parsedSplit
          }
        }
      }

      const brokerFeeRaw = cell(row, input.mapping, 'broker_fee')
      let brokerFee = 0
      if (text(row, input.mapping, 'broker_fee') || typeof brokerFeeRaw === 'number') {
        const n = parseMoney(brokerFeeRaw)
        if (n === null) {
          mark(state, 'invalid', 'Default Broker Fee is invalid.')
        } else brokerFee = n
      }

      const statusRaw = text(row, input.mapping, 'status')
      const status = parsePolicyStatus(statusRaw)
      if (
        statusRaw &&
        !(POLICY_STATUSES as readonly string[]).includes(status) &&
        normalizeName(statusRaw) !== normalizeName(status.replace(/_/g, ' '))
      ) {
        const known = [
          'active',
          'pending',
          'expired',
          'cancelled',
          'renewal_due',
          'renewal due',
          'renewal',
        ]
        if (!known.includes(normalizeName(statusRaw))) {
          mark(state, 'invalid', `Unrecognized policy status “${statusRaw}”.`)
        }
      }

      if (clientId && policyNumber) {
        const key = `${clientId}::${policyNumber.toLowerCase()}`
        if (input.caches.policiesByClientPolicy.has(key)) {
          mark(
            state,
            'skipped_duplicate',
            'Policy already exists for this client (including archived).',
          )
        }
        const fileKey = `policy::${key}`
        if (seenInFile.has(fileKey)) {
          mark(
            state,
            'possible_duplicate',
            'Duplicate policy number for the same client within this file.',
          )
        }
        seenInFile.add(fileKey)
      } else if (clientName && policyNumber) {
        const fileKey = `policy::name::${normalizeName(clientName)}::${policyNumber.toLowerCase()}`
        if (seenInFile.has(fileKey)) {
          mark(
            state,
            'possible_duplicate',
            'Duplicate policy number for the same client within this file.',
          )
        }
        seenInFile.add(fileKey)
      }

      const policyType = text(row, input.mapping, 'policy_type')
      const notes = text(row, input.mapping, 'notes')

      payload.clientId = clientId
      payload.clientName = clientName
      payload.policyNumber = policyNumber
      payload.policyType = policyType
      payload.carrier = carrier
      payload.mga = mga
      payload.producer = producer
      payload.csr = csr
      payload.effectiveDate = effectiveDate ?? ''
      payload.expirationDate = expirationDate ?? ''
      payload.premium = policyPremium
      payload.commissionType = commissionType
      payload.agencyCommissionPercentage = pct
      payload.agencyCommissionAmount = amt
      payload.producerSplitPercentage = producerSplitPercentage
      payload.brokerFee = brokerFee
      payload.status = status
      payload.notes = notes

      display['Client'] = clientName
      display['Policy Number'] = policyNumber
      display['Policy Type'] = policyType
      display['Carrier'] = carrier || carrierRaw
      display['MGA'] = mga || mgaRaw
      display['Effective Date'] = effectiveDate ?? ''
      display['Expiration Date'] = expirationDate ?? ''
      if (policyPremium !== null) {
        display['Current Policy Premium'] = String(policyPremium)
      }
      if (commissionType === 'percentage' && pct !== null) {
        display['Agency Commission %'] = String(pct)
      } else if (commissionType === 'flat' && amt !== null) {
        display['Agency Commission Amount'] = String(amt)
      }
      display['Producer'] = producer || producerRaw
      if (producerSplitPercentage !== null) {
        display['Producer Split %'] = String(producerSplitPercentage)
      }
      display['CSR'] = csr || csrRaw
      display['Status'] = status
      if (notes) display['Notes'] = notes
    }

    previewRows.push({
      rowIndex: i + 1,
      status: state.status,
      reasons: state.reasons,
      display,
      payload,
    })
  }

  return countPreview(previewRows, input.entity)
}

export async function buildOnboardingPreview(input: {
  entity: OnboardingEntity
  rows: Record<string, unknown>[]
  mapping: OnboardingMapping
}): Promise<{ data: OnboardingPreviewResult | null; error: string | null }> {
  const authz = await rejectUnlessRole(
    (role) => canImportOnboardingEntity(role, input.entity),
    'You do not have permission to import this data type.',
  )
  if (!authz.ok) return { data: null, error: authz.message }

  const mapped = requiredFieldsMapped(input.entity, input.mapping)
  if (!mapped.ok) {
    return { data: null, error: `Map required fields first: ${mapped.missing.join(', ')}.` }
  }

  const caches = await loadLookupCaches()
  return {
    data: evaluateOnboardingRows({
      entity: input.entity,
      rows: input.rows,
      mapping: input.mapping,
      caches,
    }),
    error: null,
  }
}

export function planOnboardingInsert(preview: OnboardingPreviewResult): OnboardingPreviewRow[] {
  return preview.rows.filter((r) => r.status === 'ready')
}

/** Allocate sequential ALZA-###### numbers after the highest existing ALZA-n value. */
export function allocateNextClientNumbers(existingNumbers: string[], count: number): string[] {
  let max = 0
  for (const value of existingNumbers) {
    const match = String(value ?? '').match(/^ALZA-(\d+)$/i)
    if (match) max = Math.max(max, parseInt(match[1], 10))
  }
  return Array.from({ length: count }, (_, i) => `ALZA-${String(max + 1 + i).padStart(6, '0')}`)
}

async function nextClientNumbers(count: number): Promise<string[]> {
  const { data, error } = await supabase.from('clients').select('client_number')
  if (error) throw new Error(error.message)
  return allocateNextClientNumbers(
    (data ?? []).map((row) => String(row.client_number ?? '')),
    count,
  )
}

export interface OnboardingImportResult {
  imported: number
  skippedDuplicate: number
  skippedValidation: number
  failed: number
  errors: string[]
  rowResults?: Array<{ rowIndex: number; status: string; message: string }>
}

const BATCH = 40

export type OnboardingWriteResult = {
  data?: { id: string } | null
  error?: { message: string } | null
}

/** Injectable writers for regression tests (production uses directory create*). */
export type OnboardingInsertDeps = {
  /** Test-only: skip Supabase role check. */
  bypassAuth?: boolean
  /** Test-only: skip activity log write. */
  skipActivity?: boolean
  createMga?: (input: {
    mgaName: string
    contactPerson: string
    email: string
    phone: string
    status: string
    states: string
    linesOfBusiness: string
    notes: string
  }) => Promise<OnboardingWriteResult>
  createCarrier?: (input: {
    carrierName: string
    naic: string
    status: string
    appointmentStatus: string
    billingType: string
    linesOfBusiness: string
    notes: string
  }) => Promise<OnboardingWriteResult>
  createPolicy?: (input: {
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
    commissionType: 'percentage' | 'flat'
    agencyCommissionPercentage: number | null
    agencyCommissionAmount: number | null
    producerSplitPercentage: number
    brokerFee?: number
    premium?: number | null
  }) => Promise<OnboardingWriteResult>
}

function writeErrorMessage(result: OnboardingWriteResult): string {
  return result.error?.message || 'Insert returned no row id.'
}

function countSuccessfulWrite(result: OnboardingWriteResult): boolean {
  return Boolean(result.data?.id) && !result.error
}

/** Directory list shape for an MGA row (matches Administration > MGAs mapping). */
export function toMgaDirectoryRow(input: {
  id: string
  mgaName: string
  contactPerson?: string
  email?: string
  phone?: string
  states?: string
  linesOfBusiness?: string
  status?: string
  notes?: string
  archivedAt?: string | null
}) {
  return {
    id: input.id,
    name: String(input.mgaName ?? '').trim() || '—',
    contactPerson: String(input.contactPerson ?? '').trim(),
    email: String(input.email ?? '').trim(),
    phone: String(input.phone ?? '').trim(),
    states: String(input.states ?? '').trim(),
    linesOfBusiness: String(input.linesOfBusiness ?? '').trim(),
    status: String(input.status ?? 'active').trim() || 'active',
    notes: String(input.notes ?? '').trim(),
    archivedAt: input.archivedAt ?? null,
  }
}

export function isMgaDirectoryVisible(row: { archivedAt?: string | null }): boolean {
  return row.archivedAt == null
}

export async function executeOnboardingImport(input: {
  entity: OnboardingEntity
  preview: OnboardingPreviewResult
  deps?: OnboardingInsertDeps
}): Promise<{ data: OnboardingImportResult | null; error: string | null }> {
  // Preview entity is the source of truth — prevents carrier writes when UI says MGAs.
  const entity = input.preview.entity
  if (input.entity !== entity) {
    return {
      data: null,
      error: `Import entity mismatch: selected “${ONBOARDING_ENTITY_LABELS[input.entity]}” but preview was built for “${ONBOARDING_ENTITY_LABELS[entity]}”. Re-run Preview & validate.`,
    }
  }

  if (!input.deps?.bypassAuth) {
    const authz = await rejectUnlessRole(
      (role) => canImportOnboardingEntity(role, entity),
      'You do not have permission to import this data type.',
    )
    if (!authz.ok) return { data: null, error: authz.message }
  }

  const ready = planOnboardingInsert(input.preview)
  const skippedDuplicate = input.preview.rows.filter(
    (r) => r.status === 'skipped_duplicate',
  ).length
  const skippedValidation = input.preview.rows.filter((r) =>
    r.status === 'missing_required' ||
    r.status === 'invalid' ||
    r.status === 'possible_duplicate',
  ).length
  const errors: string[] = []
  const rowResults: Array<{ rowIndex: number; status: string; message: string }> = []
  let imported = 0
  let failed = 0

  const createMgaFn = input.deps?.createMga ?? createMga
  const createCarrierFn = input.deps?.createCarrier ?? createCarrier
  const createPolicyFn = input.deps?.createPolicy ?? createPolicy

  if (entity === 'clients') {
    const needGenerated = ready.filter((r) => !String(r.payload.clientNumber ?? '').trim())
    let generated: string[] = []
    try {
      generated = await nextClientNumbers(needGenerated.length)
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e.message : 'Unable to allocate client numbers.',
      }
    }
    let genIdx = 0
    for (let i = 0; i < ready.length; i += BATCH) {
      const chunk = ready.slice(i, i + BATCH)
      for (const row of chunk) {
        const p = row.payload
        const provided = String(p.clientNumber ?? '').trim()
        const clientNumber = provided || generated[genIdx++]
        const result = await createClient({
          clientNumber,
          businessName: String(p.businessName ?? ''),
          dba: String(p.dba ?? ''),
          fein: String(p.fein ?? ''),
          contactName: String(p.contactName ?? ''),
          email: String(p.email ?? ''),
          phone: String(p.phone ?? ''),
          mailingAddress: String(p.mailingAddress ?? ''),
          physicalAddress: String(p.physicalAddress ?? ''),
          producer: String(p.producer ?? ''),
          csr: String(p.csr ?? ''),
          status: String(p.status ?? 'active'),
          renewalMonth: null,
          renewalDay: null,
          notes: String(p.notes ?? ''),
        })
        if (result.error) {
          failed += 1
          const message = result.error.message
          errors.push(`Row ${row.rowIndex}: ${message}`)
          rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
        } else {
          imported += 1
          rowResults.push({
            rowIndex: row.rowIndex,
            status: 'imported',
            message: `Created client ${clientNumber}`,
          })
        }
      }
    }
  }

  if (entity === 'carriers') {
    for (const row of ready) {
      const p = row.payload
      if (!String(p.carrierName ?? '').trim()) {
        failed += 1
        const message = 'Carrier Name missing from ready payload (entity/mapping mismatch).'
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
        continue
      }
      const result = await createCarrierFn({
        carrierName: String(p.carrierName ?? ''),
        naic: String(p.naic ?? ''),
        status: String(p.status ?? 'active'),
        appointmentStatus: String(p.appointmentStatus ?? ''),
        billingType: String(p.billingType ?? ''),
        linesOfBusiness: String(p.linesOfBusiness ?? ''),
        notes: String(p.notes ?? ''),
      })
      if (!countSuccessfulWrite(result)) {
        failed += 1
        const message = writeErrorMessage(result)
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
      } else {
        imported += 1
        rowResults.push({ rowIndex: row.rowIndex, status: 'imported', message: 'Created carrier' })
      }
    }
  }

  if (entity === 'mgas') {
    for (const row of ready) {
      const p = row.payload
      if (!String(p.mgaName ?? '').trim()) {
        failed += 1
        const message =
          'MGA Name missing from ready payload (entity/mapping mismatch). Re-select MGAs and re-run Preview.'
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
        continue
      }
      const result = await createMgaFn({
        mgaName: String(p.mgaName ?? ''),
        contactPerson: String(p.contactPerson ?? ''),
        email: String(p.email ?? ''),
        phone: String(p.phone ?? ''),
        status: String(p.status ?? 'active'),
        states: String(p.states ?? ''),
        linesOfBusiness: String(p.linesOfBusiness ?? ''),
        notes: String(p.notes ?? ''),
      })
      if (!countSuccessfulWrite(result)) {
        failed += 1
        const message = writeErrorMessage(result)
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
      } else {
        imported += 1
        rowResults.push({ rowIndex: row.rowIndex, status: 'imported', message: 'Created MGA' })
      }
    }
  }

  if (entity === 'producers') {
    for (const row of ready) {
      const p = row.payload
      const result = await createProducer({
        producerName: String(p.producerName ?? ''),
        email: String(p.email ?? ''),
        phone: String(p.phone ?? ''),
        status: String(p.status ?? 'active'),
        notes: String(p.notes ?? ''),
        licenseNumber: String(p.licenseNumber ?? ''),
        defaultSplitPercentage:
          p.defaultSplitPercentage === null || p.defaultSplitPercentage === undefined
            ? null
            : Number(p.defaultSplitPercentage),
      })
      if (result.error) {
        failed += 1
        const message = result.error.message
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
      } else {
        imported += 1
        rowResults.push({
          rowIndex: row.rowIndex,
          status: 'imported',
          message: 'Created producer',
        })
      }
    }
  }

  if (entity === 'csrs') {
    for (const row of ready) {
      const p = row.payload
      const result = await createCsr({
        csrName: String(p.csrName ?? ''),
        email: String(p.email ?? ''),
        phone: String(p.phone ?? ''),
        status: String(p.status ?? 'active'),
        notes: String(p.notes ?? ''),
      })
      if (result.error) {
        failed += 1
        const message = result.error.message
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
      } else {
        imported += 1
        rowResults.push({ rowIndex: row.rowIndex, status: 'imported', message: 'Created CSR' })
      }
    }
  }

  if (entity === 'policies') {
    for (const row of ready) {
      const p = row.payload
      const commissionType = (p.commissionType as 'percentage' | 'flat') || 'percentage'
      const split = Number(p.producerSplitPercentage)
      if (!Number.isFinite(split)) {
        failed += 1
        const message = PRODUCER_SPLIT_REQUIRED_MESSAGE
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
        continue
      }
      if (!String(p.clientId ?? '').trim()) {
        failed += 1
        const message = 'Client could not be resolved to a production client id.'
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
        continue
      }
      const premium =
        p.premium === null || p.premium === undefined ? null : Number(p.premium)
      const result = await createPolicyFn({
        clientId: String(p.clientId ?? ''),
        policyNumber: String(p.policyNumber ?? ''),
        policyType: String(p.policyType ?? ''),
        carrier: String(p.carrier ?? ''),
        mga: String(p.mga ?? ''),
        producer: String(p.producer ?? ''),
        csr: String(p.csr ?? ''),
        effectiveDate: String(p.effectiveDate ?? ''),
        expirationDate: String(p.expirationDate ?? ''),
        status: (p.status as PolicyStatusValue) || 'pending',
        notes: String(p.notes ?? ''),
        commissionType,
        agencyCommissionPercentage:
          commissionType === 'percentage' ? Number(p.agencyCommissionPercentage) : null,
        agencyCommissionAmount:
          commissionType === 'flat' ? Number(p.agencyCommissionAmount) : null,
        producerSplitPercentage: split,
        brokerFee: Number(p.brokerFee ?? 0),
        premium,
      })
      if (!countSuccessfulWrite(result)) {
        failed += 1
        const message = writeErrorMessage(result)
        errors.push(`Row ${row.rowIndex}: ${message}`)
        rowResults.push({ rowIndex: row.rowIndex, status: 'failed', message })
      } else {
        imported += 1
        rowResults.push({ rowIndex: row.rowIndex, status: 'imported', message: 'Created policy' })
      }
    }
  }

  if (!input.deps?.skipActivity) {
    await recordActivity({
      action: 'onboarding_bulk_import',
      entityType: 'onboarding',
      entityId: entity,
      recordReference: entity,
      newValue: {
        imported,
        skippedDuplicate,
        skippedValidation,
        failed,
        total: input.preview.total,
      },
    })
  }

  return {
    data: {
      imported,
      skippedDuplicate,
      skippedValidation,
      failed,
      errors: errors.slice(0, 50),
      rowResults,
    },
    error: null,
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function buildOnboardingResultLogCsv(
  preview: OnboardingPreviewResult,
  result: OnboardingImportResult,
): string {
  const resultByRow = new Map<number, { status: string; message: string }>()
  for (const r of result.rowResults ?? []) {
    resultByRow.set(r.rowIndex, { status: r.status, message: r.message })
  }

  const lines = ['row,status,details,notes,result']
  for (const row of preview.rows) {
    const details = Object.entries(row.display)
      .map(([k, v]) => `${k}: ${v || '—'}`)
      .join(' · ')
    const notes = row.reasons.join(' ') || '—'
    const exec = resultByRow.get(row.rowIndex)
    let resultCol: string
    if (exec) {
      resultCol = `${exec.status}${exec.message ? `: ${exec.message}` : ''}`
    } else if (row.status === 'ready') {
      resultCol = 'not executed'
    } else if (row.status === 'skipped_duplicate') {
      resultCol = 'skipped_duplicate'
    } else {
      resultCol = 'skipped_validation'
    }
    lines.push(
      [
        String(row.rowIndex),
        formatOnboardingStatus(row.status),
        csvEscape(details),
        csvEscape(notes),
        csvEscape(resultCol),
      ].join(','),
    )
  }
  return lines.join('\n')
}

/** Deterministic unit checks for mapping / classification (no DB). */
export function runOnboardingMappingChecks(): Array<{
  id: string
  name: string
  passed: boolean
  detail: string
}> {
  const agencyHeaders = [
    'Insured',
    'Policy #',
    'Writing Co',
    'Wholesaler',
    'Agent',
    'Eff Date',
    'Exp Date',
    'Premium',
    'Comm %',
    'Producer Split %',
  ]
  const map = suggestOnboardingMapping('policies', agencyHeaders)
  const cases: Array<{ id: string; name: string; passed: boolean; detail: string }> = [
    {
      id: '1',
      name: 'Insured → Client Name',
      passed: map.client_name === 'Insured',
      detail: String(map.client_name),
    },
    {
      id: '2',
      name: 'Policy # → Policy Number',
      passed: map.policy_number === 'Policy #',
      detail: String(map.policy_number),
    },
    {
      id: '3',
      name: 'Writing Co → Carrier',
      passed: map.carrier === 'Writing Co',
      detail: String(map.carrier),
    },
    {
      id: '4',
      name: 'Wholesaler → MGA',
      passed: map.mga === 'Wholesaler',
      detail: String(map.mga),
    },
    {
      id: '5',
      name: 'Agent → Producer',
      passed: map.producer === 'Agent',
      detail: String(map.producer),
    },
    {
      id: '6',
      name: 'Premium → Current Policy Premium',
      passed: map.reference_premium === 'Premium',
      detail: String(map.reference_premium),
    },
    {
      id: '7',
      name: 'Comm % → Agency Commission %',
      passed: map.agency_commission_percentage === 'Comm %',
      detail: String(map.agency_commission_percentage),
    },
    {
      id: '8',
      name: 'ALZA template Clients Business Name maps',
      passed:
        suggestOnboardingMapping('clients', ['Business Name', 'Email']).business_name ===
        'Business Name',
      detail: 'Business Name',
    },
    {
      id: '9',
      name: 'CSR cannot access onboarding import',
      passed: !canAccessOnboardingImport('csr'),
      detail: 'csr blocked',
    },
    {
      id: '10',
      name: 'CSR cannot import any entity',
      passed:
        !canImportOnboardingEntity('csr', 'clients') &&
        !canImportOnboardingEntity('csr', 'policies') &&
        !canImportOnboardingEntity('csr', 'carriers'),
      detail: 'csr all entities blocked',
    },
    {
      id: '11',
      name: 'Producer blocked from onboarding import access',
      passed: !canAccessOnboardingImport('producer'),
      detail: 'producer blocked',
    },
    {
      id: '12',
      name: 'Owner can access and import',
      passed:
        canAccessOnboardingImport('owner') && canImportOnboardingEntity('owner', 'producers'),
      detail: 'owner allowed',
    },
    {
      id: '13',
      name: 'Producer Split % is required on policies',
      passed:
        ONBOARDING_FIELDS.policies.some(
          (f) => f.key === 'producer_split_percentage' && f.required,
        ),
      detail: 'producer_split_percentage required',
    },
    {
      id: '14',
      name: 'Client Number optional field present',
      passed: ONBOARDING_FIELDS.clients.some((f) => f.key === 'client_number' && !f.required),
      detail: 'client_number optional',
    },
  ]
  return cases
}
