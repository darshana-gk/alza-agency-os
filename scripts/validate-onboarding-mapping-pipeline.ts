/**
 * Real parse → mapping UI-state pipeline (same path OnboardingImportWizard uses).
 * Builds actual XLSX/CSV/TXT/paste inputs — does not call alias helpers alone.
 * Run: npx tsx scripts/validate-onboarding-mapping-pipeline.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import {
  parseOnboardingDelimitedText,
  parseOnboardingSpreadsheet,
} from '../src/lib/onboardingIntake.ts'
import { buildOnboardingMappingUiState } from '../src/lib/onboardingImport.ts'

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

function expectCarrierMapping(
  label: string,
  ui: ReturnType<typeof buildOnboardingMappingUiState>,
) {
  assert(
    JSON.stringify(ui.headers) === JSON.stringify(['Carrier Name', 'NAIC', 'Status']),
    `${label}: headers exact Carrier Name | NAIC | Status (got ${JSON.stringify(ui.headers)})`,
  )
  assert(ui.mapping.carrier_name === 'Carrier Name', `${label}: carrier_name → Carrier Name`)
  assert(ui.mapping.naic === 'NAIC', `${label}: naic → NAIC`)
  assert(ui.mapping.status === 'Status', `${label}: status → Status`)
  assert(
    Object.values(ui.mapping).filter(Boolean).length === 3,
    `${label}: exactly 3 mapped fields`,
  )
  // Select contract: every mapped value must appear as a header option value
  for (const [field, header] of Object.entries(ui.mapping)) {
    if (!header) continue
    assert(ui.headers.includes(header), `${label}: select option exists for ${field}=${header}`)
  }
}

async function xlsxFile(
  build: (sheet: ExcelJS.Worksheet) => void,
  name: string,
): Promise<File> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Carriers')
  build(sheet)
  const buf = await wb.xlsx.writeBuffer()
  return new File([buf], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

console.log('A. Wizard wires the same UI-state builder after parse')
{
  const wizard = readFileSync(
    resolve('src/components/onboarding/OnboardingImportWizard.tsx'),
    'utf8',
  )
  assert(wizard.includes('buildOnboardingMappingUiState'), 'Wizard imports UI-state builder')
  assert(
    /applyParsed[\s\S]*buildOnboardingMappingUiState/.test(wizard),
    'applyParsed uses buildOnboardingMappingUiState',
  )
  assert(wizard.includes('setMapping(ui.mapping)'), 'Wizard sets mapping from UI-state object')
  assert(wizard.includes('justOpened'), 'Wizard resets only on open transition (not mid-parse)')
}

console.log('B. XLSX rich-text headers (real Excel bold header path)')
{
  const file = await xlsxFile((sheet) => {
    sheet.addRow([
      { richText: [{ font: { bold: true }, text: 'Carrier Name' }] },
      { richText: [{ font: { bold: true }, text: 'NAIC' }] },
      { richText: [{ font: { bold: true }, text: 'Status' }] },
    ])
    sheet.addRow(['North Star Mutual', '12345', 'active'])
    sheet.addRow(['Acme Insurance', '999', 'active'])
  }, 'test-carrier-rich.xlsx')

  const parsed = await parseOnboardingSpreadsheet(file, { sheetIndex: 0 })
  assert(parsed.rows.length === 2, 'XLSX rich: 2 data rows')
  assert(
    !parsed.headers.some((h) => h.includes('[object Object]')),
    `XLSX rich: headers are not [object Object] (got ${JSON.stringify(parsed.headers)})`,
  )
  const ui = buildOnboardingMappingUiState('carriers', parsed)
  expectCarrierMapping('XLSX rich-text', ui)
}

console.log('C. XLSX plain string headers')
{
  const file = await xlsxFile((sheet) => {
    sheet.addRow(['Carrier Name', 'NAIC', 'Status'])
    sheet.addRow(['North Star Mutual', '12345', 'active'])
    sheet.addRow(['Acme Insurance', '999', 'active'])
  }, 'test-carrier-plain.xlsx')
  const parsed = await parseOnboardingSpreadsheet(file, { sheetIndex: 0 })
  const ui = buildOnboardingMappingUiState('carriers', parsed)
  expectCarrierMapping('XLSX plain', ui)
}

console.log('D. CSV equivalent through parseOnboardingSpreadsheet')
{
  const csv = 'Carrier Name,NAIC,Status\nNorth Star Mutual,12345,active\nAcme Insurance,999,active\n'
  const file = new File([csv], 'test-carrier.csv', { type: 'text/csv' })
  const parsed = await parseOnboardingSpreadsheet(file)
  const ui = buildOnboardingMappingUiState('carriers', parsed)
  expectCarrierMapping('CSV', ui)
}

console.log('E. TXT equivalent')
{
  const txt = 'Carrier Name\tNAIC\tStatus\nNorth Star Mutual\t12345\tactive\nAcme Insurance\t999\tactive\n'
  const file = new File([txt], 'test-carrier.txt', { type: 'text/plain' })
  const parsed = await parseOnboardingSpreadsheet(file)
  const ui = buildOnboardingMappingUiState('carriers', parsed)
  expectCarrierMapping('TXT', ui)
}

console.log('F. Paste equivalent')
{
  const paste =
    'Carrier Name,NAIC,Status\nNorth Star Mutual,12345,active\nAcme Insurance,999,active\n'
  const parsed = parseOnboardingDelimitedText(paste, 'paste')
  const ui = buildOnboardingMappingUiState('carriers', parsed)
  expectCarrierMapping('Paste', ui)
}

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-mapping-pipeline: ALL GREEN')
