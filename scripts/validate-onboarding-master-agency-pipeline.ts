/**
 * Master Agency Data onboarding regression.
 * Run: npx tsx scripts/validate-onboarding-master-agency-pipeline.ts
 */

import { parseOnboardingDelimitedText } from '../src/lib/onboardingIntake.ts'
import {
  emptyOnboardingCaches,
  suggestOnboardingMapping,
  type OnboardingInsertDeps,
  type OnboardingLookupCaches,
  type OnboardingWriteResult,
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
  assert(actual === expected, `${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

const MASTER_CSV = [
  'client,policy_number,line_of_business,carrier,mga,producer,csr,effective_date,expiration_date,current_policy_premium,carrier_commission_percent,producer_split_percent,status',
  'ABC Plumbing,GL123,General Liability,CNA,BTIS,Michael,Taylor,2026-09-01,2027-09-01,10000,15,60,active',
  'ABC Plumbing,WC456,Workers Compensation,Hartford,RSG,Michael,Taylor,2026-09-01,2027-09-01,15000,12,60,active',
  'XYZ Electric,GL789,General Liability,Kinsale,ISC,Karen,Jennifer,2026-10-01,2027-10-01,22000,15,50,active',
].join('\n')

function summary(
  preview: ReturnType<typeof evaluateMasterAgencyImport>,
  entity: MasterAgencyChildEntity,
) {
  return preview.entities.find((e) => e.entity === entity)!
}

function mockDeps(store: {
  carriers: string[]
  mgas: string[]
  producers: string[]
  csrs: string[]
  clients: Array<{ id: string; businessName: string }>
  policies: Array<Record<string, unknown>>
  transactions: number
}): OnboardingInsertDeps {
  let clientSeq = 0
  let idSeq = 0
  const nextId = (prefix: string) => `${prefix}-${++idSeq}`

  return {
    bypassAuth: true,
    skipActivity: true,
    allocateClientNumbers: async (count) =>
      Array.from({ length: count }, () => `ALZA-${String(++clientSeq).padStart(6, '0')}`),
    createCarrier: async (input) => {
      store.carriers.push(input.carrierName)
      return { data: { id: nextId('car') }, error: null }
    },
    createMga: async (input) => {
      store.mgas.push(input.mgaName)
      return { data: { id: nextId('mga') }, error: null }
    },
    createProducer: async (input) => {
      store.producers.push(input.producerName)
      return { data: { id: nextId('prd') }, error: null }
    },
    createCsr: async (input) => {
      store.csrs.push(input.csrName)
      return { data: { id: nextId('csr') }, error: null }
    },
    createClient: async (input) => {
      const id = nextId('cli')
      store.clients.push({ id, businessName: input.businessName })
      return { data: { id }, error: null } satisfies OnboardingWriteResult
    },
    createPolicy: async (input) => {
      store.policies.push({ ...input })
      // Never create transactions from master import.
      return { data: { id: nextId('pol') }, error: null }
    },
  }
}

function seedExisting(): OnboardingLookupCaches {
  const caches = emptyOnboardingCaches()
  caches.carriersByName.set('cna', ['CNA'])
  caches.clientsByName.set('abc plumbing', [
    { id: 'existing-client-abc', businessName: 'ABC Plumbing' },
  ])
  caches.policiesByClientPolicy.add('existing-client-abc::gl123')
  return caches
}

console.log('1. Completely new master file — extract + preview counts')
{
  const parsed = parseOnboardingDelimitedText(MASTER_CSV, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  assert(mapping.client_name === 'client', 'client maps')
  assert(mapping.policy_number === 'policy_number', 'policy_number maps')
  assert(mapping.reference_premium === 'current_policy_premium', 'premium maps')
  assert(mapping.agency_commission_percentage === 'carrier_commission_percent', 'agency % maps')
  assert(mapping.producer_split_percentage === 'producer_split_percent', 'split maps')

  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })

  assertEq(summary(preview, 'carriers').newCount, 3, 'carriers New: 3')
  assertEq(summary(preview, 'mgas').newCount, 3, 'mgas New: 3')
  assertEq(summary(preview, 'producers').newCount, 2, 'producers New: 2')
  assertEq(summary(preview, 'csrs').newCount, 2, 'csrs New: 2')
  assertEq(summary(preview, 'clients').newCount, 2, 'clients New: 2')
  assertEq(summary(preview, 'policies').newCount, 3, 'policies New: 3')
  assertEq(summary(preview, 'carriers').existingSkipped, 0, 'carriers Existing/Skipped: 0')
  assertEq(summary(preview, 'policies').invalid, 0, 'policies Invalid: 0')
}

console.log('2–6. Dedup within file (carrier/mga/producer/csr/client)')
{
  const parsed = parseOnboardingDelimitedText(MASTER_CSV, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assertEq(summary(preview, 'carriers').preview.total, 3, '3 unique carriers from 3 rows')
  assertEq(summary(preview, 'mgas').preview.total, 3, '3 unique MGAs')
  assertEq(summary(preview, 'producers').preview.total, 2, 'Michael repeated → 1 producer + Karen')
  assertEq(summary(preview, 'csrs').preview.total, 2, 'Taylor repeated → 1 CSR + Jennifer')
  assertEq(summary(preview, 'clients').preview.total, 2, 'ABC Plumbing repeated → 1 client + XYZ')
}

console.log('7–9. Existing directory/clients reused; existing policies skipped')
{
  const parsed = parseOnboardingDelimitedText(MASTER_CSV, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: seedExisting(),
  })
  assertEq(summary(preview, 'carriers').existingSkipped, 1, 'CNA existing skipped')
  assertEq(summary(preview, 'carriers').newCount, 2, 'Hartford + Kinsale new')
  assertEq(summary(preview, 'clients').existingSkipped, 1, 'ABC Plumbing existing skipped')
  assertEq(summary(preview, 'clients').newCount, 1, 'XYZ Electric new')
  assertEq(summary(preview, 'policies').existingSkipped, 1, 'GL123 existing skipped')
  assert(
    summary(preview, 'policies').newCount >= 2,
    'remaining policies still new when relationships resolve',
  )
  // Hartford/RSG/Michael/Taylor may be new — policies for ABC WC456 and XYZ should be ready
  const readyPolicies = summary(preview, 'policies').preview.rows.filter((r) => r.status === 'ready')
  assert(
    readyPolicies.some((r) => r.payload.policyNumber === 'WC456'),
    'WC456 ready against existing client',
  )
  assert(
    readyPolicies.some((r) => r.payload.policyNumber === 'GL789'),
    'GL789 ready against new client pending',
  )
}

console.log('10. Missing required policy field')
{
  const bad = [
    'client,policy_number,carrier,carrier_commission_percent,producer_split_percent',
    'Solo LLC,,CNA,15,60',
  ].join('\n')
  const parsed = parseOnboardingDelimitedText(bad, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assert(summary(preview, 'policies').invalid >= 1, 'missing policy_number → invalid/missing')
  assertEq(summary(preview, 'policies').newCount, 0, 'no ready policy without number')
}

console.log('11. Invalid Producer Split %')
{
  const bad = [
    'client,policy_number,carrier,carrier_commission_percent,producer_split_percent',
    'Solo LLC,P1,CNA,15,101',
  ].join('\n')
  const parsed = parseOnboardingDelimitedText(bad, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assert(summary(preview, 'policies').invalid >= 1, 'split 101 invalid')
  assertEq(summary(preview, 'policies').newCount, 0, 'no ready policy with bad split')
}

console.log('12–15. Execute: premium, agency %, relationships, mixed existing+new')
{
  const parsed = parseOnboardingDelimitedText(MASTER_CSV, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  const caches = seedExisting()
  const preview = evaluateMasterAgencyImport({ rows: parsed.rows, mapping, caches })

  const store = {
    carriers: [] as string[],
    mgas: [] as string[],
    producers: [] as string[],
    csrs: [] as string[],
    clients: [] as Array<{ id: string; businessName: string }>,
    policies: [] as Array<Record<string, unknown>>,
    transactions: 0,
  }
  const out = await executeMasterAgencyImport({
    preview,
    deps: mockDeps(store),
  })
  assert(out.error === null, 'execute ok')
  assert(out.data != null, 'has result')
  assertEq(out.data!.createdTransactions, 0, '16. no synthetic transactions')
  assertEq(store.transactions, 0, 'store txn counter untouched')

  assert(!store.carriers.includes('CNA'), '7. existing CNA not re-created')
  assert(store.carriers.includes('Hartford'), 'Hartford created')
  assert(store.carriers.includes('Kinsale'), 'Kinsale created')
  assertEq(store.clients.length, 1, '8. only XYZ client created')
  assertEq(store.clients[0]?.businessName, 'XYZ Electric', 'XYZ client name')

  const premiums = store.policies.map((p) => Number(p.premium))
  assert(premiums.includes(15000), '12. WC456 premium 15000 → policies.premium')
  assert(premiums.includes(22000), '12. GL789 premium 22000 → policies.premium')
  assert(
    store.policies.every((p) => p.premium !== undefined && p.premium !== null),
    '12. all created policies carry premium',
  )

  const agencyPcts = store.policies.map((p) => Number(p.agencyCommissionPercentage))
  assert(agencyPcts.includes(12) || agencyPcts.includes(15), '13. agency commission % persisted')

  assert(
    store.policies.some(
      (p) =>
        p.policyNumber === 'WC456' &&
        p.clientId === 'existing-client-abc' &&
        p.producer === 'Michael' &&
        p.csr === 'Taylor',
    ),
    '14. WC456 resolves existing client + producer/CSR',
  )
  assert(
    store.policies.some(
      (p) =>
        p.policyNumber === 'GL789' &&
        String(p.clientId).startsWith('cli-') &&
        p.producer === 'Karen' &&
        p.csr === 'Jennifer' &&
        p.carrier === 'Kinsale',
    ),
    '14–15. GL789 resolves new client + relationships',
  )
  assert(
    !store.policies.some((p) => p.policyNumber === 'GL123'),
    '9. existing GL123 not re-created',
  )
}

console.log('17. Re-import same master file is idempotent')
{
  const parsed = parseOnboardingDelimitedText(MASTER_CSV, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)

  // After first import, caches reflect everything created.
  const caches = emptyOnboardingCaches()
  for (const name of ['CNA', 'Hartford', 'Kinsale']) {
    caches.carriersByName.set(name.toLowerCase(), [name])
  }
  for (const name of ['BTIS', 'RSG', 'ISC']) {
    caches.mgasByName.set(name.toLowerCase(), [name])
  }
  for (const name of ['Michael', 'Karen']) {
    caches.producersByName.set(name.toLowerCase(), [name])
  }
  for (const name of ['Taylor', 'Jennifer']) {
    caches.csrsByName.set(name.toLowerCase(), [name])
  }
  caches.clientsByName.set('abc plumbing', [
    { id: 'c-abc', businessName: 'ABC Plumbing' },
  ])
  caches.clientsByName.set('xyz electric', [
    { id: 'c-xyz', businessName: 'XYZ Electric' },
  ])
  caches.policiesByClientPolicy.add('c-abc::gl123')
  caches.policiesByClientPolicy.add('c-abc::wc456')
  caches.policiesByClientPolicy.add('c-xyz::gl789')

  const preview = evaluateMasterAgencyImport({ rows: parsed.rows, mapping, caches })
  assertEq(preview.totalNew, 0, 'idempotent: totalNew = 0')
  for (const e of preview.entities) {
    assertEq(e.newCount, 0, `idempotent: ${e.entity} New = 0`)
  }

  const store = {
    carriers: [] as string[],
    mgas: [] as string[],
    producers: [] as string[],
    csrs: [] as string[],
    clients: [] as Array<{ id: string; businessName: string }>,
    policies: [] as Array<Record<string, unknown>>,
    transactions: 0,
  }
  const out = await executeMasterAgencyImport({
    preview,
    deps: mockDeps(store),
  })
  assertEq(out.data?.imported, 0, 'idempotent execute imported 0')
  assertEq(store.carriers.length, 0, 'no duplicate carriers')
  assertEq(store.clients.length, 0, 'no duplicate clients')
  assertEq(store.policies.length, 0, 'no duplicate policies')
  assertEq(out.data?.createdTransactions, 0, 'still no transactions')
}

console.log('18. Master Agency Data policies import without agency commission')
{
  const uat = [
    'client,policy_number,line_of_business,carrier,mga,producer,csr,effective_date,expiration_date,current_policy_premium,producer_split_percent,status',
    'Alpha LLC,P1,GL,Carrier One,MGA One,Pat Producer,Casey CSR,2026-01-01,2027-01-01,10000,60,active',
    'Alpha LLC,P2,WC,Carrier Two,MGA One,Pat Producer,Casey CSR,2026-01-01,2027-01-01,8000,0,active',
    'Bravo Inc,P3,GL,Carrier Three,MGA Two,Quinn Producer,Drew CSR,2026-02-01,2027-02-01,12000,50,active',
    'Charlie Co,P4,AUTO,Carrier Four,MGA Two,Quinn Producer,Drew CSR,2026-03-01,2027-03-01,9000,40,active',
    'Delta LLC,P5,GL,Carrier One,MGA Three,Pat Producer,Casey CSR,2026-04-01,2027-04-01,11000,60,active',
    'Echo Corp,P6,WC,Carrier Two,MGA Three,Quinn Producer,Drew CSR,2026-05-01,2027-05-01,7000,25,active',
    'Echo Corp,P7,GL,Carrier Three,MGA One,Pat Producer,Casey CSR,2026-06-01,2027-06-01,13000,55,active',
    'Bravo Inc,P8,PROPERTY,Carrier Four,MGA Three,Quinn Producer,Drew CSR,2026-07-01,2027-07-01,15000,45,active',
  ].join('\n')
  const parsed = parseOnboardingDelimitedText(uat, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  assert(!mapping.commission_type, 'commission type unmapped')
  assert(!mapping.agency_commission_percentage, 'agency % unmapped')
  assert(!mapping.agency_commission_amount, 'agency amount unmapped')
  assert(!mapping.broker_fee, 'broker fee unmapped')
  assert(mapping.producer_split_percentage === 'producer_split_percent', 'producer split still mapped')

  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assertEq(summary(preview, 'carriers').newCount, 4, 'UAT-shaped: Carriers 4 New')
  assertEq(summary(preview, 'mgas').newCount, 3, 'UAT-shaped: MGAs 3 New')
  assertEq(summary(preview, 'producers').newCount, 2, 'UAT-shaped: Producers 2 New')
  assertEq(summary(preview, 'csrs').newCount, 2, 'UAT-shaped: CSRs 2 New')
  assertEq(summary(preview, 'clients').newCount, 5, 'UAT-shaped: Clients 5 New')
  assertEq(summary(preview, 'policies').newCount, 8, 'UAT-shaped: Policies 8 New')
  assertEq(summary(preview, 'policies').invalid, 0, 'UAT-shaped: Policies Invalid 0')
  assertEq(preview.totalNew, 24, 'UAT-shaped: Import 24 new records')
  assert(
    summary(preview, 'policies').preview.rows.every(
      (r) => !r.reasons.some((reason) => /agency commission is required/i.test(reason)),
    ),
    'no agency-commission required errors',
  )
  assert(
    summary(preview, 'policies').preview.rows.some((r) => r.payload.producerSplitPercentage === 0),
    'Producer Split 0 remains ready',
  )

  const store = {
    carriers: [] as string[],
    mgas: [] as string[],
    producers: [] as string[],
    csrs: [] as string[],
    clients: [] as Array<{ id: string; businessName: string }>,
    policies: [] as Array<Record<string, unknown>>,
    transactions: 0,
  }
  const out = await executeMasterAgencyImport({
    preview,
    deps: mockDeps(store),
  })
  assertEq(out.data?.imported, 24, 'execute imports 24 records')
  assertEq(out.data?.createdTransactions, 0, 'still no synthetic transactions')
  assertEq(store.policies.length, 8, '8 policies persisted')
  assert(
    store.policies.every((p) => Number(p.premium) > 0),
    'Current Policy Premium stored on policy rows',
  )
  assert(
    store.policies.some((p) => Number(p.producerSplitPercentage) === 0),
    'split 0 persisted',
  )
}

console.log('19. Empty mapped commission columns still import; blank split still blocked')
{
  const emptyComm = [
    'client,policy_number,carrier,commission_type,agency_commission_percent,agency_commission_amount,default_broker_fee,producer_split_percent',
    'Solo LLC,P-EMPTY,CNA,,,,,60',
  ].join('\n')
  const parsed = parseOnboardingDelimitedText(emptyComm, 'paste')
  const mapping = suggestOnboardingMapping('master_agency', parsed.headers)
  assert(mapping.agency_commission_percentage === 'agency_commission_percent', 'empty % column still maps')
  const preview = evaluateMasterAgencyImport({
    rows: parsed.rows,
    mapping,
    caches: emptyOnboardingCaches(),
  })
  assertEq(summary(preview, 'policies').newCount, 1, 'empty commission cells → policy New')
  assertEq(summary(preview, 'policies').invalid, 0, 'empty commission cells → not invalid')

  const blankSplit = [
    'client,policy_number,carrier,producer,producer_split_percent',
    'Solo LLC,P-SPLIT,CNA,Pat Producer,',
  ].join('\n')
  const splitParsed = parseOnboardingDelimitedText(blankSplit, 'paste')
  const splitMapping = suggestOnboardingMapping('master_agency', splitParsed.headers)
  const splitPreview = evaluateMasterAgencyImport({
    rows: splitParsed.rows,
    mapping: splitMapping,
    caches: emptyOnboardingCaches(),
  })
  assert(summary(splitPreview, 'policies').invalid >= 1, 'blank Producer Split still invalid when producer assigned')
  assertEq(summary(splitPreview, 'policies').newCount, 0, 'blank Producer Split not ready')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-master-agency-pipeline: ALL GREEN')
