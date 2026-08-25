/**
 * Onboarding Import — smart column auto-mapping + upload UX contract tests.
 * No network / no production writes.
 * Run: npx tsx scripts/validate-onboarding-mapping-ux.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ONBOARDING_FILE_ACCEPT,
  applyOnboardingMappingChange,
  normalizeHeaderMatchKey,
  resolveUploadFileControlAction,
  runOnboardingMappingChecks,
  suggestOnboardingMapping,
} from '../src/lib/onboardingImport.ts'

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

console.log('A. Upload file control contract')
{
  const fromFile = resolveUploadFileControlAction('file')
  assert(fromFile.nextMode === 'file', 'Upload file from file mode → file mode')
  assert(fromFile.openFilePicker === true, 'Upload file from file mode opens picker')
  const fromPaste = resolveUploadFileControlAction('paste')
  assert(fromPaste.nextMode === 'file', 'Upload file from paste mode → file mode')
  assert(fromPaste.openFilePicker === true, 'Upload file from paste mode opens picker')
  assert(ONBOARDING_FILE_ACCEPT.includes('.xlsx'), 'Shared accept includes xlsx')
}

console.log('B. Wizard uses a single shared file input')
{
  const wizardPath = resolve('src/components/onboarding/OnboardingImportWizard.tsx')
  const src = readFileSync(wizardPath, 'utf8')
  const hiddenInputs = src.match(/type=["']file["']/g) ?? []
  assert(hiddenInputs.length === 1, 'Exactly one type=file input in wizard')
  assert(src.includes('data-onboarding-file-input="true"'), 'Shared input is marked')
  assert(src.includes('onUploadFileControlClick'), 'Upload file uses open-picker handler')
  assert(src.includes('resolveUploadFileControlAction'), 'Upload file uses shared action helper')
  assert(src.includes('onDrop='), 'Drop zone drag/drop wired')
  assert(src.includes('Selected:'), 'Selected filename is shown after pick')
  assert(src.includes('openFilePicker'), 'Drop zone / control share openFilePicker')
  assert(src.includes('fileInputRef'), 'Wizard keeps a fileInputRef for the shared input')
}

console.log('C. Carrier header auto-map (canonical + aliases)')
{
  const exact = suggestOnboardingMapping('carriers', ['Carrier Name', 'NAIC', 'Status'])
  assert(exact.carrier_name === 'Carrier Name', 'Carrier Name → Carrier Name')
  assert(exact.naic === 'NAIC', 'NAIC → NAIC')
  assert(exact.status === 'Status', 'Status → Status')

  assert(
    suggestOnboardingMapping('carriers', ['Carrier', 'NAIC Number', 'Status']).carrier_name ===
      'Carrier',
    'Carrier → Carrier Name',
  )
  assert(
    suggestOnboardingMapping('carriers', ['carrier_name', 'naic_number']).carrier_name ===
      'carrier_name',
    'carrier_name → Carrier Name',
  )
  assert(
    suggestOnboardingMapping('carriers', ['CarrierName', 'NAIC#']).carrier_name === 'CarrierName',
    'CarrierName → Carrier Name',
  )
  assert(
    suggestOnboardingMapping('carriers', ['CarrierName', 'NAIC Number']).naic === 'NAIC Number',
    'NAIC Number → NAIC',
  )
  assert(
    suggestOnboardingMapping('carriers', ['Weird Col', 'Foo']).carrier_name === undefined,
    'Unknown headers stay unmapped for Carrier Name',
  )
}

console.log('D. Producer / CSR / Client / Policy common headers')
{
  assert(
    suggestOnboardingMapping('producers', ['Producer Name', 'Email', 'License #']).producer_name ===
      'Producer Name',
    'Producer Name maps',
  )
  assert(
    suggestOnboardingMapping('producers', ['Agent', 'Default Split %']).producer_name === 'Agent',
    'Agent → Producer Name',
  )
  assert(
    suggestOnboardingMapping('csrs', ['CSR Name', 'Email']).csr_name === 'CSR Name',
    'CSR Name maps',
  )
  assert(
    suggestOnboardingMapping('csrs', ['Account Manager']).csr_name === 'Account Manager',
    'Account Manager → CSR Name',
  )
  assert(
    suggestOnboardingMapping('clients', ['Business Name', 'Client Number']).business_name ===
      'Business Name',
    'Business Name maps',
  )
  assert(
    suggestOnboardingMapping('clients', ['Named Insured', 'FEIN']).business_name === 'Named Insured',
    'Named Insured → Business Name',
  )
  const policyMap = suggestOnboardingMapping('policies', [
    'Insured',
    'Policy #',
    'Carrier Name',
    'Producer Split %',
    'Agent',
  ])
  assert(policyMap.client_name === 'Insured', 'Insured → Client Name')
  assert(policyMap.policy_number === 'Policy #', 'Policy # → Policy Number')
  assert(policyMap.carrier === 'Carrier Name', 'Carrier Name → Carrier (policies)')
  assert(policyMap.producer_split_percentage === 'Producer Split %', 'Producer Split % maps')
  assert(policyMap.producer === 'Agent', 'Agent → Producer (not steal split column)')
}

console.log('E. No ambiguous / wrong alias collisions')
{
  const splitOnly = suggestOnboardingMapping('policies', ['Producer Split %'])
  assert(splitOnly.producer === undefined, 'Producer Split % does not map to Producer')
  assert(
    splitOnly.producer_split_percentage === 'Producer Split %',
    'Producer Split % maps only to Producer Split %',
  )

  const carrierOnly = suggestOnboardingMapping('carriers', ['Carrier Name', 'Mystery'])
  assert(carrierOnly.carrier_name === 'Carrier Name', 'Carrier Name claimed once')
  assert(carrierOnly.notes === undefined, 'Mystery does not alias to Notes')
  assert(carrierOnly.naic === undefined, 'Mystery does not alias to NAIC')
}

console.log('F. Manual mapping replaces auto-map; duplicate column blocked')
{
  const auto = suggestOnboardingMapping('carriers', ['Carrier Name', 'NAIC', 'Status'])
  const manual = applyOnboardingMappingChange(auto, 'carrier_name', 'Status')
  assert(manual.carrier_name === 'Status', 'Manual override replaces auto Carrier Name')
  assert(manual.status === undefined, 'Same spreadsheet column cleared from Status')
  assert(manual.naic === 'NAIC', 'Unrelated NAIC mapping kept')

  const cleared = applyOnboardingMappingChange(manual, 'carrier_name', undefined)
  assert(cleared.carrier_name === undefined, 'Manual clear → Not mapped')
}

console.log('G. Match-key normalization')
{
  assert(normalizeHeaderMatchKey('Carrier Name') === 'carriername', 'Carrier Name compact')
  assert(normalizeHeaderMatchKey('carrier_name') === 'carriername', 'carrier_name compact')
  assert(normalizeHeaderMatchKey('CarrierName') === 'carriername', 'CarrierName compact')
  assert(normalizeHeaderMatchKey('NAIC #') === 'naic', 'NAIC # compact')
  assert(normalizeHeaderMatchKey('\uFEFFCarrier Name') === 'carriername', 'BOM stripped')
}

console.log('H. Existing onboarding mapping checks remain green')
{
  const checks = runOnboardingMappingChecks()
  for (const c of checks) {
    assert(c.passed, `${c.id}: ${c.name} (${c.detail})`)
  }
}

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-mapping-ux: ALL GREEN')
