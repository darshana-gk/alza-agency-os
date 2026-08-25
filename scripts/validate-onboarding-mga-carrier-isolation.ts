/**
 * MGA / Carrier write-path isolation.
 * Proves entity=mgas never calls createCarrier; entity=carriers never calls createMga;
 * Master Agency Data routes MGA children through createMga; stale preview mismatch refused.
 *
 * Run: npx tsx scripts/validate-onboarding-mga-carrier-isolation.ts
 */

import {
  emptyOnboardingCaches,
  evaluateOnboardingRows,
  executeOnboardingImport,
  suggestOnboardingMapping,
} from '../src/lib/onboardingImport.ts'
import { parseOnboardingDelimitedText } from '../src/lib/onboardingIntake.ts'
import {
  evaluateMasterAgencyImport,
  executeMasterAgencyImport,
} from '../src/lib/onboardingMasterImport.ts'

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

const MGA_CSV = ['name,status', 'ALZA TEST MGA ONE,active', 'ALZA TEST MGA TWO,active'].join('\n')
const CARRIER_CSV = ['name,status', 'ALZA TEST CARRIER ONE,active'].join('\n')

console.log('A. Individual MGA import never calls createCarrier')
{
  const parsed = parseOnboardingDelimitedText(MGA_CSV, 'paste')
  const mapping = suggestOnboardingMapping('mgas', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'mgas',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  let carrierCalls = 0
  let mgaCalls = 0
  const mgaNames: string[] = []
  const out = await executeOnboardingImport({
    entity: 'mgas',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createCarrier: async () => {
        carrierCalls += 1
        return { data: { id: 'bad-carrier' }, error: null }
      },
      createMga: async (input) => {
        mgaCalls += 1
        mgaNames.push(input.mgaName)
        return { data: { id: `mga-${mgaCalls}` }, error: null }
      },
    },
  })
  assert(out.error === null, 'MGA execute ok')
  assertEqCalls(carrierCalls, 0, 'createCarrier never called for mgas')
  assertEqCalls(mgaCalls, 2, 'createMga called twice')
  assert(mgaNames.includes('ALZA TEST MGA ONE'), 'wrote ALZA TEST MGA ONE via createMga')
  assert(mgaNames.includes('ALZA TEST MGA TWO'), 'wrote ALZA TEST MGA TWO via createMga')
}

console.log('B. Individual Carrier import never calls createMga')
{
  const parsed = parseOnboardingDelimitedText(CARRIER_CSV, 'paste')
  const mapping = suggestOnboardingMapping('carriers', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  let carrierCalls = 0
  let mgaCalls = 0
  const out = await executeOnboardingImport({
    entity: 'carriers',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createCarrier: async (input) => {
        carrierCalls += 1
        assert(input.carrierName === 'ALZA TEST CARRIER ONE', 'carrier payload name')
        return { data: { id: 'car-1' }, error: null }
      },
      createMga: async () => {
        mgaCalls += 1
        return { data: { id: 'bad-mga' }, error: null }
      },
    },
  })
  assert(out.error === null, 'Carrier execute ok')
  assertEqCalls(mgaCalls, 0, 'createMga never called for carriers')
  assertEqCalls(carrierCalls, 1, 'createCarrier called once')
}

console.log('C. Stale preview/entity mismatch refused')
{
  const parsed = parseOnboardingDelimitedText(MGA_CSV, 'paste')
  const mapping = suggestOnboardingMapping('carriers', parsed.headers)
  const carrierPreview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  let carrierCalls = 0
  let mgaCalls = 0
  const out = await executeOnboardingImport({
    entity: 'mgas',
    preview: carrierPreview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createCarrier: async () => {
        carrierCalls += 1
        return { data: { id: 'x' }, error: null }
      },
      createMga: async () => {
        mgaCalls += 1
        return { data: { id: 'y' }, error: null }
      },
    },
  })
  assert(out.data === null, 'mismatch returns no data')
  assert(Boolean(out.error && /mismatch/i.test(out.error)), 'mismatch error message')
  assertEqCalls(carrierCalls, 0, 'mismatch: no createCarrier')
  assertEqCalls(mgaCalls, 0, 'mismatch: no createMga')
}

console.log('D. Same MGA file under Carriers writes createCarrier (historical pollution path)')
{
  // Documents how ALZA TEST MGA ONE/TWO landed in public.carriers historically:
  // import ran with entity=carriers while spreadsheet contained MGA names.
  const parsed = parseOnboardingDelimitedText(MGA_CSV, 'paste')
  const mapping = suggestOnboardingMapping('carriers', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'carriers',
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assert(preview.entity === 'carriers', 'preview entity carriers')
  assert(preview.rows[0]?.payload.carrierName === 'ALZA TEST MGA ONE', 'names become carrierName')
  const carrierWrites: string[] = []
  await executeOnboardingImport({
    entity: 'carriers',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createCarrier: async (input) => {
        carrierWrites.push(input.carrierName)
        return { data: { id: `c-${carrierWrites.length}` }, error: null }
      },
      createMga: async () => {
        throw new Error('must not call createMga')
      },
    },
  })
  assert(
    carrierWrites.includes('ALZA TEST MGA ONE') && carrierWrites.includes('ALZA TEST MGA TWO'),
    'historical path: MGA labels written via createCarrier when entity=carriers',
  )
}

console.log('E. Master Agency Data uses createMga for MGA children / createCarrier for carriers')
{
  const csv = [
    'client,policy_number,carrier,mga,producer,csr,current_policy_premium,carrier_commission_percent,producer_split_percent,status',
    'Client A,P1,CarrierX,MgaY,ProdZ,CsrW,1000,15,60,active',
  ].join('\n')
  const parsed = parseOnboardingDelimitedText(csv, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  const carrierWrites: string[] = []
  const mgaWrites: string[] = []
  let id = 0
  const out = await executeMasterAgencyImport({
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      allocateClientNumbers: async (n) =>
        Array.from({ length: n }, (_, i) => `ALZA-${String(i + 1).padStart(6, '0')}`),
      createCarrier: async (input) => {
        carrierWrites.push(input.carrierName)
        return { data: { id: `car-${++id}` }, error: null }
      },
      createMga: async (input) => {
        mgaWrites.push(input.mgaName)
        return { data: { id: `mga-${++id}` }, error: null }
      },
      createProducer: async () => ({ data: { id: `prd-${++id}` }, error: null }),
      createCsr: async () => ({ data: { id: `csr-${++id}` }, error: null }),
      createClient: async () => ({ data: { id: `cli-${++id}` }, error: null }),
      createPolicy: async () => ({ data: { id: `pol-${++id}` }, error: null }),
    },
  })
  assert(out.error === null, 'master execute ok')
  assert(carrierWrites.includes('CarrierX'), 'master carrier → createCarrier')
  assert(mgaWrites.includes('MgaY'), 'master mga → createMga')
  assert(!carrierWrites.includes('MgaY'), 'MGA name never written via createCarrier in master')
  assert(!mgaWrites.includes('CarrierX'), 'Carrier name never written via createMga in master')
}

function assertEqCalls(actual: number, expected: number, message: string) {
  assert(actual === expected, `${message} (got ${actual}, expected ${expected})`)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-mga-carrier-isolation: ALL GREEN')
