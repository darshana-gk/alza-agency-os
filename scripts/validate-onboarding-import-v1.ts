/**
 * Onboarding Import V1 pipeline tests (no network / no production writes).
 * Covers parse → map → validate → duplicate → insert-plan used by the UI.
 * Run: npx tsx scripts/validate-onboarding-import-v1.ts
 */

import ExcelJS from 'exceljs'
import {
  detectOnboardingDelimiter,
  parseOnboardingDelimitedText,
} from '../src/lib/onboardingIntake.ts'
import {
  allocateNextClientNumbers,
  buildOnboardingResultLogCsv,
  canAccessOnboardingImport,
  canImportOnboardingEntity,
  emptyOnboardingCaches,
  evaluateOnboardingRows,
  planOnboardingInsert,
  runOnboardingMappingChecks,
  suggestOnboardingMapping,
  type OnboardingLookupCaches,
  type OnboardingMapping,
} from '../src/lib/onboardingImport.ts'

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.error(`FAIL: ${message}`)
}

function mappingFromHeaders(entity: Parameters<typeof suggestOnboardingMapping>[0], headers: string[]) {
  return suggestOnboardingMapping(entity, headers)
}

function rowFromHeaders(headers: string[], values: unknown[]): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  headers.forEach((h, i) => {
    row[h] = values[i]
  })
  return row
}

function seedDirectoryCaches(): OnboardingLookupCaches {
  const caches = emptyOnboardingCaches()
  caches.carriersByName.set('acme insurance', ['Acme Insurance'])
  caches.mgasByName.set('midwest mga', ['Midwest MGA'])
  caches.producersByName.set('avery producer', ['Avery Producer'])
  caches.producersByEmail.set('avery@example.com', ['Avery Producer'])
  caches.csrsByName.set('blake csr', ['Blake CSR'])
  caches.csrsByEmail.set('blake@example.com', ['Blake CSR'])
  caches.clientsByName.set('existing client llc', [
    { id: 'client-1', businessName: 'Existing Client LLC' },
  ])
  caches.clientsByNumber.set('alza-000010', [{ id: 'client-1', clientNumber: 'ALZA-000010' }])
  caches.policiesByClientPolicy.add('client-1::pol-old')
  // Archived policy duplicate key still present:
  caches.policiesByClientPolicy.add('client-1::pol-archived')
  return caches
}

console.log('A. CSV carrier import')
{
  const csv = 'Carrier Name,NAIC,Status\nNorth Star Mutual,12345,active\nAcme Insurance,999,active\n'
  const parsed = parseOnboardingDelimitedText(csv, 'txt')
  assert(parsed.headers[0] === 'Carrier Name', 'CSV headers parsed')
  assert(parsed.rows.length === 2, 'CSV has 2 data rows')
  const mapping = mappingFromHeaders('carriers', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: parsed.rows,
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.ready === 1, 'new carrier ready')
  assert(preview.skippedDuplicate === 1, 'existing Acme Insurance skipped')
  assert(planOnboardingInsert(preview).length === 1, 'insert plan has only ready carrier')
}

