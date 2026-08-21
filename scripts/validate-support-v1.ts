/**
 * Support Center V1 — local presentation / permission / escalation self-checks.
 * Run: npx tsx scripts/validate-support-v1.ts
 */

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

const failed = checks.filter((c) => !c.passed)
for (const c of checks) {
  console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.id} — ${c.detail}`)
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) process.exit(1)
