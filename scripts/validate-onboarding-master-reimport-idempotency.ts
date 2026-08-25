/**
 * Master Agency Data re-import idempotency — exact Existing/Skipped counts.
 * Fixture mirrors the 3-policy / 2-of-each-directory QA shape.
 *
 * Run: npx tsx scripts/validate-onboarding-master-reimport-idempotency.ts
 */

import { parseOnboardingDelimitedText } from '../src/lib/onboardingIntake.ts'
import {
  emptyOnboardingCaches,
  suggestOnboardingMapping,
  type OnboardingLookupCaches,
} from '../src/lib/onboardingImport.ts'
import {
  evaluateMasterAgencyImport,
  executeMasterAgencyImport,
  type MasterAgencyChildEntity,
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

function assertEq(actual: unknown, expected: unknown, message: string) {
  assert(
    actual === expected,
    `${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  )
}

const FIXTURE = [
  'client,policy_number,line_of_business,carrier,mga,producer,csr,effective_date,expiration_date,current_policy_premium,carrier_commission_percent,producer_split_percent,status',
  'ALZA MASTER CLIENT ONE,MASTER-GL-001,General Liability,Master Carrier A,Master MGA A,Master Producer A,Master CSR A,2026-09-01,2027-09-01,12000,15,60,active',
  'ALZA MASTER CLIENT ONE,MASTER-WC-002,Workers Compensation,Master Carrier B,Master MGA B,Master Producer A,Master CSR A,2026-09-01,2027-09-01,18000,12,60,active',
  'ALZA MASTER CLIENT TWO,MASTER-GL-003,General Liability,Master Carrier A,Master MGA A,Master Producer B,Master CSR B,2026-10-01,2027-10-01,22000,15,50,active',
].join('\n')

function seedAfterFirstImport(): OnboardingLookupCaches {
  const caches = emptyOnboardingCaches()
  for (const name of ['Master Carrier A', 'Master Carrier B']) {
    caches.carriersByName.set(name.toLowerCase(), [name])
  }
  for (const name of ['Master MGA A', 'Master MGA B']) {
    caches.mgasByName.set(name.toLowerCase(), [name])
  }
  for (const name of ['Master Producer A', 'Master Producer B']) {
    caches.producersByName.set(name.toLowerCase(), [name])
  }
  for (const name of ['Master CSR A', 'Master CSR B']) {
    caches.csrsByName.set(name.toLowerCase(), [name])
  }
  caches.clientsByName.set('alza master client one', [
    { id: 'c1', businessName: 'ALZA MASTER CLIENT ONE' },
  ])
  caches.clientsByName.set('alza master client two', [
    { id: 'c2', businessName: 'ALZA MASTER CLIENT TWO' },
  ])
  caches.policiesByClientPolicy.add('c1::master-gl-001')
  caches.policiesByClientPolicy.add('c1::master-wc-002')
  caches.policiesByClientPolicy.add('c2::master-gl-003')
  return caches
}

function summary(
  preview: ReturnType<typeof evaluateMasterAgencyImport>,
  entity: MasterAgencyChildEntity,
) {
  return preview.entities.find((e) => e.entity === entity)!
}

console.log('A. First import preview (all new)')
{
  const parsed = parseOnboardingDelimitedText(FIXTURE, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assertEq(summary(preview, 'carriers').newCount, 2, 'first: Carriers New 2')
  assertEq(summary(preview, 'mgas').newCount, 2, 'first: MGAs New 2')
  assertEq(summary(preview, 'producers').newCount, 2, 'first: Producers New 2')
  assertEq(summary(preview, 'csrs').newCount, 2, 'first: CSRs New 2')
  assertEq(summary(preview, 'clients').newCount, 2, 'first: Clients New 2')
  assertEq(summary(preview, 'policies').newCount, 3, 'first: Policies New 3')
  assert(preview.totalNew > 0, 'first: Import actionable (totalNew > 0)')
}

console.log('B. Second re-import — all Existing/Skipped, New 0')
{
  const parsed = parseOnboardingDelimitedText(FIXTURE, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: seedAfterFirstImport(),
  })

  assertEq(summary(preview, 'carriers').newCount, 0, 'Carriers New 0')
  assertEq(summary(preview, 'carriers').existingSkipped, 2, 'Carriers Existing/Skipped 2')
  assertEq(summary(preview, 'mgas').newCount, 0, 'MGAs New 0')
  assertEq(summary(preview, 'mgas').existingSkipped, 2, 'MGAs Existing/Skipped 2')
  assertEq(summary(preview, 'producers').newCount, 0, 'Producers New 0')
  assertEq(summary(preview, 'producers').existingSkipped, 2, 'Producers Existing/Skipped 2')
  assertEq(summary(preview, 'csrs').newCount, 0, 'CSRs New 0')
  assertEq(summary(preview, 'csrs').existingSkipped, 2, 'CSRs Existing/Skipped 2')
  assertEq(summary(preview, 'clients').newCount, 0, 'Clients New 0')
  assertEq(summary(preview, 'clients').existingSkipped, 2, 'Clients Existing/Skipped 2')
  assertEq(summary(preview, 'policies').newCount, 0, 'Policies New 0')
  assertEq(summary(preview, 'policies').existingSkipped, 3, 'Policies Existing/Skipped 3')
  assertEq(preview.totalNew, 0, 'Import button non-actionable (totalNew = 0)')

  let writes = 0
  const out = await executeMasterAgencyImport({
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createCarrier: async () => {
        writes += 1
        return { data: { id: 'x' }, error: null }
      },
      createMga: async () => {
        writes += 1
        return { data: { id: 'x' }, error: null }
      },
      createProducer: async () => {
        writes += 1
        return { data: { id: 'x' }, error: null }
      },
      createCsr: async () => {
        writes += 1
        return { data: { id: 'x' }, error: null }
      },
      createClient: async () => {
        writes += 1
        return { data: { id: 'x' }, error: null }
      },
      createPolicy: async () => {
        writes += 1
        return { data: { id: 'x' }, error: null }
      },
    },
  })
  assert(out.error === null, 're-import execute ok')
  assertEq(out.data?.imported, 0, 're-import imported 0')
  assertEq(writes, 0, 'no create* calls on re-import')
  assertEq(out.data?.createdTransactions, 0, 'no transactions')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-master-reimport-idempotency: ALL GREEN')
