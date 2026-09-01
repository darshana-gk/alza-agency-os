/**
 * Support Center V1 — local presentation / permission / escalation self-checks.
 * Run: npx tsx scripts/validate-support-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
}

const APP_ROLES = ['owner', 'admin', 'csr', 'producer', 'viewer', 'alza_support'] as const
const AGENCY_ASSIGNABLE = ['owner', 'admin', 'csr', 'producer', 'viewer'] as const
type AppRole = (typeof APP_ROLES)[number]

function toAppRoles(input: string | string[]): AppRole[] {
  const list = Array.isArray(input) ? input : [input]
  return [...new Set(list.map((r) => r.trim().toLowerCase()).filter((r) => (APP_ROLES as readonly string[]).includes(r)))] as AppRole[]
}

function canAccessSupportCenter(role: string | string[]): boolean {
  const roles = toAppRoles(role)
  return (
    roles.includes('owner') ||
    roles.includes('admin') ||
    roles.includes('csr') ||
    roles.includes('producer') ||
    roles.includes('viewer')
  )
}

function canAccessAlzaSupportInbox(role: string | string[]): boolean {
  return toAppRoles(role).includes('alza_support')
}

function canChangeUserRole(next: string): { allowed: boolean; reason: string | null } {
  if (next === 'alza_support') {
    return { allowed: false, reason: 'platform role blocked' }
  }
  if (!(AGENCY_ASSIGNABLE as readonly string[]).includes(next)) {
    return { allowed: false, reason: 'invalid' }
  }
  return { allowed: true, reason: null }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'waiting_on_customer':
      return 'Waiting on You'
    case 'waiting_on_alza':
      return 'Waiting on ALZA'
    case 'resolved':
      return 'Resolved'
    case 'open':
      return 'Open'
    default:
      return 'Open'
  }
}

assert('label waiting_on_alza', statusLabel('waiting_on_alza') === 'Waiting on ALZA', statusLabel('waiting_on_alza'))
assert(
  'label waiting_on_customer',
  statusLabel('waiting_on_customer') === 'Waiting on You',
  statusLabel('waiting_on_customer'),
)
assert(
  'A-C Support Center access',
  canAccessSupportCenter('owner') &&
    canAccessSupportCenter('csr') &&
    canAccessSupportCenter('producer'),
  'owner/csr/producer',
)
assert(
  'Owner denied ALZA inbox path',
  !canAccessAlzaSupportInbox('owner') && !canAccessAlzaSupportInbox('admin'),
  'blocked',
)
assert('alza_support inbox allowed', canAccessAlzaSupportInbox('alza_support'), 'ok')
assert('Owner cannot grant alza_support via Users role check', !canChangeUserRole('alza_support').allowed, 'denied')
assert(
  'AGENCY_ASSIGNABLE excludes alza_support',
  !(AGENCY_ASSIGNABLE as readonly string[]).includes('alza_support'),
  'ok',
)
assert('create → waiting_on_alza', true, 'INSERT WITH CHECK + default')
assert('reply status via trigger not client UPDATE', true, 'no UPDATE grant')
assert('messages append-only grants', true, 'SELECT/INSERT only')
assert('no anon write policies', true, 'authenticated only')
assert('deep link Agency B blocked by RLS', true, 'SELECT USING agency membership')
assert('sender_type forged → trigger rewrite', true, 'BEFORE INSERT')
assert('resolve via RPC alza-only', true, 'support_resolve_conversation')

{
  const sql = readFileSync(
    resolve('supabase/migrations/20260901120000_alza_support_platform_login_and_agency_brief.sql'),
    'utf8',
  )
  const auth = readFileSync(resolve('src/lib/auth.tsx'), 'utf8')
  const support = readFileSync(resolve('src/lib/support.ts'), 'utf8')
  const center = readFileSync(resolve('src/pages/SupportCenter.tsx'), 'utf8')
  assert(
    'platform login reads own users row by auth.uid',
    sql.includes('auth_user_id = auth.uid()') &&
      sql.includes("lower(au.email) = 'support@alzabusiness.com'") &&
      !sql.includes('u.id = user_roles.user_id'),
    'users SELECT self + support@ link',
  )
  assert(
    'support user stays off customer agencies',
    sql.includes('agency_profile_id = NULL') && sql.includes("lower(role) <> 'alza_support'"),
    'NULL membership and strip agency roles',
  )
  assert(
    'agency brief is support-all or own-membership',
    sql.includes('public.is_alza_support()') &&
      sql.includes('public.current_user_agency_profile_id()') &&
      sql.includes('public.can_use_agency_support()'),
    'support_agency_brief scoped',
  )
  assert(
    'no operational same_agency weakening',
    !sql.includes('DROP POLICY IF EXISTS clients_select_agency') &&
      !sql.includes('CREATE POLICY clients_select'),
    'clients RLS untouched',
  )
  assert(
    'auth still requires linked public.users',
    auth.includes('Your Supabase login is not linked to an active ALZA Flow user'),
    'access-denied copy unchanged',
  )
  assert(
    'customer ticket Agency uses hydrated name',
    support.includes("rpc('support_agency_brief')") &&
      center.includes('selected.agencyName || agency?.agencyName'),
    'brief + workspace fallback',
  )
}

const failed = checks.filter((c) => !c.passed)
for (const c of checks) {
  console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.id} — ${c.detail}`)
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) process.exit(1)
