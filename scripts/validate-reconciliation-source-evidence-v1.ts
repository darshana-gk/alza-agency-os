/**
 * Reconciliation source-evidence V1 — local validation (no staging writes).
 * Run: npx tsx scripts/validate-reconciliation-source-evidence-v1.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canAccessReconciliation,
  canConfirmReconciliationReceipts,
} from '../src/lib/permissions.ts'
import {
  RECONCILIATION_SOURCE_NOT_RETAINED,
  RECONCILIATION_SOURCE_RETENTION_FAILED,
  RECONCILIATION_SOURCE_SIGNED_URL_TTL_SECONDS,
  isPastedStatementFileName,
  pastedStatementFileName,
  runReconciliationPass2SafetyChecks,
  runReconciliationPresentationChecks,
  runStatementIntakeChecks,
} from '../src/lib/reconciliation.ts'
import {
  runAmbiguousPolicyMatchChecks,
  runPartyMatchScenarioChecks,
  runSignedVarianceScenarioChecks,
} from '../src/lib/reconciliationMatching.ts'
import { RECONCILIATION_STATEMENTS_BUCKET } from '../src/lib/storagePaths.ts'

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

function readRepo(rel: string): string {
  return readFileSync(resolve(rel), 'utf8')
}

function sliceFn(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`)
  const alt = start >= 0 ? start : source.indexOf(`async function ${name}`)
  if (alt < 0) return ''
  const from = source.slice(alt)
  const rest = from.slice(1)
  const next = rest.search(/\nexport async function |\nexport function |\nasync function /)
  return next >= 0 ? from.slice(0, next + 1) : from
}

const RECON_TS = readRepo('src/lib/reconciliation.ts')
const DETAIL_TSX = readRepo('src/components/reconciliation/StatementDetail.tsx')
const WIZARD_TSX = readRepo('src/components/reconciliation/ImportWizard.tsx')
const INTAKE_TS = readRepo('src/lib/reconciliationIntake.ts')
const FOUNDATION_SQL = readRepo('supabase/migrations/20260819_reconciliation_foundation.sql')
const STORAGE_SQL = readRepo(
  'supabase/migrations/20260828250000_multitenancy_v1_phase3d_storage_isolation.sql',
)
const RLS_SQL = readRepo('supabase/migrations/20260828230000_multitenancy_v1_phase3b_rls_security.sql')
const MATCH_FN = readRepo('supabase/functions/run-reconciliation-matching/index.ts')
const CONFIRM_FN = readRepo('supabase/functions/confirm-reconciliation-receipts/index.ts')

const importFn = sliceFn(RECON_TS, 'importReconciliationStatement')
const signedFn = sliceFn(RECON_TS, 'createSignedReconciliationStatementUrl')
const statusFn = sliceFn(RECON_TS, 'updateStatementStatus')

console.log('=== 1. uploaded / paste statements retain file_storage_path ===')
assert(
  importFn.includes('file_storage_path: storagePath'),
  'new imports persist file_storage_path on insert',
)
assert(
  importFn.includes('.upload(storagePath, input.file'),
  'import uploads the source File to Storage',
)
assert(
  /upload[\s\S]*file_storage_path: storagePath[\s\S]*\.insert\(persistPayload\)/.test(importFn) ||
    (importFn.indexOf('.upload(storagePath') >= 0 &&
      importFn.indexOf('.upload(storagePath') < importFn.indexOf('.insert(persistPayload)')),
  'upload happens before the operational statement insert',
)
assert(
  WIZARD_TSX.includes('new File([normalized], pastedStatementFileName()') &&
    WIZARD_TSX.includes('importReconciliationStatement({'),
  'Paste Text still creates a .txt File and uses the same import path',
)
assert(
  RECONCILIATION_STATEMENTS_BUCKET === 'reconciliation-statements',
  'bucket remains reconciliation-statements',
)

console.log('=== 2. signed URL helper refuses inaccessible / missing path / arbitrary path ===')
assert(
  /createSignedReconciliationStatementUrl\(statementId: string\)/.test(RECON_TS),
  'helper accepts only statementId (no client storage path argument)',
)
assert(!/createSignedReconciliationStatementUrl\([^)]*storagePath/.test(RECON_TS), 'no storagePath parameter on helper')
assert(signedFn.includes('requireOps()'), 'helper requires reconciliation ops access')
assert(signedFn.includes('fetchReconciliationStatement(id)'), 'helper loads the RLS-visible statement by id')
assert(
  signedFn.includes('loaded.data.fileStoragePath') && signedFn.includes('.createSignedUrl(path,'),
  'signed URL uses fileStoragePath from the loaded statement only',
)
assert(
  signedFn.includes('RECONCILIATION_SOURCE_NOT_RETAINED') &&
    RECONCILIATION_SOURCE_NOT_RETAINED === 'Original statement was not retained for this import.',
  'missing file_storage_path returns the safe retained-message',
)
assert(
  RECONCILIATION_SOURCE_SIGNED_URL_TTL_SECONDS === 120,
  'signed URL TTL is 120 seconds',
)
assert(
  DETAIL_TSX.includes('createSignedReconciliationStatementUrl(props.statement.id)'),
  'UI signs by statement id, not a caller-supplied path',
)
assert(!canAccessReconciliation('producer'), 'Producer cannot access reconciliation')
assert(!canAccessReconciliation('viewer'), 'Viewer cannot access reconciliation')
assert(canAccessReconciliation('csr') && canAccessReconciliation('owner'), 'Owner/Admin/CSR retain reconciliation access')
assert(!canConfirmReconciliationReceipts('csr'), 'CSR confirm gate unchanged')

console.log('=== 3. upload failure does not produce a usable import ===')
assert(
  importFn.includes('RECONCILIATION_SOURCE_RETENTION_FAILED') &&
    RECONCILIATION_SOURCE_RETENTION_FAILED.includes("couldn't securely retain the source statement"),
  'upload failure returns the fail-closed user message',
)
assert(
  !importFn.includes('Keep the statement row') &&
    !importFn.includes('matching can still proceed without the audit file'),
  'fail-open console-warn path is gone',
)
assert(
  importFn.includes('if (uploadError)') &&
    importFn.indexOf('if (uploadError)') < importFn.indexOf('.insert(persistPayload)'),
  'upload error returns before inserting a usable statement',
)
assert(
  importFn.includes("return { data: null, error: RECONCILIATION_SOURCE_RETENTION_FAILED }"),
  'failed retention does not return a statement payload',
)
assert(
  RECON_TS.includes('async function rollbackNewStatement') &&
    RECON_TS.includes(".delete()") &&
    RECON_TS.includes(".select('id')") &&
    RECON_TS.includes("status: 'cancelled'"),
  'post-insert failure confirms DELETE actually removed a row, else cancels the new statement',
)
assert(
  !RECON_TS.includes('if (!deleteError) await bestEffortRemoveStatementObject'),
  'does not treat a silent RLS-filtered DELETE as successful cleanup',
)
assert(importFn.includes('rollbackNewStatement(statementId, storagePath)'), 'row insert failure rolls back the new statement')
assert(
  importFn.includes('if (insertError)') &&
    importFn.includes('bestEffortRemoveStatementObject(storagePath)') &&
    !importFn
      .slice(importFn.indexOf('if (insertError)'), importFn.indexOf('if (!created') > 0 ? importFn.indexOf('if (!created') : importFn.length)
      .includes('.delete()'),
  'insert failure after upload removes only the new Storage object',
)
assert(
  importFn.indexOf('runReconciliationMatching(statementId)') >
    importFn.indexOf('return { data: null, error: RECONCILIATION_SOURCE_RETENTION_FAILED }'),
  'matching runs only after retention has succeeded',
)

console.log('=== 4. completion does not remove source evidence ===')
assert(!statusFn.includes('.remove('), 'updateStatementStatus does not remove Storage objects')
assert(statusFn.includes("status === 'completed'") && statusFn.includes("status === 'cancelled'"), 'complete and cancel still go through updateStatementStatus')
assert(
  statusFn.includes(".update({ status, updated_at: new Date().toISOString() })") &&
    !statusFn.includes('file_storage_path'),
  'complete/cancel only change status, not file_storage_path',
)
assert(!MATCH_FN.toLowerCase().includes('reconciliation-statements'), 'matching function does not touch statement storage')
assert(!CONFIRM_FN.toLowerCase().includes('reconciliation-statements'), 'confirm receipts does not touch statement storage')

console.log('=== 5. UI More actions ===')
assert(DETAIL_TSX.includes('Download Original Statement'), 'uploaded-file download action exists')
assert(DETAIL_TSX.includes('View Original Statement'), 'paste view action exists')
assert(DETAIL_TSX.includes('Download as TXT'), 'paste download-as-txt action exists')
assert(DETAIL_TSX.includes('isPastedStatementFileName(props.statement.fileName)'), 'paste vs upload is filename-based')
assert(
  DETAIL_TSX.includes(RECONCILIATION_SOURCE_NOT_RETAINED) ||
    DETAIL_TSX.includes('RECONCILIATION_SOURCE_NOT_RETAINED'),
  'unavailable source evidence is shown as a non-destructive message',
)
assert(!DETAIL_TSX.includes('raw_data') && !DETAIL_TSX.includes('rawData'), 'UI does not reconstruct from raw_data')

console.log('=== 6. paste filename helper ===')
assert(isPastedStatementFileName('pasted_statement_20260915_1209.txt'), 'UAT paste filename is detected')
assert(isPastedStatementFileName(pastedStatementFileName(new Date('2026-09-15T12:09:00'))), 'generated paste names match')
assert(!isPastedStatementFileName('Travelers_Sept.csv'), 'uploaded CSV is not treated as paste')
assert(!isPastedStatementFileName('statement.txt'), 'generic txt is not treated as paste')
assert(INTAKE_TS.includes('normalizePastedStatementText'), 'paste normalization is unchanged')

console.log('=== 7. security / RLS / private bucket ===')
assert(FOUNDATION_SQL.includes("public = false") && FOUNDATION_SQL.includes("'reconciliation-statements'"), 'foundation bucket is private')
assert(
  STORAGE_SQL.includes("bucket_id = 'reconciliation-statements'") &&
    STORAGE_SQL.includes('multitenancy_storage_agency_object') &&
    STORAGE_SQL.includes('is_ops_staff()'),
  'storage select remains ops + agency-prefixed object',
)
assert(
  RLS_SQL.includes('recon_statements_select_ops') &&
    RLS_SQL.includes('same_agency(agency_profile_id) AND public.is_ops_staff()'),
  'statement SELECT remains same-agency ops staff',
)
assert(!STORAGE_SQL.includes("public = true"), 'phase 3d storage isolation does not make buckets public')

console.log('=== 8. existing reconciliation matching unchanged ===')
for (const c of [
  ...runSignedVarianceScenarioChecks(),
  ...runPartyMatchScenarioChecks(),
  ...runAmbiguousPolicyMatchChecks(),
  ...runReconciliationPresentationChecks(),
  ...runReconciliationPass2SafetyChecks(),
]) {
  assert(c.passed, `${c.id}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
}

const intake = await runStatementIntakeChecks()
for (const c of intake) {
  assert(c.passed, `intake ${c.id}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
}

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) process.exit(1)
