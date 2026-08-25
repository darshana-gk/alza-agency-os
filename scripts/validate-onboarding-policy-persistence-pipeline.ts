/**
 * Policy onboarding persistence pipeline — representative CSV headers from QA.
 * Exercises parse → auto-map → resolve → validate → insert plan → mocked createPolicy.
 *
 * Run: npx tsx scripts/validate-onboarding-policy-persistence-pipeline.ts
 */

import {
  emptyOnboardingCaches,
  evaluateOnboardingRows,
  executeOnboardingImport,
  planOnboardingInsert,
  suggestOnboardingMapping,
  type OnboardingLookupCaches,
} from '../src/lib/onboardingImport.ts'
import { parseOnboardingDelimitedText } from '../src/lib/onboardingIntake.ts'

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

const CSV = [
  'policy_number,client,carrier,mga,producer,csr,line_of_business,effective_date,expiration_date,current_policy_premium,carrier_commission_percent,producer_split_percent,status',
  'POL-ONB-001,Existing Client LLC,Acme Insurance,Midwest MGA,Avery Producer,Blake CSR,Commercial Property,2026-01-01,2027-01-01,12500,15,60,active',
  'POL-ONB-002,Existing Client LLC,Acme Insurance,Midwest MGA,Avery Producer,Blake CSR,GL,2026-02-01,2027-02-01,8000,12,0,pending',
].join('\n')

function seedCaches(): OnboardingLookupCaches {
  const caches = emptyOnboardingCaches()
  caches.clientsByName.set('existing client llc', [
    { id: 'client-1', businessName: 'Existing Client LLC' },
  ])
  caches.carriersByName.set('acme insurance', ['Acme Insurance'])
  caches.mgasByName.set('midwest mga', ['Midwest MGA'])
  caches.producersByName.set('avery producer', ['Avery Producer'])
  caches.csrsByName.set('blake csr', ['Blake CSR'])
  caches.policiesByClientPolicy.add('client-1::pol-old')
  return caches
}

console.log('A. Auto-map QA CSV headers')
{
  const parsed = parseOnboardingDelimitedText(CSV, 'paste')
  const map = suggestOnboardingMapping('policies', parsed.headers)
  assert(map.client_name === 'client', 'client → Client Name')
  assert(map.policy_number === 'policy_number', 'policy_number → Policy Number')
  assert(map.policy_type === 'line_of_business', 'line_of_business → Policy Type')
  assert(map.carrier === 'carrier', 'carrier → Carrier')
  assert(map.mga === 'mga', 'mga → MGA')
  assert(map.producer === 'producer', 'producer → Producer')
  assert(map.csr === 'csr', 'csr → CSR')
  assert(map.effective_date === 'effective_date', 'effective_date maps')
  assert(map.expiration_date === 'expiration_date', 'expiration_date maps')
  assert(map.reference_premium === 'current_policy_premium', 'current_policy_premium → Current Policy Premium')
  assert(
    map.agency_commission_percentage === 'carrier_commission_percent',
    'carrier_commission_percent → Agency Commission %',
  )
  assert(
    map.producer_split_percentage === 'producer_split_percent',
    'producer_split_percent → Producer Split %',
  )
  assert(map.status === 'status', 'status → Policy Status')
}

console.log('B. Evaluate Ready + display + relationship resolution + premium payload')
{
  const parsed = parseOnboardingDelimitedText(CSV, 'paste')
  const mapping = suggestOnboardingMapping('policies', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'policies',
    rows: parsed.rows,
    mapping,
    caches: seedCaches(),
  })
  assert(preview.ready === 2, `Ready: 2 (got ${preview.ready})`)
  assert(preview.rows[0]?.status === 'ready', 'row1 ready')
  assert(preview.rows[0]?.payload.clientId === 'client-1', 'client resolved to client-1')
  assert(preview.rows[0]?.payload.carrier === 'Acme Insurance', 'carrier canonical name')
  assert(preview.rows[0]?.payload.mga === 'Midwest MGA', 'mga canonical name')
  assert(preview.rows[0]?.payload.producer === 'Avery Producer', 'producer canonical name')
  assert(preview.rows[0]?.payload.csr === 'Blake CSR', 'csr canonical name')
  assert(preview.rows[0]?.payload.premium === 12500, 'premium 12500 in payload')
  assert(preview.rows[0]?.payload.producerSplitPercentage === 60, 'split 60 in payload')
  assert(preview.rows[0]?.payload.agencyCommissionPercentage === 15, 'agency % 15 in payload')
  assert(preview.rows[0]?.payload.commissionType === 'percentage', 'commission type percentage')
  assert(preview.rows[1]?.payload.producerSplitPercentage === 0, 'split 0 valid')
  assert(preview.rows[0]?.display['Client'] === 'Existing Client LLC', 'display Client')
  assert(preview.rows[0]?.display['Policy Number'] === 'POL-ONB-001', 'display Policy Number')
  assert(preview.rows[0]?.display['Current Policy Premium'] === '12500', 'display premium')
  assert(preview.rows[0]?.display['Agency Commission %'] === '15', 'display agency %')
  assert(preview.rows[0]?.display['Producer Split %'] === '60', 'display split')
  assert(
    !preview.rows[0]?.reasons.some((r) => /deferred|unsupported/i.test(r)),
    'no deferred/unsupported discard language',
  )
  assert(
    preview.rows[0]?.reasons.some((r) => /policies\.premium/i.test(r)),
    'persist transparency note for policies.premium',
  )
}

