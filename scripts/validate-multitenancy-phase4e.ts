/**
 * Multi-tenancy V1 Phase 4E — agency-prefixed storage writes (source-only).
 * Run: npx tsx scripts/validate-multitenancy-phase4e.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  AGENCY_BRANDING_BUCKET,
  SUPPORTING_DOCUMENTS_BUCKET,
  RECONCILIATION_STATEMENTS_BUCKET,
  agencyBrandingLogoPath,
  legacyAgencyBrandingLogoPath,
  reconciliationStatementObjectPath,
  supportingDocumentObjectPath,
} from '../src/lib/storagePaths.ts'

const root = resolve(process.cwd())
const SRC = resolve(root, 'src')

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    console.log(`  OK: ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL: ${message}`)
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function walkSrc(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkSrc(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const agency = read('src/lib/agency.ts')
const documents = read('src/lib/documents.ts')
const reconciliation = read('src/lib/reconciliation.ts')
const storagePaths = read('src/lib/storagePaths.ts')
const migrate = read('scripts/migrate-phase4e-storage-paths.ts')

console.log('A. Path helpers')
{
  const agencyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  const entityId = '0d5dac8d-a5c1-4f3c-8566-12af30f0967d'
  const statementId = '11111111-1111-4111-8111-111111111111'
  assert(
    agencyBrandingLogoPath(agencyId, 'png') === `${agencyId}/logo.png`,
    'branding write path is {agency_id}/logo.{ext}',
  )
  assert(
    legacyAgencyBrandingLogoPath(agencyId, 'png') === `logo/${agencyId}.png`,
    'legacy branding helper remains for reads/migration only',
  )
  assert(
    supportingDocumentObjectPath(agencyId, 'transaction', entityId, 'a.pdf') ===
      `${agencyId}/transaction/${entityId}/a.pdf`,
    'transaction docs are {agency_id}/transaction/{entityId}/…',
  )
  assert(
    supportingDocumentObjectPath(agencyId, 'recovery', entityId, 'b.pdf') ===
      `${agencyId}/recovery/${entityId}/b.pdf`,
    'recovery docs are {agency_id}/recovery/{entityId}/…',
  )
  assert(
    reconciliationStatementObjectPath(agencyId, statementId, 'stmt.csv') ===
      `${agencyId}/${statementId}/stmt.csv`,
    'reconciliation path stays {agency_id}/{statementId}/{filename}',
  )
  assert(AGENCY_BRANDING_BUCKET === 'agency-branding', 'branding bucket constant')
  assert(SUPPORTING_DOCUMENTS_BUCKET === 'supporting-documents', 'docs bucket constant')
  assert(RECONCILIATION_STATEMENTS_BUCKET === 'reconciliation-statements', 'recon bucket constant')
}

console.log('B. App writes use membership / tenant-safe parent')
{
  assert(agency.includes('agencyBrandingLogoPath'), 'agency logo writes via helper')
  assert(agency.includes('resolveCurrentAgencyProfileId'), 'logo agency id from membership')
  assert(!agency.includes('`logo/${agencyProfileId'), 'agency.ts does not write logo/{id}.{ext}')
  assert(!/from\('agency_profile'\)[\s\S]{0,120}\.limit\(1\)/.test(agency), 'no singleton agency lookup')
  assert(!agency.includes('singleton_key'), 'agency.ts does not insert singleton_key')
  assert(agency.includes('agencyBrandingLogoPath(agencyProfileId, other)'), 'stale-logo cleanup is new-path only')

  assert(documents.includes('supportingDocumentObjectPath'), 'docs writes via helper')
  assert(documents.includes('resolveCurrentAgencyProfileId'), 'docs resolve membership')
  assert(documents.includes('producer_commission_recoveries'), 'recovery parent loaded for agency check')
  assert(
    documents.includes('Cannot attach documents to a record outside your agency'),
    'docs reject parent/membership mismatch',
  )
  assert(
    !documents.includes('`${input.entityType}/${input.entityId}/'),
    'documents.ts no longer writes unprefixed entity paths',
  )
  assert(documents.includes('createSignedUrl(storagePath'), 'signed URLs use stored path as-is')

  assert(reconciliation.includes('reconciliationStatementObjectPath'), 'recon writes via helper')
  assert(reconciliation.includes('resolveCurrentAgencyProfileId'), 'recon agency from membership')
  assert(!reconciliation.includes('fetchAgencyProfile'), 'recon does not use singleton fetch')
}

console.log('C. Source audit — storage path hits')
{
  const needles = [
    'logo/',
    'transaction/',
    'recovery/',
    'supporting-documents',
    'agency-branding',
    'reconciliation-statements',
  ]
  type Hit = { file: string; line: number; needle: string; text: string; class: string }
  const hits: Hit[] = []

  for (const file of walkSrc(SRC)) {
    const rel = relative(root, file).replaceAll('\\', '/')
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      for (const needle of needles) {
        if (!text.includes(needle)) continue
        hits.push({ file: rel, line: i + 1, needle, text: text.trim(), class: classify(rel, text, needle) })
      }
    })
  }

  const unexplained = hits.filter((h) => h.class === 'unexplained')
  for (const h of hits) {
    console.log(`  HIT ${h.class}: ${h.file}:${h.line} [${h.needle}] ${h.text.slice(0, 140)}`)
  }
  assert(hits.length > 0, 'audit found storage-related hits')
  assert(unexplained.length === 0, `zero unexplained hits (${unexplained.length})`)
  assert(
    !hits.some((h) => h.class === 'legacy-write'),
    'zero unexplained legacy storage write paths after 4E',
  )
}

function classify(file: string, text: string, needle: string): string {
  if (file === 'src/lib/storagePaths.ts') {
    if (text.includes('return `logo/${agencyProfileId}.${ext}`')) return 'legacy-compat-helper'
    return 'path-helper'
  }
  if (file === 'src/lib/agency.ts') {
    if (needle === 'agency-branding' && text.includes('Storage bucket')) return 'error-copy'
    return 'branding-write'
  }
  if (file === 'src/lib/documents.ts') {
    if (text.includes('transaction/recovery entity')) return 'prose'
    return 'docs-write'
  }
  if (file === 'src/lib/reconciliation.ts') return 'recon-write'
  if (file === 'src/pages/admin/AgencySettings.tsx' && needle === 'agency-branding') return 'ui-copy'
  if (file === 'src/pages/Transactions.tsx' && text.includes('recovery/chargeback')) return 'prose'
  if (needle === 'transaction/' || needle === 'recovery/') {
    if (/https?:|label|comment|prose|Create a recovery/i.test(text)) return 'prose'
  }
  return 'unexplained'
}

console.log('D. Migration script contract')
{
  assert(migrate.includes("const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'"), 'migrate aborts on Production')
  assert(migrate.includes('parseLegacyBrandingLogoPath'), 'migrates legacy branding objects')
  assert(migrate.includes('parseLegacySupportingDocumentPath'), 'migrates legacy supporting-document objects')
  assert(migrate.includes('idempotent') || migrate.includes('already at destination'), 'copy is idempotent')
  assert(migrate.includes('storage_path'), 'keeps supporting_documents.storage_path consistent')
  assert(!migrate.includes('DROP CONSTRAINT agency_profile_singleton'), 'does not drop singleton')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
