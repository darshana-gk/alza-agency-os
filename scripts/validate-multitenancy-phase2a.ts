/**
 * Multi-tenancy V1 Phase 2A — source-only regressions (no database, no network).
 * Run: npx tsx scripts/validate-multitenancy-phase2a.ts
 *
 * Asserts the authored migration is additive tenant-column + backfill only.
 * Does not apply the migration.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const migrationName = '20260828180000_multitenancy_v1_phase2a_tenant_columns.sql'
const migrationPath = resolve(root, 'supabase/migrations', migrationName)
const inspectPath = resolve(root, 'scripts/inspect-production-tenancy-schema.sql')

const NEW_TENANT_TABLES = [
  'clients',
  'policies',
  'transactions',
  'carriers',
  'mgas',
  'producers',
  'csrs',
  'agency_commission_receipts',
  'producer_payment_batches',
  'producer_payment_batch_items',
  'producer_commission_recoveries',
  'producer_recovery_allocations',
  'recovery_number_counters',
  'reconciliation_statement_rows',
  'activity_history',
  'supporting_documents',
] as const

const EXISTING_TENANT_TABLES = [
  'users',
  'reconciliation_statements',
  'reconciliation_column_mappings',
  'billing_subscriptions',
  'support_conversations',
] as const

const FORBIDDEN_TOUCH = [
  'src/lib/integrations/catalog.ts',
  'src/lib/integrations/connectionModel.ts',
  'src/pages/Integrations.tsx',
  'src/pages/SupportCenter.tsx',
  'src/pages/admin/AlzaSupportInbox.tsx',
  'src/lib/support.ts',
  'src/lib/billing.ts',
  'src/lib/billingCatalog.ts',
  'src/pages/admin/SubscriptionBilling.tsx',
  'supabase/functions/run-reconciliation-matching/index.ts',
  'supabase/functions/confirm-reconciliation-receipts/index.ts',
  'supabase/functions/create-razorpay-subscription/index.ts',
  'supabase/functions/razorpay-webhook/index.ts',
  'supabase/functions/invite-alza-user/index.ts',
  'src/lib/agency.ts',
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

const sql = readFileSync(migrationPath, 'utf8')
const body = stripSqlComments(sql)
const inspectSql = existsSync(inspectPath) ? readFileSync(inspectPath, 'utf8') : ''

console.log('A. Migration file present + additive header')
{
  assert(existsSync(migrationPath), `${migrationName} exists`)
  assert(sql.includes('Phase 2A'), 'header names Phase 2A')
  assert(sql.includes('Do NOT apply to Production'), 'production warning present')
  assert(sql.includes('dedicated non-Production'), 'staging-only warning present')
  assert(!sql.includes('CREATE TABLE public.clients'), 'does not invent clients DDL')
  assert(!sql.includes('CREATE TABLE public.transactions'), 'does not invent transactions DDL')
}

console.log('B. New tenant columns — present, nullable, not duplicated')
{
  for (const table of NEW_TENANT_TABLES) {
    assert(sql.includes(`'${table}'`), `new-column table listed: ${table}`)
  }
  assert(
    /ALTER TABLE public\.%I ADD COLUMN agency_profile_id uuid/.test(sql) ||
      /ADD COLUMN agency_profile_id uuid/.test(sql),
    'adds agency_profile_id uuid (no NOT NULL)',
  )
  assert(
    !/ADD COLUMN agency_profile_id uuid NOT NULL/i.test(body),
    'new agency_profile_id is not NOT NULL',
  )
  assert(
    !/ALTER TABLE[\s\S]{0,80}ALTER COLUMN agency_profile_id SET NOT NULL/i.test(body),
    'does not SET NOT NULL on agency_profile_id',
  )
  assert(sql.includes('REFERENCES public.agency_profile(id)'), 'FK foundation to agency_profile')
  assert(sql.includes('CREATE INDEX IF NOT EXISTS'), 'non-unique tenant indexes')
  assert(!/CREATE UNIQUE INDEX/i.test(body), 'no unique index conversion')
  assert(!/ADD CONSTRAINT \S+ UNIQUE/i.test(body), 'no new UNIQUE constraints')
}

console.log('C. Existing tenant columns are not recreated')
{
  for (const table of EXISTING_TENANT_TABLES) {
    const recreate =
      new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]{0,200}ADD COLUMN(?: IF NOT EXISTS)? agency_profile_id`, 'i')
    assert(!recreate.test(sql), `does not ADD COLUMN on existing ${table}`)
  }
  assert(sql.includes('Existing tenant columns are not recreated'), 'documents skip list')
}

console.log('D. No RLS / singleton / counter / permission phase leakage')
{
  assert(!/DROP POLICY/i.test(body), 'no DROP POLICY')
  assert(!/CREATE POLICY/i.test(body), 'no CREATE POLICY')
  assert(!/ENABLE ROW LEVEL SECURITY/i.test(body), 'no ENABLE ROW LEVEL SECURITY')
  assert(!/agency_profile_singleton/i.test(body), 'does not drop singleton unique')
  assert(!/DROP CONSTRAINT[\s\S]{0,40}singleton/i.test(body), 'does not drop singleton constraint')
  assert(!/CREATE OR REPLACE FUNCTION/i.test(body), 'no RPC/function replacement')
  assert(!/next_recovery_number/i.test(body), 'does not change recovery counter function')
  assert(!/next_transaction_number/i.test(body), 'does not change transaction counter')
  assert(!/transactions_update_ops/i.test(body), 'does not change transaction UPDATE policy')
  assert(!/is_ops_staff\(\)/i.test(body), 'does not replace is_ops_staff')
}

console.log('E. Backfill aborts rather than guessing')
{
  assert(sql.includes("Phase 2A abort: agency_profile is empty"), 'abort if zero agencies')
  assert(sql.includes('expected exactly 1 agency_profile'), 'abort if not singleton')
  assert(sql.includes('both alza_support and an agency role'), 'abort mixed support membership')
  assert(sql.includes('agency user(s) have agency_profile_id other than Tenant 1'), 'abort unexpected membership')
  assert(sql.includes('does not exist'), 'abort orphan user agency_profile_id')
  assert(sql.includes('existing tenant-column row(s) are not Tenant 1'), 'abort mismatched existing tenant columns')
  assert(sql.includes('SET agency_profile_id = NULL'), 'alza_support re-NULLed')
  assert(sql.includes('SET agency_profile_id = tenant1'), 'business rows backfilled to Tenant 1')
  assert(!/premium_amount\s*=/i.test(body), 'does not rewrite premium_amount')
  assert(!/producer_commission_amount\s*=/i.test(body), 'does not rewrite producer commission')
  assert(!/agency_commission_amount\s*=/i.test(body), 'does not rewrite agency commission')
}

console.log('F. Production inspection script is read-only and not implied-applied')
{
  assert(existsSync(inspectPath), 'inspect-production-tenancy-schema.sql exists')
  assert(inspectSql.includes('DO NOT RUN unless separately approved'), 'inspection requires approval')
  const inspectBody = stripSqlComments(inspectSql)
  assert(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(inspectBody), 'inspection has no writes')
  assert(inspectSql.includes('pg_constraint'), 'inspects constraints')
  assert(inspectSql.includes('pg_policies'), 'inspects RLS policies')
  assert(inspectSql.includes('client_number'), 'inspects client_number')
  assert(inspectSql.includes('transaction_number'), 'inspects transaction_number')
  assert(inspectSql.includes('batch_number'), 'inspects batch_number')
  assert(inspectSql.includes('recovery_number'), 'inspects recovery_number')
  assert(inspectSql.includes('singleton_key'), 'inspects singleton_key')
}

console.log('G. No application / Edge / Billing / Support / Integrations edits in this pass')
{
  for (const rel of FORBIDDEN_TOUCH) {
    assert(existsSync(resolve(root, rel)), `baseline file still present: ${rel}`)
  }
  const migrations = readdirSync(resolve(root, 'supabase/migrations'))
  const extra = migrations.filter((f) => {
    if (!f.endsWith('.sql')) return false
    const stamp = f.slice(0, 14)
    return stamp > '20260827121000' && f !== migrationName
  })
  assert(extra.length === 0, `no extra post-RC migrations (${extra.join(', ') || 'none'})`)

  const matching = readFileSync(
    resolve(root, 'supabase/functions/run-reconciliation-matching/index.ts'),
    'utf8',
  )
  assert(matching.includes(".from('transactions')"), 'recon matching still unscoped (Phase 4)')
  const catalog = readFileSync(resolve(root, 'src/lib/integrations/catalog.ts'), 'utf8')
  assert(catalog.includes('Onboarding Data Import'), 'Integrations copy unchanged from RC')
  const support = readFileSync(resolve(root, 'src/lib/support.ts'), 'utf8')
  assert(support.includes('support_conversations'), 'Support lib still present/unreplaced')
}

console.log('H. RC app compatibility — inserts not forced to supply tenant')
{
  assert(sql.includes('Nullable until Phase 2B'), 'documents nullable compatibility')
  assert(sql.includes('Not used by RLS yet'), 'documents RLS deferred')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('validate-multitenancy-phase2a: ALL GREEN')