console.log('C. Mocked createPolicy persists full shape; Inserted requires id')
{
  const parsed = parseOnboardingDelimitedText(CSV, 'paste')
  const mapping = suggestOnboardingMapping('policies', parsed.headers)
  const preview = evaluateOnboardingRows({
    entity: 'policies',
    rows: parsed.rows,
    mapping,
    caches: seedCaches(),
  })
  assert(planOnboardingInsert(preview).length === 2, 'insert plan 2')

  type Stored = Record<string, unknown>
  const table: Stored[] = []

  const out = await executeOnboardingImport({
    entity: 'policies',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createPolicy: async (input) => {
        const id = `pol-${table.length + 1}`
        // Same production columns createPolicy writes
        table.push({
          id,
          client_id: input.clientId,
          policy_number: input.policyNumber,
          policy_type: input.policyType || null,
          carrier: input.carrier || null,
          mga: input.mga || null,
          producer: input.producer || null,
          csr: input.csr || null,
          effective_date: input.effectiveDate || null,
          expiration_date: input.expirationDate || null,
          premium: input.premium ?? 0,
          status: input.status,
          notes: input.notes ?? null,
          commission_type: input.commissionType,
          agency_commission_percentage: input.agencyCommissionPercentage,
          agency_commission_amount: input.agencyCommissionAmount ?? 0,
          broker_fee: input.brokerFee ?? 0,
          producer_split_percentage: input.producerSplitPercentage,
        })
        return { data: { id }, error: null }
      },
    },
  })

  assert(out.error === null, 'execute ok')
  assert(out.data?.imported === 2, `imported 2 (got ${out.data?.imported})`)
  assert(out.data?.failed === 0, 'failed 0')
  assert(table[0]?.premium === 12500, 'persisted premium 12500')
  assert(table[0]?.producer_split_percentage === 60, 'persisted split 60')
  assert(table[0]?.agency_commission_percentage === 15, 'persisted agency % 15')
  assert(table[0]?.carrier === 'Acme Insurance', 'persisted carrier')
  assert(table[0]?.mga === 'Midwest MGA', 'persisted mga')
  assert(table[0]?.producer === 'Avery Producer', 'persisted producer')
  assert(table[0]?.csr === 'Blake CSR', 'persisted csr')
  assert(table[0]?.client_id === 'client-1', 'persisted client_id')
  assert(table[1]?.producer_split_percentage === 0, 'persisted split 0')
  assert(table[1]?.premium === 8000, 'persisted premium 8000')

  const noId = await executeOnboardingImport({
    entity: 'policies',
    preview,
    deps: {
      bypassAuth: true,
      skipActivity: true,
      createPolicy: async () => ({ data: null, error: null }),
    },
  })
  assert(noId.data?.imported === 0, 'no id → imported 0')
  assert(noId.data?.failed === 2, 'no id → failed 2')
}

console.log('D. Split validation + missing client + duplicate')
{
  const headers = [
    'policy_number',
    'client',
    'carrier_commission_percent',
    'producer_split_percent',
  ]
  const mapping = suggestOnboardingMapping('policies', headers)
  const caches = seedCaches()

  function row(values: unknown[]) {
    const r: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      r[h] = values[i]
    })
    return r
  }

  const blankSplit = evaluateOnboardingRows({
    entity: 'policies',
    rows: [row(['P1', 'Existing Client LLC', '10', ''])],
    mapping,
    caches,
  })
  assert(blankSplit.rows[0]?.status === 'missing_required', 'blank split missing_required')

  const zeroSplit = evaluateOnboardingRows({
    entity: 'policies',
    rows: [row(['P1', 'Existing Client LLC', '10', '0'])],
    mapping,
    caches,
  })
  assert(zeroSplit.rows[0]?.status === 'ready', '0 split ready')

  const hundred = evaluateOnboardingRows({
    entity: 'policies',
    rows: [row(['P1', 'Existing Client LLC', '10', '100'])],
    mapping,
    caches,
  })
  assert(hundred.rows[0]?.status === 'ready', '100 split ready')

  const over = evaluateOnboardingRows({
    entity: 'policies',
    rows: [row(['P1', 'Existing Client LLC', '10', '101'])],
    mapping,
    caches,
  })
  assert(over.rows[0]?.status === 'invalid', '101 split invalid')

  const missingClient = evaluateOnboardingRows({
    entity: 'policies',
    rows: [row(['P1', 'Unknown Client', '10', '60'])],
    mapping,
    caches,
  })
  assert(missingClient.rows[0]?.status === 'invalid', 'unknown client blocked')

  caches.policiesByClientPolicy.add('client-1::pol-onb-dup')
  const dup = evaluateOnboardingRows({
    entity: 'policies',
    rows: [row(['POL-ONB-DUP', 'Existing Client LLC', '10', '60'])],
    mapping,
    caches,
  })
  assert(dup.rows[0]?.status === 'skipped_duplicate', 'duplicate policy skipped')
}

console.log('')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) process.exit(1)
console.log('validate-onboarding-policy-persistence-pipeline: ALL GREEN')
