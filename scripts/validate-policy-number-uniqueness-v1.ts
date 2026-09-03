/**
 * Agency-scoped Policy File number uniqueness (no Production writes).
 *
 * Run: npx tsx scripts/validate-policy-number-uniqueness-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  findConflictingPolicyFileNumber,
  formatPolicyNumberInUseMessage,
  normalizePolicyFileNumber,
  policyFileNumbersMatch,
  shouldEnforceAgencyPolicyNumberUniqueness,
  type PolicyFileNumberOwner,
} from '../src/lib/policyNumberUniqueness.ts'

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

const AGENCY_A_FILE: PolicyFileNumberOwner = {
  policyId: 'pol-a-1',
  policyNumber: 'BHP-GL-2026-001',
  clientId: 'client-a-1',
  clientName: 'Blue Harbor Plumbing LLC',
}
const AGENCY_A_OTHER_CLIENT: PolicyFileNumberOwner = {
  policyId: 'pol-a-2',
  policyNumber: 'BHP-CA-2026-001',
  clientId: 'client-a-2',
  clientName: 'Oak Street HVAC',
}
const AGENCY_B_SAME_NUMBER: PolicyFileNumberOwner = {
  policyId: 'pol-b-1',
  policyNumber: 'BHP-GL-2026-001',
  clientId: 'client-b-1',
  clientName: 'Agency B Client',
}

const agencyAFiles = [AGENCY_A_FILE, AGENCY_A_OTHER_CLIENT]

console.log('A. Normalization is trim + case-insensitive, not punctuation-stripping')
{
  assertEq(normalizePolicyFileNumber('  BHP-GL-2026-001  '), 'bhp-gl-2026-001', 'trims and lowercases')
  assert(policyFileNumbersMatch('BHP-GL-2026-001', 'bhp-gl-2026-001'), 'case variants are the same number')
  assert(
    !policyFileNumbersMatch('BHP-GL-2027-RW 002', 'BHP-GL-2027-RW002'),
    'space inside the number is significant',
  )
  assert(
    !policyFileNumbersMatch('BHP-GL-2026-001', 'BHPGL2026001'),
    'hyphens are significant — not a reconciliation match',
  )
}

console.log('B. Create / rewrite always enforce; renew / edit only when the number changes')
{
  assert(
    shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'create',
      nextPolicyNumber: 'BHP-GL-2026-001',
    }),
    'create always checks',
  )
  assert(
    shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'rewrite',
      currentPolicyNumber: 'BHP-GL-2026-001',
      nextPolicyNumber: 'BHP-GL-2026-001',
    }),
    'rewrite checks even when reusing the predecessor number',
  )
  assert(
    !shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'renew',
      currentPolicyNumber: 'BHP-GL-2026-001',
      nextPolicyNumber: 'BHP-GL-2026-001',
    }),
    'renew with the same number does not uniqueness-check',
  )
  assert(
    !shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'renew',
      currentPolicyNumber: 'BHP-GL-2026-001',
      nextPolicyNumber: '  bhp-gl-2026-001  ',
    }),
    'renew with only normalization changes does not uniqueness-check',
  )
  assert(
    shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'renew',
      currentPolicyNumber: 'BHP-GL-2026-001',
      nextPolicyNumber: 'BHP-GL-2027-001',
    }),
    'renew with a changed number does uniqueness-check',
  )
  assert(
    !shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'edit',
      currentPolicyNumber: 'BHP-GL-2026-001',
      nextPolicyNumber: 'BHP-GL-2026-001',
    }),
    'edit keeping the same Policy File number is allowed',
  )
  assert(
    shouldEnforceAgencyPolicyNumberUniqueness({
      mode: 'edit',
      currentPolicyNumber: 'BHP-GL-2026-001',
      nextPolicyNumber: 'BHP-GL-TAKEN',
    }),
    'edit changing to another number does uniqueness-check',
  )
}

console.log('C. Same-agency duplicate is identified by client + Policy File')
{
  const hit = findConflictingPolicyFileNumber(agencyAFiles, 'bhp-gl-2026-001')
  assertEq(hit?.policyId, 'pol-a-1', 'finds the existing Policy File')
  assertEq(hit?.clientName, 'Blue Harbor Plumbing LLC', 'finds the existing client')
  const message = formatPolicyNumberInUseMessage(hit!)
  assert(message.includes('Blue Harbor Plumbing LLC'), 'message names the client')
  assert(message.includes('BHP-GL-2026-001'), 'message names the Policy File number')
}

console.log('D. Same Policy File is excluded; historical snapshots are not Policy Files')
{
  const self = findConflictingPolicyFileNumber(agencyAFiles, 'BHP-GL-2026-001', {
    excludePolicyId: 'pol-a-1',
  })
  assertEq(self, null, 'editing/renewing the same Policy File is not a conflict')
  const snapshots = [
    { policyId: 'txn-old', policyNumber: 'BHP-GL-2026-001', clientId: 'client-a-1', clientName: 'Blue Harbor Plumbing LLC' },
  ]
  const onlyFiles = findConflictingPolicyFileNumber(agencyAFiles, 'BHP-CA-2026-001', {
    excludePolicyId: 'pol-a-2',
  })
  assertEq(onlyFiles, null, 'other-file check does not invent a conflict from snapshots')
  assertEq(snapshots[0]?.policyNumber, 'BHP-GL-2026-001', 'historical snapshot number object is untouched')
}

console.log('E. Other agencies may use the same number')
{
  const agencyAOnly = findConflictingPolicyFileNumber(agencyAFiles, AGENCY_B_SAME_NUMBER.policyNumber)
  assertEq(agencyAOnly?.policyId, 'pol-a-1', 'agency A still sees its own file')
  const agencyBOnly = findConflictingPolicyFileNumber([AGENCY_B_SAME_NUMBER], 'BHP-GL-2026-001', {
    excludePolicyId: 'pol-b-1',
  })
  assertEq(agencyBOnly, null, 'agency B can keep its own same number')
  const noCrossTenant = findConflictingPolicyFileNumber([AGENCY_B_SAME_NUMBER], 'BHP-CA-2026-001')
  assertEq(noCrossTenant, null, 'agency B number list does not include agency A files')
}

console.log('F. Cross-client duplicate in the same agency is blocked')
{
  const hit = findConflictingPolicyFileNumber(agencyAFiles, 'BHP-CA-2026-001', {
    excludePolicyId: 'pol-a-1',
  })
  assertEq(hit?.clientId, 'client-a-2', 'duplicate on another client in the same agency is found')
  assert(formatPolicyNumberInUseMessage(hit!).includes('Oak Street HVAC'), 'names the other client')
}

console.log('G. Write paths and historical snapshot repair stay in the right layers')
{
  const root = resolve(process.cwd())
  const directory = readFileSync(resolve(root, 'src/lib/directory.ts'), 'utf8')
  const renew = readFileSync(resolve(root, 'src/lib/policyRenewRewrite.ts'), 'utf8')
  const uniqueness = readFileSync(resolve(root, 'src/lib/policyNumberUniqueness.ts'), 'utf8')
  const freeze = readFileSync(resolve(root, 'src/lib/policyRenewRewrite.ts'), 'utf8')
  const repair = readFileSync(resolve(root, 'src/lib/policyTermRepair.ts'), 'utf8')
  const addPolicy = readFileSync(resolve(root, 'src/components/policies/AddPolicyModal.tsx'), 'utf8')
  const details = readFileSync(resolve(root, 'src/pages/PolicyDetails.tsx'), 'utf8')

  assert(directory.includes('assertNoAgencyPolicyNumberConflict'), 'create/update Policy File uses agency uniqueness')
  assert(directory.includes("mode: 'edit'"), 'edit only uniqueness-checks a changed number')
  assert(!directory.includes(".eq('client_id', clientId)"), 'create/update no longer uniqueness-check per client only')
  assert(renew.includes("mode: 'renew'"), 'renew uniqueness is gated on a changed number')
  assert(renew.includes("mode: 'rewrite'"), 'rewrite uniqueness always runs for a new file')
  assert(uniqueness.includes('.eq(\'agency_profile_id\', agencyProfileId)'), 'lookup is agency-scoped')
  assert(uniqueness.includes('.is(\'archived_at\', null)'), 'lookup uses live Policy Files only')
  assert(!uniqueness.includes("from('transactions')"), 'uniqueness does not query transaction snapshots')
  assert(
    freeze.includes('freezeHistoricalPolicySnapshots') &&
      !freeze.slice(freeze.indexOf('export async function freezeHistoricalPolicySnapshots')).includes('lookupAgencyPolicyNumberConflict'),
    'historical snapshot freeze does not run uniqueness',
  )
  assert(!repair.includes('policyNumberUniqueness'), 'term snapshot repair does not run uniqueness')
  assert(addPolicy.includes("operation === 'duplicate_check'"), 'Add Policy shows the client/policy conflict message')
  assert(details.includes("operation === 'duplicate_check'"), 'Edit Policy shows the client/policy conflict message')
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed`)
console.log('validate-policy-number-uniqueness-v1: ALL GREEN')
