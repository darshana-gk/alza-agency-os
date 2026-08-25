/**
 * MGA onboarding real-write pipeline regression (mocked persistence).
 * Proves: XLSX → parse → map → evaluate display "MGA Name" → insert plan → createMga
 * payload → directory-visible rows. Also proves Carrier Name never appears for MGA entity,
 * and entity-mismatch execute refuses carrier-preview under MGA selection.
 *
 * Run: npx tsx scripts/validate-onboarding-mga-write-pipeline.ts
 */

import ExcelJS from 'exceljs'
import {
  emptyOnboardingCaches,
  evaluateOnboardingRows,
  executeOnboardingImport,
  isMgaDirectoryVisible,
  planOnboardingInsert,
  runOnboardingParseToMappingStep,
  suggestOnboardingMapping,
  toMgaDirectoryRow,
  type OnboardingPreviewResult,
} from '../src/lib/onboardingImport.ts'
import { parseOnboardingSpreadsheet } from '../src/lib/onboardingIntake.ts'

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

async function mgaWorkbookFile(): Promise<File> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('MGAs')
  sheet.addRow(['name'])
  sheet.addRow(['ALZA TEST MGA ONE'])
  sheet.addRow(['ALZA TEST MGA TWO'])
  const buf = await wb.xlsx.writeBuffer()
  return new File([buf], 'test-mga.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

console.log('A. MGA XLSX parse → mapping → preview display/payload')
{
  const parsed = await parseOnboardingSpreadsheet(await mgaWorkbookFile(), { sheetIndex: 0 })
  const step = runOnboardingParseToMappingStep('mgas', parsed)
  assert(step.mapping.mga_name === 'name', 'name → mga_name')
  assert(step.selects.find((s) => s.fieldKey === 'mga_name')?.value === 'name', 'MGA Name select = name')
  assert(
    step.selects.find((s) => s.fieldKey === 'mga_name')?.label === 'MGA Name',
    'ALZA field label is MGA Name (not Carrier Name)',
  )

  const preview = evaluateOnboardingRows({
    entity: 'mgas',
    rows: parsed.rows,
    mapping: step.mapping,
    caches: emptyOnboardingCaches(),
  })
  assert(preview.entity === 'mgas', 'preview.entity === mgas')
  assert(preview.ready === 2, 'Ready: 2')
  assert(
    preview.rows.every((r) => Object.keys(r.display).includes('MGA Name')),
    'display keys include MGA Name',
  )
  assert(
    preview.rows.every((r) => !Object.keys(r.display).includes('Carrier Name')),
    'display keys never include Carrier Name for MGA entity',
  )
  assert(preview.rows[0]?.display['MGA Name'] === 'ALZA TEST MGA ONE', 'row1 MGA Name value')
  assert(preview.rows[1]?.display['MGA Name'] === 'ALZA TEST MGA TWO', 'row2 MGA Name value')
  assert(preview.rows[0]?.payload.mgaName === 'ALZA TEST MGA ONE', 'payload.mgaName row1')
  assert(preview.rows.every((r) => r.payload.carrierName === undefined), 'no carrierName on MGA payload')
}

console.log('B. Same file under Carriers produces Carrier Name (contrast / root-cause proof)')
{
  const parsed = await parseOnboardingSpreadsheet(await mgaWorkbookFile(), { sheetIndex: 0 })
  const mapping = suggestOnboardingMapping('carriers', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assert(
    preview.rows.every((r) => Object.keys(r.display).includes('Carrier Name')),
    'carriers entity → Carrier Name display (explains QA if entity left on Carriers)',
  )
  assert(preview.rows[0]?.payload.carrierName === 'ALZA TEST MGA ONE', 'carriers payload uses carrierName')
}

console.log('C. Mocked MGA persistence → directory-visible rows')
{
  const parsed = await parseOnboardingSpreadsheet(await mgaWorkbookFile(), { sheetIndex: 0 })
  const mapping = suggestOnboardingMapping('mgas', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'mgas',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  const ready = planOnboardingInsert(preview)
  assert(ready.length === 2, 'insert plan has 2 ready rows')

  type Stored = {
    id: string
    mga_name: string
    contact_person: string | null
    email: string | null
    phone: string | null
    status: string
    states: string | null
    lines_of_business: string | null
    notes: string | null
    archived_at: string | null
  }
  const table: Stored[] = [
    {
      id: 'existing-1',
      mga_name: 'btis',
      contact_person: null,
      email: null,
      phone: null,
      status: 'active',
      states: null,
      lines_of_business: null,
      notes: null,
      archived_at: null,
    },
    {
      id: 'existing-2',
      mga_name: 'ISC',
      contact_person: null,
      email: null,
      phone: null,
      status: 'active',
      states: null,
      lines_of_business: null,
      notes: null,
      archived_at: null,
    },
  ]

  const out = await executeOnboardingImport({
    entity: 'mgas',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createMga: async (input) => {
        const id = `mga-${table.length + 1}`
        table.push({
          id,
          mga_name: input.mgaName.trim(),
          contact_person: input.contactPerson.trim() || null,
          email: input.email.trim() || null,
          phone: input.phone.trim() || null,
          status: input.status.trim() || 'active',
          states: input.states.trim() || null,
          lines_of_business: input.linesOfBusiness.trim() || null,
          notes: input.notes.trim() || null,
          archived_at: null,
        })
        return { data: { id }, error: null }
      },
    },
  })

  assert(out.error === null, 'execute error null')
  assert(out.data?.imported === 2, `imported === 2 (got ${out.data?.imported})`)
  assert(out.data?.failed === 0, `failed === 0 (got ${out.data?.failed})`)

  const directory = table
    .map((row) =>
      toMgaDirectoryRow({
        id: row.id,
        mgaName: row.mga_name,
        contactPerson: row.contact_person ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        states: row.states ?? '',
        linesOfBusiness: row.lines_of_business ?? '',
        status: row.status,
        notes: row.notes ?? '',
        archivedAt: row.archived_at,
      }),
    )
    .filter(isMgaDirectoryVisible)

  const names = directory.map((r) => r.name)
  assert(names.includes('btis'), 'directory still has btis')
  assert(names.includes('ISC'), 'directory still has ISC')
  assert(names.includes('ALZA TEST MGA ONE'), 'directory shows ALZA TEST MGA ONE')
  assert(names.includes('ALZA TEST MGA TWO'), 'directory shows ALZA TEST MGA TWO')
  assert(directory.length === 4, `directory visible count 4 (got ${directory.length})`)
}

console.log('D. Inserted count requires real write id (no false success)')
{
  const parsed = await parseOnboardingSpreadsheet(await mgaWorkbookFile(), { sheetIndex: 0 })
  const mapping = suggestOnboardingMapping('mgas', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'mgas',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  const out = await executeOnboardingImport({
    entity: 'mgas',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createMga: async () => ({ data: null, error: null }),
    },
  })
  assert(out.data?.imported === 0, 'imported 0 when writer returns no id')
  assert(out.data?.failed === 2, 'failed 2 when writer returns no id')
}

console.log('E. Entity mismatch: MGA selected + Carrier preview is refused')
{
  const parsed = await parseOnboardingSpreadsheet(await mgaWorkbookFile(), { sheetIndex: 0 })
  const carrierPreview: OnboardingPreviewResult = evaluateOnboardingRows({
    entity: 'carriers',
    rows: parsed.rows,
    mapping: suggestOnboardingMapping('carriers', parsed.headers),
    caches: emptyOnboardingCaches(),
  })
  const out = await executeOnboardingImport({
    entity: 'mgas',
    preview: carrierPreview,
    deps: { bypassAuth: true, skipActivity: true },
  })
  assert(out.data === null, 'mismatch returns no data')
  assert(
    String(out.error ?? '').toLowerCase().includes('mismatch'),
    `mismatch error message (got ${out.error})`,
  )
}

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-mga-write-pipeline: ALL GREEN')
