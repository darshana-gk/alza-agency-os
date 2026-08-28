/**
 * Multi-tenancy V1 Phase 2B — source-only regressions (no database, no network).
 * Run: npx tsx scripts/validate-multitenancy-phase2b.ts
 *
 * Asserts 2B-prep + 2B-finalize are tenant uniqueness/numbering/integrity only.
 * Does not apply the migrations.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const prepName = '20260828200000_multitenancy_v1_phase2b_prep_uniques_and_counters.sql'
const finalName = '20260828210000_multitenancy_v1_phase2b_finalize_numbering_and_integrity.sql'
const phase2aName = '20260828180000_multitenancy_v1_phase2a_tenant_columns.sql'
const notesPath = resolve(root, 'docs/multitenancy-v1-implementation-notes.md')

const FORBIDDEN_TOUCH = [
  'src/lib/integrations/catalog.ts',
  'src/pages/SupportCenter.tsx',
  'src/lib/support.ts',
  'src/lib/billing.ts',
  'src/pages/admin/SubscriptionBilling.tsx',
  'supabase/functions/run-reconciliation-matching/index.ts',
  'supabase/functions/create-razorpay-subscription/index.ts',
  'src/lib/commission.ts',
  'src/lib/onboardingImport.ts',
  'src/lib/permissions.ts',
] as const

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

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

const prep = readFileSync(resolve(root, 'supabase/migrations', prepName), 'utf8')
const fin = readFileSync(resolve(root, 'supabase/migrations', finalName), 'utf8')
const prepBody = stripSqlComments(prep)
const finBody = stripSqlComments(fin)
const bothBody = `${prepBody}\n${finBody}`
const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : ''

console.log('A. Files present and ordered')
{
  assert(existsSync(resolve(root, 'supabase/migrations', phase2aName)), 'Phase 2A migration still present')
  assert(existsSync(resolve(root, 'supabase/migrations', prepName)), '2B-prep exists')
  assert(existsSync(resolve(root, 'supabase/migrations', finalName)), '2B-finalize exists')
  assert(prep.includes('Phase 2B-prep'), 'prep names Phase 2B-prep')
  assert(fin.includes('Phase 2B-finalize'), 'finalize names Phase 2B-finalize')
  assert(prep.includes('Do NOT apply to Production'), 'prep production warning')
  assert(fin.includes('Do NOT apply to Production'), 'finalize production warning')
  assert(prepName < finalName, 'prep stamp precedes finalize')
}

console.log('B. Tenant-scoped counters — no singleton/first-agency fallback')
{
  assert(prepBody.includes('ON CONFLICT (year)'), 'prep still uses year conflict (functions unchanged)')
  assert(finBody.includes('ON CONFLICT (agency_profile_id, year)'), 'finalize counters are (agency, year)')
  assert(fin.includes('multitenancy_numbering_agency'), 'finalize uses numbering helper')
  assert(prep.includes('Does not stamp agency_profile_id'), 'helper does not stamp rows')
  assert(!/FROM public\.agency_profile[\s\S]{0,40}LIMIT 1/i.test(bothBody), 'no first-agency LIMIT 1 fallback')
  assert(!/ORDER BY .*agency_profile[\s\S]{0,30}LIMIT 1/i.test(bothBody), 'no arbitrary agency selection')
  assert(prep.includes('current_user_agency_profile_id'), 'session membership is the derived context')
  assert(fin.includes('NEW.agency_profile_id'), 'generators read agency from the inserting row')
  assert(fin.includes('PRIMARY KEY USING INDEX transaction_number_counters_agency_year_uidx'), 'txn counter PK swapped')
  assert(fin.includes('PRIMARY KEY USING INDEX producer_payment_batch_number_counters_agency_year_uidx'), 'batch counter PK swapped')
  assert(fin.includes('PRIMARY KEY USING INDEX recovery_number_counters_agency_year_uidx'), 'recovery counter PK swapped')
}

console.log('C. Historical numbers preserved')
{
  assert(prep.includes('GREATEST'), 'counter last_value uses GREATEST vs historical max')
  assert(prep.includes('regexp_match(t.transaction_number'), 'parses existing TRX numbers')
  assert(prep.includes('regexp_match(b.batch_number'), 'parses existing batch numbers')
  assert(prep.includes('regexp_match(r.recovery_number'), 'parses existing RCV numbers')
  assert(!/SET\s+transaction_number\s*=/i.test(prepBody), 'prep does not rewrite transaction_number')
  assert(!/SET\s+batch_number\s*=/i.test(prepBody), 'prep does not rewrite batch_number')
  assert(!/SET\s+recovery_number\s*=/i.test(prepBody), 'prep does not rewrite recovery_number')
  assert(!/SET\s+transaction_number\s*=/i.test(finBody), 'finalize does not rewrite transaction_number')
  assert(!/SET\s+batch_number\s*=/i.test(finBody), 'finalize does not rewrite batch_number')
  assert(!/SET\s+recovery_number\s*=/i.test(finBody), 'finalize does not rewrite recovery_number')
}

console.log('D. Tenant-scoped uniqueness + global uniques retained until Phase 3')
{
  assert(prep.includes('clients_agency_client_number_uidx'), 'tenant-scoped client_number')
  assert(prep.includes('clients_transitional_global_client_number_uidx'), 'transitional global client_number for stamp-safety')
  assert(prep.includes('policies_client_policy_number_uidx'), 'policy_number unique per client')
  assert(prep.includes('not per agency'), 'policy uniqueness is not agency-global')
  assert(prep.includes('transactions_agency_transaction_number_uidx'), 'tenant-scoped transaction_number')
  assert(prep.includes('producer_payment_batches_agency_batch_number_uidx'), 'tenant-scoped batch_number')
  assert(prep.includes('producer_commission_recoveries_agency_recovery_number_uidx'), 'tenant-scoped recovery_number')
  assert(prep.includes('transactions_null_agency_transaction_number_uidx'), 'NULL-agency transaction_number bridge')
  assert(prep.includes('producer_payment_batches_null_agency_batch_number_uidx'), 'NULL-agency batch_number bridge')
  assert(prep.includes('producer_commission_recoveries_null_agency_recovery_number_uidx'), 'NULL-agency recovery_number bridge')
  assert(prep.includes('clients_null_agency_client_number_uidx'), 'NULL-agency client_number bridge')
  assert(
    !/DROP CONSTRAINT[\s\S]{0,40}transactions_transaction_number_key/i.test(finBody),
    'finalize does not drop transactions_transaction_number_key',
  )
  assert(
    !/DROP INDEX[\s\S]{0,80}transactions_transaction_number_uidx/i.test(finBody),
    'finalize does not drop transactions_transaction_number_uidx',
  )
  assert(
    !/DROP CONSTRAINT[\s\S]{0,40}producer_payment_batches_batch_number_key/i.test(finBody),
    'finalize does not drop global batch_number unique',
  )
  assert(
    !/DROP CONSTRAINT[\s\S]{0,40}producer_commission_recoveries_recovery_number_key/i.test(finBody),
    'finalize does not drop global recovery_number unique',
  )
  assert(fin.includes('Retain global number uniqueness until Phase 3'), 'finalize documents global unique retention')
  assert(prep.includes('Directory names: no unique index'), 'directory uniqueness deferred/not added')
}

console.log('E. Cross-tenant relationship integrity')
{
  assert(prep.includes('UNIQUE (id, agency_profile_id)'), 'parent unique (id, agency) for composite FKs')
  assert(fin.includes('policies_client_tenant_fkey'), 'policy → client tenant FK')
  assert(fin.includes('transactions_client_tenant_fkey'), 'transaction → client tenant FK')
  assert(fin.includes('transactions_policy_tenant_fkey'), 'transaction → policy tenant FK')
  assert(fin.includes('receipts_transaction_tenant_fkey'), 'receipt → transaction tenant FK')
  assert(fin.includes('batch_items_batch_tenant_fkey'), 'batch item → batch tenant FK')
  assert(fin.includes('batch_items_transaction_tenant_fkey'), 'batch item → transaction tenant FK')
  assert(fin.includes('recoveries_transaction_tenant_fkey'), 'recovery → transaction tenant FK')
  assert(fin.includes('allocations_recovery_tenant_fkey'), 'allocation → recovery tenant FK')
  assert(fin.includes('allocations_batch_tenant_fkey'), 'allocation → batch tenant FK')
  assert(fin.includes('recon_rows_statement_tenant_fkey'), 'recon row → statement tenant FK')
  assert(fin.includes('recon_rows_transaction_tenant_fkey'), 'recon row → matched transaction tenant FK')
  assert(fin.includes('supporting_docs_transaction_tenant_fkey'), 'supporting document → transaction tenant FK')
  assert(fin.includes('supporting_docs_recovery_tenant_fkey'), 'supporting document → recovery tenant FK')
  assert(fin.includes('A + B     → rejected'), 'MATCH SIMPLE matrix documents A+B rejection')
  assert(fin.includes('NULL + A  → allowed'), 'MATCH SIMPLE matrix documents NULL child skip')
  assert(fin.includes('A + NULL  → rejected'), 'MATCH SIMPLE matrix documents stamped child vs NULL parent')
  assert(fin.includes('NULL+NULL → allowed'), 'MATCH SIMPLE matrix documents NULL/NULL skip')
}

console.log('F. NOT NULL timing + singleton retained')
{
  assert(prepBody.includes('ALTER COLUMN agency_profile_id SET NOT NULL'), 'counters SET NOT NULL in prep')
  assert(!/ALTER TABLE public\.clients[\s\S]{0,80}SET NOT NULL/i.test(bothBody), 'clients not SET NOT NULL')
  assert(!/ALTER TABLE public\.transactions[\s\S]{0,80}SET NOT NULL/i.test(bothBody), 'transactions not SET NOT NULL')
  assert(!/ALTER TABLE public\.policies[\s\S]{0,80}SET NOT NULL/i.test(bothBody), 'policies not SET NOT NULL')
  assert(!/agency_profile_id IS NOT NULL\) NOT VALID/i.test(bothBody), 'no NOT VALID NOT NULL check on app rows')
  assert(!/DROP CONSTRAINT[\s\S]{0,40}singleton/i.test(bothBody), 'does not drop singleton')
  assert(fin.includes('drop agency_profile_singleton (Phase 3/4'), 'documents singleton deferred to 3/4')
}

console.log('G. No Phase 3 RLS / app / Billing / Support / Integrations / task counters')
{
  assert(!/CREATE POLICY/i.test(bothBody), 'no CREATE POLICY')
  assert(!/DROP POLICY/i.test(bothBody), 'no DROP POLICY')
  assert(!/ENABLE ROW LEVEL SECURITY/i.test(bothBody), 'no ENABLE ROW LEVEL SECURITY')
  assert(!/\btask_number_counters\b/.test(bothBody), 'task_number_counters untouched')
  assert(!/session_replication_role/i.test(bothBody), 'no session_replication_role')
  for (const rel of FORBIDDEN_TOUCH) {
    assert(existsSync(resolve(root, rel)), `baseline file still present: ${rel}`)
  }
  const matching = readFileSync(
    resolve(root, 'supabase/functions/run-reconciliation-matching/index.ts'),
    'utf8',
  )
  assert(matching.includes(".from('transactions')"), 'recon matching still unscoped (Phase 4)')
  const extra = readdirSync(resolve(root, 'supabase/migrations')).filter((f) => {
    if (!f.endsWith('.sql')) return false
    const stamp = f.slice(0, 14)
    return stamp > '20260828210000'
  })
  assert(extra.length === 0, `no migrations after 2B-finalize (${extra.join(', ') || 'none'})`)
}

console.log('H. Implementation notes record 2B decisions')
{
  assert(existsSync(notesPath), 'implementation notes exist')
  assert(notes.includes('Phase 2B'), 'notes include Phase 2B')
  assert(notes.includes('task_number_counters'), 'notes cover task_number_counters')
  assert(notes.includes('agency_profile_singleton'), 'notes cover singleton timing')
  assert(notes.includes('per client'), 'notes cover policy uniqueness per client')
  assert(notes.includes('Directory'), 'notes cover directory uniqueness decision')
  assert(notes.includes('Phase 3'), 'notes cover Phase 3 dependencies')
  assert(notes.includes('retain') || notes.includes('Retain') || notes.includes('retained'), 'notes retain global number uniques until Phase 3')
}

type NumberedRow = { agency: string | null; number: string }

function violatesTenantPartial(rows: NumberedRow[]): boolean {
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.agency === null) continue
    const k = `${r.agency}::${r.number}`
    if (seen.has(k)) return true
    seen.add(k)
  }
  return false
}

function violatesNullPartial(rows: NumberedRow[]): boolean {
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.agency !== null) continue
    if (seen.has(r.number)) return true
    seen.add(r.number)
  }
  return false
}

function violatesGlobal(rows: NumberedRow[]): boolean {
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.number)) return true
    seen.add(r.number)
  }
  return false
}

console.log('I. Transitional NULL uniqueness + future tenant-stamping collision safety')
{
  const agencyANullSameNumber: NumberedRow[] = [
    { agency: 'A', number: 'TRX-2026-000050' },
    { agency: null, number: 'TRX-2026-000050' },
  ]
  assert(!violatesTenantPartial(agencyANullSameNumber), 'partial tenant unique allows A + NULL same number')
  assert(!violatesNullPartial(agencyANullSameNumber), 'NULL-bucket unique allows A + NULL same number')
  assert(violatesGlobal(agencyANullSameNumber), 'global unique rejects A + NULL same number')

  const stamped = agencyANullSameNumber.map((r) => ({
    agency: r.agency ?? 'A',
    number: r.number,
  }))
  assert(violatesTenantPartial(stamped), 'stamping NULL → A would violate tenant unique if global was dropped')
  assert(prep.includes('do NOT prevent'), 'prep documents NULL-bridge stamp-safety hole')
  assert(prep.includes('Stamp-safety therefore requires a global unique'), 'prep requires global unique for stamp-safety')

  const twoNullDup: NumberedRow[] = [
    { agency: null, number: 'TRX-2026-000051' },
    { agency: null, number: 'TRX-2026-000051' },
  ]
  assert(violatesNullPartial(twoNullDup), 'NULL bridge rejects two NULL rows with the same number')
  assert(violatesGlobal(twoNullDup), 'global unique also rejects two NULL rows with the same number')

  const twoAgenciesSameNumber: NumberedRow[] = [
    { agency: 'A', number: 'TRX-2026-000001' },
    { agency: 'B', number: 'TRX-2026-000001' },
  ]
  assert(!violatesTenantPartial(twoAgenciesSameNumber), 'tenant unique allows Agency A and B to share a number')
  assert(violatesGlobal(twoAgenciesSameNumber), 'global unique still blocks A/B sharing until Phase 3 (singleton also blocks Agency B)')

  const generatedSharedCounter: NumberedRow[] = [
    { agency: 'A', number: 'TRX-2026-000101' },
    { agency: null, number: 'TRX-2026-000102' },
  ]
  assert(!violatesGlobal(generatedSharedCounter), 'shared Agency-A counter yields distinct numbers for stamped vs NULL inserts')
  const stampedGenerated = generatedSharedCounter.map((r) => ({
    agency: r.agency ?? 'A',
    number: r.number,
  }))
  assert(!violatesTenantPartial(stampedGenerated), 'shared-counter generated numbers remain stamp-safe')
}

console.log('J. Counter concurrency + independent agency sequences')
{
  assert(fin.includes('VOLATILE'), 'next_* functions are VOLATILE (not STABLE/cached)')
  assert(finBody.includes('SET last_value = c.last_value + 1'), 'increment stored last_value under row lock')
  assert(!/SET last_value = EXCLUDED\.last_value/i.test(finBody), 'does not reset last_value to EXCLUDED (would duplicate 1)')
  assert(fin.includes('serialize on this unique row'), 'documents concurrent same-(agency, year) row lock')
  assert(finBody.includes('ON CONFLICT (agency_profile_id, year)'), 'conflict target is (agency, year) not (year)')
  assert(finBody.includes('VALUES (agency, yr, 1)'), 'first insert for an agency-year starts at 1')
}

console.log('K. Historical counter monotonicity')
{
  assert(prep.includes('Never reduce last_value'), 'prep states last_value is monotonic')
  assert(prep.includes('GREATEST('), 'GREATEST vs historical max')
  assert(prep.includes('counter last_value underran historical max suffix'), 'postcondition aborts if last_value < max suffix')
  assert(prep.includes('Malformed / non-matching strings are ignored'), 'malformed numbers ignored for counter math')
  assert(prep.includes('Parsed year comes from the number, not CURRENT_DATE'), 'year parsed from the stored number')
  assert(prep.includes('^[A-Za-z]+-([0-9]{4})-([0-9]+)$'), 'batch parse uses generic PREFIX-YYYY-n so a high suffix cannot be missed')
}

console.log('L. Migration preflight guards')
{
  assert(prep.includes('duplicate transaction_number values exist'), 'prep aborts on duplicate transaction numbers')
  assert(prep.includes('duplicate batch_number values exist'), 'prep aborts on duplicate batch numbers')
  assert(prep.includes('duplicate recovery_number values exist'), 'prep aborts on duplicate recovery numbers')
  assert(prep.includes('duplicate client_number values exist'), 'prep aborts on duplicate client numbers')
  assert(prep.includes('duplicate client_number within an agency'), 'prep aborts on per-agency client_number dup')
  assert(prep.includes('duplicate policy_number within a client'), 'prep aborts on per-client policy_number dup')
  assert(prep.includes('numbered transactions still have NULL agency_profile_id'), 'prep aborts numbered NULL transactions')
  assert(fin.includes('policy/client tenant mismatch'), 'finalize aborts policy/client tenant mismatch')
  assert(fin.includes('transaction/client tenant mismatch'), 'finalize aborts transaction/client tenant mismatch')
  assert(fin.includes('transaction/policy tenant mismatch'), 'finalize aborts transaction/policy tenant mismatch')
  assert(fin.includes('receipt/transaction tenant mismatch'), 'finalize aborts receipt/transaction tenant mismatch')
  assert(fin.includes('batch item/batch tenant mismatch'), 'finalize aborts batch item tenant mismatch')
  assert(fin.includes('recovery/transaction tenant mismatch'), 'finalize aborts recovery tenant mismatch')
  assert(fin.includes('allocation/recovery tenant mismatch'), 'finalize aborts allocation tenant mismatch')
  assert(fin.includes('recon row/statement tenant mismatch'), 'finalize aborts recon tenant mismatch')
  assert(fin.includes('supporting document/transaction tenant mismatch'), 'finalize aborts supporting-doc tenant mismatch')
  assert(fin.includes('2B-prep transitional client_number unique missing'), 'finalize requires transitional client unique')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-multitenancy-phase2b: ALL GREEN')