console.log('B. XLSX client import')
{
  // Build an in-memory workbook the same way production Excel intake reads sheets.
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Clients')
  sheet.addRow(['Business Name', 'Email', 'Client Number'])
  sheet.addRow(['Brand New Client Inc', 'new@example.com', ''])
  sheet.addRow(['Existing Client LLC', 'dup@example.com', ''])
  const headers = ['Business Name', 'Email', 'Client Number']
  const rows: Record<string, unknown>[] = []
  sheet.eachRow((row, n) => {
    if (n === 1) return
    rows.push({
      'Business Name': String(row.getCell(1).value ?? ''),
      Email: String(row.getCell(2).value ?? ''),
      'Client Number': String(row.getCell(3).value ?? ''),
    })
  })
  assert(sheet.name === 'Clients' && rows.length === 2, 'XLSX worksheet shape ready')
  const mapping = mappingFromHeaders('clients', headers)
  const preview = evaluateOnboardingRows({
    entity: 'clients',
    rows,
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.ready === 1, 'new XLSX client ready')
  assert(preview.skippedDuplicate === 1, 'existing XLSX client skipped')
}

console.log('C. Tab-delimited TXT import')
{
  const txt = 'Carrier Name\tNAIC\nTab Carrier\t111\n'
  assert(detectOnboardingDelimiter(txt) === '\t', 'tab delimiter detected')
  const parsed = parseOnboardingDelimitedText(txt, 'txt')
  assert(parsed.delimiter === '\t', 'parsed as tab')
  assert(parsed.rows[0]?.['Carrier Name'] === 'Tab Carrier', 'tab row values')
}

console.log('D. Pasted table')
{
  const paste = 'MGA Name,Email\nPaste MGA,ops@mga.example\n'
  const parsed = parseOnboardingDelimitedText(paste, 'paste')
  const mapping = mappingFromHeaders('mgas', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'mgas',
    rows: parsed.rows,
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.ready === 1, 'pasted MGA ready')
  assert(planOnboardingInsert(preview)[0]?.payload.mgaName === 'Paste MGA', 'paste payload')
}

console.log('E. Duplicate client')
{
  const headers = ['Business Name']
  const mapping: OnboardingMapping = { business_name: 'Business Name' }
  const preview = evaluateOnboardingRows({
    entity: 'clients',
    rows: [rowFromHeaders(headers, ['Existing Client LLC'])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.skippedDuplicate === 1, 'duplicate client skipped')
  assert(planOnboardingInsert(preview).length === 0, 'no insert for duplicate client')
}

console.log('F. Duplicate policy')
{
  const headers = [
    'Client Name',
    'Policy Number',
    'Comm %',
    'Producer Split %',
  ]
  const mapping = mappingFromHeaders('policies', headers)
  const preview = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'POL-OLD', '10', '40'])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.skippedDuplicate === 1, 'duplicate policy skipped')
}

console.log('G. Archived duplicate policy')
{
  const headers = [
    'Client Name',
    'Policy Number',
    'Comm %',
    'Producer Split %',
  ]
  const mapping = mappingFromHeaders('policies', headers)
  const preview = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'POL-ARCHIVED', '10', '40'])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.skippedDuplicate === 1, 'archived policy still treated as duplicate')
}

console.log('H–K. Producer Split validation')
{
  const headers = [
    'Client Name',
    'Policy Number',
    'Comm %',
    'Producer Split %',
  ]
  const mapping = mappingFromHeaders('policies', headers)
  const caches = seedDirectoryCaches()

  const blank = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'P-BLANK', '10', ''])],
    mapping,
    caches,
  })
  assert(blank.missingRequired === 1, 'H. blank Producer Split → missing_required')
  assert(planOnboardingInsert(blank).length === 0, 'H. blank not insertable')

  const zero = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'P-ZERO', '10', '0'])],
    mapping,
    caches,
  })
  assert(zero.ready === 1, 'I. 0 Producer Split → ready')
  assert(zero.rows[0]?.payload.producerSplitPercentage === 0, 'I. payload split is 0')

  const hundred = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'P-100', '10', '100'])],
    mapping,
    caches,
  })
  assert(hundred.ready === 1, 'J. 100 → ready')

  const over = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'P-101', '10', '101'])],
    mapping,
    caches,
  })
  assert(over.invalid === 1, 'K. 101 → invalid')
}

console.log('L. Policy with missing client → blocked')
{
  const headers = [
    'Client Name',
    'Policy Number',
    'Comm %',
    'Producer Split %',
  ]
  const mapping = mappingFromHeaders('policies', headers)
  const preview = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Unknown Client', 'P-1', '10', '50'])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.ready === 0, 'L. missing client not ready')
  assert(
    preview.missingRequired + preview.invalid > 0,
    'L. missing client marked missing/invalid',
  )
}

