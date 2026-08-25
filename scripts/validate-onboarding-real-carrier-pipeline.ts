/**
 * REAL workbook → parse → applyParsed-equivalent → rendered <select> values.
 * Uses the actual Downloads/test carrier.xlsx fixture (header: "name" only).
 * Run: npx tsx scripts/validate-onboarding-real-carrier-pipeline.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import {
  parseOnboardingDelimitedText,
  parseOnboardingSpreadsheet,
} from '../src/lib/onboardingIntake.ts'
import { runOnboardingParseToMappingStep } from '../src/lib/onboardingImport.ts'

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

function selectValue(step: ReturnType<typeof runOnboardingParseToMappingStep>, fieldKey: string) {
  return step.selects.find((s) => s.fieldKey === fieldKey)
}

const fixturePath = resolve('scripts/fixtures/test-carrier.xlsx')

console.log('A. Real fixture bytes match expected single-column workbook')
{
  const buf = readFileSync(fixturePath)
  assert(buf.length === 8800, `fixture size 8800 (got ${buf.length})`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheet = wb.worksheets[0]
  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? ''))
  })
  assert(JSON.stringify(headers) === JSON.stringify(['name']), `raw Excel headers are ["name"] (got ${JSON.stringify(headers)})`)
  assert(sheet.rowCount === 3, 'raw Excel has header + 2 data rows')
}

console.log('B. Wizard source uses parse→mapping-step pipeline + select model')
{
  const wizard = readFileSync(
    resolve('src/components/onboarding/OnboardingImportWizard.tsx'),
    'utf8',
  )
  assert(wizard.includes('runOnboardingParseToMappingStep'), 'Wizard calls runOnboardingParseToMappingStep')
  assert(wizard.includes('buildOnboardingMappingSelectModel'), 'Wizard renders via select model')
  assert(wizard.includes('data-onboarding-field'), 'Selects tagged with field keys')
  assert(wizard.includes('Spreadsheet columns detected'), 'UI shows detected spreadsheet columns')
  assert(
    /useEffect\([\s\S]*justOpened[\s\S]*\}, \[props\.open\]\)/.test(wizard),
    'Full reset effect depends only on props.open (not allowedEntities)',
  )
}

console.log('C. REAL test-carrier.xlsx through production parse → mapping step selects')
{
  const file = new File([readFileSync(fixturePath)], 'test carrier.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const parsed = await parseOnboardingSpreadsheet(file, { sheetIndex: 0, sheetName: 'Sheet1' })
  console.log('    parsed.headers =', JSON.stringify(parsed.headers))
  console.log('    parsed.rows[0] =', JSON.stringify(parsed.rows[0]))
  assert(JSON.stringify(parsed.headers) === JSON.stringify(['name']), 'parsed headers ["name"]')
  assert(parsed.rows.length === 2, '2 data rows')
  assert(parsed.rows[0]?.name === 'ALZA TEST CARRIER ONE', 'first row carrier name')

  const step = runOnboardingParseToMappingStep('carriers', parsed)
  assert(step.step === 3, 'mapping step = 3')
  console.log('    mapping =', JSON.stringify(step.mapping))
  assert(step.mapping.carrier_name === 'name', 'mapping.carrier_name === "name"')
  assert(step.mapping.naic === undefined, 'naic stays unmapped (column absent)')
  assert(step.mapping.status === undefined, 'status stays unmapped (column absent)')

  const carrier = selectValue(step, 'carrier_name')
  const naic = selectValue(step, 'naic')
  const status = selectValue(step, 'status')
  assert(carrier?.value === 'name', `carrier_name <select value> === "name" (got ${JSON.stringify(carrier?.value)})`)
  assert(
    carrier?.options.includes('name') === true,
    'carrier_name options include spreadsheet column "name"',
  )
  assert(naic?.value === '', 'naic <select value> is Not mapped ("")')
  assert(status?.value === '', 'status <select value> is Not mapped ("")')
  assert(
    step.selects.every((s) => !s.value || s.options.includes(s.value)),
    'every selected value exists as an <option value>',
  )
}

console.log('D. Three-column Carrier Name|NAIC|Status still auto-maps (plain + rich XLSX, CSV, paste)')
{
  async function xlsx(build: (s: ExcelJS.Worksheet) => void, name: string) {
    const wb = new ExcelJS.Workbook()
    const s = wb.addWorksheet('Carriers')
    build(s)
    return new File([await wb.xlsx.writeBuffer()], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }

  const rich = await xlsx((s) => {
    s.addRow([
      { richText: [{ font: { bold: true }, text: 'Carrier Name' }] },
      { richText: [{ font: { bold: true }, text: 'NAIC' }] },
      { richText: [{ font: { bold: true }, text: 'Status' }] },
    ])
    s.addRow(['North Star', '1', 'active'])
    s.addRow(['Acme', '2', 'active'])
  }, 'three-rich.xlsx')
  const richStep = runOnboardingParseToMappingStep(
    'carriers',
    await parseOnboardingSpreadsheet(rich, { sheetIndex: 0 }),
  )
  assert(richStep.selects.find((s) => s.fieldKey === 'carrier_name')?.value === 'Carrier Name', 'rich: Carrier Name selected')
  assert(richStep.selects.find((s) => s.fieldKey === 'naic')?.value === 'NAIC', 'rich: NAIC selected')
  assert(richStep.selects.find((s) => s.fieldKey === 'status')?.value === 'Status', 'rich: Status selected')

  const csv = new File(
    ['Carrier Name,NAIC,Status\nA,1,active\nB,2,active\n'],
    'three.csv',
    { type: 'text/csv' },
  )
  const csvStep = runOnboardingParseToMappingStep('carriers', await parseOnboardingSpreadsheet(csv))
  assert(csvStep.selects.find((s) => s.fieldKey === 'carrier_name')?.value === 'Carrier Name', 'csv: Carrier Name selected')

  const paste = parseOnboardingDelimitedText(
    'Carrier Name\tNAIC\tStatus\nA\t1\tactive\nB\t2\tactive\n',
    'paste',
  )
  const pasteStep = runOnboardingParseToMappingStep('carriers', paste)
  assert(pasteStep.selects.find((s) => s.fieldKey === 'carrier_name')?.value === 'Carrier Name', 'paste: Carrier Name selected')
}

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-real-carrier-pipeline: ALL GREEN')
