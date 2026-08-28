/**
 * Multi-tenancy V1 Phase 3 — source-only regressions (no database, no network).
 * Run: npx tsx scripts/validate-multitenancy-phase3.ts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const names = {
  a: '20260828220000_multitenancy_v1_phase3a_tenant_stamping.sql',
  b: '20260828230000_multitenancy_v1_phase3b_rls_security.sql',
  c: '20260828240000_multitenancy_v1_phase3c_workflow_privilege_rpcs.sql',
  d: '20260828250000_multitenancy_v1_phase3d_storage_isolation.sql',
  e: '20260828260000_multitenancy_v1_phase3e_tenant_integrity.sql',
} as const

const FORBIDDEN_TOUCH = [
  'src/lib/commission.ts',
  'src/lib/permissions.ts',
  'src/lib/billing.ts',
  'src/lib/support.ts',
  'src/pages/SupportCenter.tsx',
  'src/lib/integrations/catalog.ts',
  'supabase/functions/create-razorpay-subscription/index.ts',
  'supabase/functions/razorpay-webhook/index.ts',
  'supabase/functions/run-reconciliation-matching/index.ts',
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
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function readMig(name: string): string {
  return readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')
}

const a = readMig(names.a)
const b = readMig(names.b)
const c = readMig(names.c)
const d = readMig(names.d)
const e = readMig(names.e)
const aBody = stripSqlComments(a)
const bBody = stripSqlComments(b)
const cBody = stripSqlComments(c)
const dBody = stripSqlComments(d)
const eBody = stripSqlComments(e)
const all = `${a}\n${b}\n${c}\n${d}\n${e}`
const allBody = `${aBody}\n${bBody}\n${cBody}\n${dBody}\n${eBody}`

console.log('A. Files present and ordered')
{
  for (const [key, name] of Object.entries(names)) {
    assert(existsSync(resolve(root, 'supabase/migrations', name)), `${key} exists`)
  }
  assert(names.a < names.b && names.b < names.c && names.c < names.d && names.d < names.e, '3A–3E lexicographic order')
  assert(a.includes('Phase 3A') && a.includes('Do NOT apply to Production'), '3A header')
  assert(b.includes('Phase 3B') && c.includes('Phase 3C') && d.includes('Phase 3D') && e.includes('Phase 3E'), 'phase names')
  assert(e.includes('Do NOT drop agency_profile_singleton') || e.includes('must never drop'), '3E keeps singleton')
}

console.log('B. Stamp mismatch rejection + parent/child + no singleton fallback')
{
  assert(a.includes('multitenancy_resolve_insert_agency'), 'resolver exists')
  assert(a.includes('auth.uid() IS NOT NULL'), '3A resolver classifies JWT via auth.uid()')
  assert(!/IF current_user IN \('authenticated'/.test(aBody), '3A resolver does not use current_user')
  assert(existsSync(resolve(root, 'supabase/migrations', '20260828220100_multitenancy_v1_phase3a_jwt_caller_detection.sql')), '3A JWT correction file exists')
  const aFix = readMig('20260828220100_multitenancy_v1_phase3a_jwt_caller_detection.sql')
  assert(aFix.includes('jwt_uid := auth.uid()'), 'correction classifies via auth.uid()')
  assert(!/IF current_user IN \('authenticated'/.test(stripSqlComments(aFix)), 'correction does not use current_user')
  assert(a.includes('supplied agency_profile_id does not match caller membership'), 'JWT mismatch reject')
  assert(a.includes('does not match parent tenant'), 'parent mismatch reject')
  assert(a.includes('service-role/postgres insert requires explicit agency_profile_id or a parent tenant'), 'service-role explicit/parent')
  assert(!/FROM public\.agency_profile[\s\S]{0,80}LIMIT 1/i.test(allBody), 'no first-agency LIMIT 1 fallback')
  assert(a.includes('multitenancy_stamp_from_client'), 'policy from client')
  assert(a.includes('multitenancy_stamp_transaction'), 'transaction from client/policy')
  assert(a.includes('multitenancy_stamp_from_transaction'), 'receipts/recoveries from txn')
  assert(a.includes('multitenancy_stamp_batch_item'), 'batch items from batch/txn')
  assert(a.includes('multitenancy_stamp_allocation'), 'allocations from recovery/batch')
  assert(a.includes('multitenancy_stamp_recon_row'), 'recon rows from statement')
  assert(a.includes('aaa_multitenancy_stamp'), 'stamp triggers named to run before numbering')
  assert(a.includes('is_alza_support') === false || !aBody.includes('NOT public.is_alza_support'), 'ALZA numbering exception removed from 3A helper')
  assert(!/AND NOT public\.is_alza_support\(\)/.test(aBody), 'no ALZA Support numbering mismatch exception')
  assert(a.includes('row agency_profile_id does not match caller membership'), 'numbering uses stamped row vs session')
  assert(a.includes('users.agency_profile_id cannot be changed once set') || a.includes('cannot assign a user to another agency'), 'users stamp rules')
}

console.log('C. RLS tenant predicates, anon denial, ALZA operational denial, inactive denial')
{
  assert(b.includes('CREATE POLICY clients_select_agency'), 'clients tenant SELECT')
  assert(b.includes('same_agency(agency_profile_id)'), 'same_agency predicate')
  assert(b.includes('REVOKE ALL ON TABLE public.clients FROM anon, PUBLIC') || b.includes("REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC"), 'anon revoke loop')
  assert(b.includes('FROM anon, PUBLIC'), 'anon revoked')
  assert(!/USING\s*\(\s*true\s*\)/i.test(bBody.replace(/support_/g, '')), '3B body has no USING (true) on replaced tables')
  assert(!bBody.includes("USING (true)"), 'no USING (true)')
  assert(b.includes('users_select_scoped'), 'users scoped')
  assert(b.includes('user_roles_select_scoped'), 'user_roles scoped')
  assert(b.includes("lower(role) IN ('owner', 'admin', 'csr', 'producer', 'viewer')"), 'cannot grant alza_support via user_roles insert')
  assert(b.includes('billing_select_own_admin'), 'billing own-agency admin SELECT')
  assert(b.includes('recon_statements_select_ops'), 'recon tenant SELECT')
  assert(b.includes('directory_carriers_select'), 'directory tenant SELECT')
  assert(b.includes('is_alza_support()') && b.includes('agency_profile_id IS NULL'), 'ALZA users only platform rows')
  assert(b.includes('Support conversation/message policies are intentionally NOT dropped'), 'support RLS preserved')
  assert(b.includes('current_user_agency_profile_id() IS NOT NULL'), 'inactive/no membership denied in can_read')
  assert(b.includes("lower(COALESCE(u.status, '')) = 'active'") && b.includes('current_app_user_id'), 'inactive users excluded from current_app_user_id')
  assert(b.includes('Users cannot change their own status, role, or agency membership'), 'no self-reactivation')
  assert(b.includes('agency_profile_select_own'), 'agency_profile own-row only')
  assert(b.includes('REVOKE INSERT, DELETE ON TABLE public.agency_profile FROM authenticated'), 'JWT cannot insert Agency B')
  assert(!b.includes('DROP POLICY') || b.includes('DROP POLICY IF EXISTS'), 'policy drops are IF EXISTS / catalog loop')
}

console.log('D. CSR privilege + workflow RPCs')
{
  assert(c.includes('enforce_transaction_privilege'), 'privilege trigger')
  assert(c.includes('privileged transaction fields require workflow RPC'), 'raw update rejected')
  assert(c.includes("current_user NOT IN ('authenticated', 'anon', 'service_role')"), 'only definer RPCs may patch privileged cols')
  assert(c.includes('CREATE OR REPLACE FUNCTION public.submit_transaction_for_review'), 'submit RPC')
  assert(c.includes('CREATE OR REPLACE FUNCTION public.confirm_agency_commission_received'), 'receipt RPC')
  assert(c.includes('CREATE OR REPLACE FUNCTION public.approve_transaction_review'), 'approve RPC')
  assert(c.includes('CREATE OR REPLACE FUNCTION public.return_transaction_for_correction'), 'return RPC')
  assert(c.includes('CREATE OR REPLACE FUNCTION public.mark_producer_commission_ready'), 'ready RPC')
  assert(c.includes('CREATE OR REPLACE FUNCTION public.void_transaction'), 'void RPC')
  assert(c.includes('Not authorized to approve transactions'), 'approve is admin')
  assert(c.includes('is_ops_staff()') && c.includes('submit'), 'submit allows ops/CSR')
  assert(c.includes('v_agency') && c.includes('create_producer_payment_batch_with_recoveries'), 'batch RPC agency assert')
  assert(c.includes('v_batch.agency_profile_id IS DISTINCT FROM v_agency'), 'confirm-paid agency assert')
  assert(c.includes('REVOKE DELETE ON TABLE public.transactions FROM authenticated') || b.includes('REVOKE DELETE ON TABLE public.transactions FROM authenticated'), 'no JWT txn DELETE')
}

console.log('E. Reconciliation / billing / directory isolation in 3B')
{
  assert(b.includes('recon_mappings_mutate_admin'), 'recon mapping CUD admin')
  assert(b.includes('is_admin_directory_role()') && b.includes('billing_select_own_admin'), 'billing admin + tenant')
  assert(!/billing_subscriptions[\s\S]{0,200}USING \(public\.is_admin_directory_role\(\)\)/.test(b) || b.includes('same_agency(agency_profile_id) AND public.is_admin_directory_role()'), 'billing has tenant predicate')
  assert(b.includes('directory_producers_select') && b.includes('is_ops_staff()'), 'directory CSR/OA read')
  assert(b.includes('directory_producers_admin') && b.includes('is_admin_directory_role()'), 'directory CUD admin')
}

console.log('F. Storage agency-prefix + branding transition')
{
  assert(d.includes("p_name LIKE public.current_user_agency_profile_id()::text || '/%'"), 'agency prefix')
  assert(d.includes("logo/' || public.current_user_agency_profile_id()::text || '.%'"), 'legacy logo path kept')
  assert(d.includes('DROP POLICY IF EXISTS agency_branding_public_read'), 'bucket-wide public list removed')
  assert(!/ALTER TABLE storage\.buckets|UPDATE storage\.buckets SET[\s\S]*public\s*=\s*false/i.test(dBody), 'does not privatize branding bucket')
  assert(d.includes('transaction') && d.includes('recovery'), 'legacy supporting-docs prefix')
  assert(d.includes('Phase 4 copies'), 'Phase 4 transition documented')
}

console.log('G. 3E NOT NULL prerequisites + singleton retained')
{
  const nnTables = [
    'clients', 'policies', 'transactions', 'carriers', 'mgas', 'producers', 'csrs',
    'agency_commission_receipts', 'producer_payment_batches', 'producer_payment_batch_items',
    'producer_commission_recoveries', 'producer_recovery_allocations',
    'reconciliation_statement_rows', 'activity_history', 'supporting_documents',
  ]
  for (const t of nnTables) {
    assert(e.includes(`ALTER TABLE public.${t} ALTER COLUMN agency_profile_id SET NOT NULL`), `SET NOT NULL ${t}`)
  }
  assert(!/ALTER TABLE public\.users ALTER COLUMN agency_profile_id SET NOT NULL/.test(eBody), 'users remain nullable')
  assert(e.includes('unresolvable NULL agency_profile_id remain'), 'abort leftover NULLs')
  assert(e.includes('Will not use singleton/first agency'), 'no singleton guess')
  assert(e.includes('DROP INDEX IF EXISTS public.clients_null_agency_client_number_uidx'), 'drop NULL bridges')
  assert(e.includes('DROP CONSTRAINT IF EXISTS transactions_transaction_number_key'), 'drop global txn unique after NOT NULL')
  assert(!/DROP CONSTRAINT[\s\S]{0,40}agency_profile_singleton/.test(eBody), 'does not drop singleton')
  assert(e.includes('tenant-scoped transaction_number unique missing'), 'requires tenant unique before dropping global')
  assert(e.includes('UPDATE public.policies p'), 'parents before children: policies from clients')
  assert(e.includes('UPDATE public.transactions t'), 'transactions from client/policy')
}

console.log('H. No Phase 4 / product leakage')
{
  for (const rel of FORBIDDEN_TOUCH) {
    assert(existsSync(resolve(root, rel)), `baseline still present: ${rel}`)
  }
  assert(!/DROP CONSTRAINT[\s\S]{0,60}agency_profile_singleton/.test(allBody), 'no singleton drop anywhere in Phase 3')
  assert(!all.includes('INSERT INTO public.agency_profile') || a.includes('Do NOT create Agency B'), 'no Agency B insert')
  const extra = readdirSync(resolve(root, 'supabase/migrations')).filter((f) => {
    if (!f.endsWith('.sql')) return false
    const stamp = f.slice(0, 14)
    return stamp > '20260828260000'
  })
  assert(extra.length === 0, `no migrations after 3E (${extra.join(', ') || 'none'})`)
}

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed`)
console.log('validate-multitenancy-phase3: ALL GREEN')