console.log('M–N. Client number generation + collision')
{
  const headers = ['Business Name', 'Client Number']
  const mapping: OnboardingMapping = {
    business_name: 'Business Name',
    client_number: 'Client Number',
  }
  const blankNumber = evaluateOnboardingRows({
    entity: 'clients',
    rows: [rowFromHeaders(headers, ['Fresh Co', ''])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(blankNumber.ready === 1, 'M. blank client number still ready (generated later)')
  const generated = allocateNextClientNumbers(['ALZA-000010', 'ALZA-000015'], 2)
  assert(generated[0] === 'ALZA-000016', 'M. next number after max is ALZA-000016')
  assert(generated[1] === 'ALZA-000017', 'M. sequential allocation')

  const collide = evaluateOnboardingRows({
    entity: 'clients',
    rows: [rowFromHeaders(headers, ['Other Co', 'ALZA-000010'])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(collide.skippedDuplicate === 1, 'N. provided duplicate client number skipped')

  const inFileDupNumbers = evaluateOnboardingRows({
    entity: 'clients',
    rows: [
      rowFromHeaders(headers, ['A Co', 'ALZA-000099']),
      rowFromHeaders(headers, ['B Co', 'ALZA-000099']),
    ],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(
    inFileDupNumbers.possibleDuplicate >= 1 || inFileDupNumbers.rows.some((r) => r.status !== 'ready'),
    'N. in-file duplicate generated/provided numbers protected',
  )
}

console.log('O. Invalid required field')
{
  const headers = ['Carrier Name']
  const mapping: OnboardingMapping = { carrier_name: 'Carrier Name' }
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: [rowFromHeaders(headers, [''])],
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assert(preview.missingRequired === 1, 'O. blank required carrier → missing_required')
}

console.log('P. Failed row appears in result log')
{
  const headers = ['Carrier Name']
  const mapping: OnboardingMapping = { carrier_name: 'Carrier Name' }
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: [
      rowFromHeaders(headers, ['Good Carrier']),
      rowFromHeaders(headers, ['']),
    ],
    mapping,
    caches: emptyOnboardingCaches(),
  })
  const fakeResult = {
    imported: 0,
    skippedDuplicate: 0,
    skippedValidation: 1,
    failed: 1,
    errors: ['Row 1: simulated DB failure'],
    rowResults: [
      { rowIndex: 1, status: 'failed', message: 'simulated DB failure' },
      { rowIndex: 2, status: 'skipped_validation', message: 'missing required' },
    ],
  }
  const csv = buildOnboardingResultLogCsv(preview, fakeResult)
  assert(csv.includes('simulated DB failure'), 'P. failed row in CSV log')
  assert(csv.includes('Missing required') || csv.includes('missing'), 'P. validation row in CSV log')
}

console.log('Q. Ready rows insert-only')
{
  const headers = ['Carrier Name']
  const mapping: OnboardingMapping = { carrier_name: 'Carrier Name' }
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: [
      rowFromHeaders(headers, ['New One']),
      rowFromHeaders(headers, ['Acme Insurance']),
      rowFromHeaders(headers, ['']),
    ],
    mapping,
    caches: seedDirectoryCaches(),
  })
  const plan = planOnboardingInsert(preview)
  assert(plan.length === 1, 'Q. only ready rows in insert plan')
  assert(plan[0]?.payload.carrierName === 'New One', 'Q. insert plan is the new carrier only')
}

console.log('RBAC Owner/Admin only')
{
  assert(canAccessOnboardingImport('owner'), 'owner can access')
  assert(canAccessOnboardingImport('admin'), 'admin can access')
  assert(!canAccessOnboardingImport('csr'), 'csr blocked from page')
  assert(!canAccessOnboardingImport('producer'), 'producer blocked from page')
  assert(!canImportOnboardingEntity('csr', 'clients'), 'csr cannot import clients')
  assert(canImportOnboardingEntity('admin', 'policies'), 'admin can import policies')
}

console.log('Mapping checks')
{
  const cases = runOnboardingMappingChecks()
  for (const c of cases) {
    assert(c.passed, `mapping ${c.id}: ${c.name} (${c.detail})`)
  }
}

console.log('referencePremium deferred note does not block ready row')
{
  const headers = [
    'Client Name',
    'Policy Number',
    'Premium',
    'Comm %',
    'Producer Split %',
  ]
  const mapping = mappingFromHeaders('policies', headers)
  const preview = evaluateOnboardingRows({
    entity: 'policies',
    rows: [rowFromHeaders(headers, ['Existing Client LLC', 'P-PREM', '1500', '10', '40'])],
    mapping,
    caches: seedDirectoryCaches(),
  })
  assert(preview.ready === 1, 'valid deferred premium still ready')
  assert(
    preview.rows[0]?.reasons.some((r) => /deferred|unsupported/i.test(r)),
    'deferred/unsupported note present',
  )
  assert(
    !('referencePremium' in (preview.rows[0]?.payload ?? {})),
    'referencePremium not in create payload keys (deferred only)',
  )
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
