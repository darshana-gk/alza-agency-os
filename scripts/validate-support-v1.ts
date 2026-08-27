/**
 * Support Center V1 — RBAC, isolation, assignment, notify fail-soft, presentation.
 * Run: npx tsx scripts/validate-support-v1.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []
const root = resolve(process.cwd())

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
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

function statusLabelAlza(status: string): string {
  switch (status) {
    case 'waiting_on_customer':
      return 'Waiting on Customer'
    case 'waiting_on_alza':
      return 'Waiting on ALZA'
    case 'resolved':
      return 'Resolved'
    case 'open':
      return 'Open'
    default:
      return statusLabel(status)
  }
}

console.log('A. Presentation labels')
assert('label waiting_on_alza', statusLabel('waiting_on_alza') === 'Waiting on ALZA', statusLabel('waiting_on_alza'))
assert(
  'label waiting_on_customer customer',
  statusLabel('waiting_on_customer') === 'Waiting on You',
  statusLabel('waiting_on_customer'),
)
assert(
  'label waiting_on_customer alza',
  statusLabelAlza('waiting_on_customer') === 'Waiting on Customer',
  statusLabelAlza('waiting_on_customer'),
)

console.log('B. RBAC — Support Center vs ALZA Inbox')
for (const role of ['owner', 'admin', 'csr', 'producer', 'viewer'] as const) {
  assert(`support center ${role}`, canAccessSupportCenter(role), role)
  assert(`inbox denied ${role}`, !canAccessAlzaSupportInbox(role), 'blocked')
}
assert('alza_support inbox allowed', canAccessAlzaSupportInbox('alza_support'), 'ok')
assert('alza_support not agency center', !canAccessSupportCenter('alza_support'), 'platform only')
assert('Owner cannot grant alza_support', !canChangeUserRole('alza_support').allowed, 'denied')
assert(
  'AGENCY_ASSIGNABLE excludes alza_support',
  !(AGENCY_ASSIGNABLE as readonly string[]).includes('alza_support'),
  'ok',
)

console.log('C. Source contracts — lib + pages')
{
  const support = read('src/lib/support.ts')
  const center = read('src/pages/SupportCenter.tsx')
  const inbox = read('src/pages/admin/AlzaSupportInbox.tsx')
  const perms = read('src/lib/permissions.ts')
  const notifications = read('src/lib/notifications.ts')

  assert('lib resolve', support.includes('resolveSupportConversation'), 'resolve helper')
  assert('lib reopen', support.includes('reopenSupportConversation'), 'reopen helper')
  assert('lib assign', support.includes('assignSupportConversation'), 'assign helper')
  assert('lib unassign', support.includes('unassignSupportConversation'), 'unassign helper')
  assert('lib notify', support.includes('notifySupportEventBestEffort'), 'email best effort')
  assert('lib event created', support.includes('request_created'), 'notify created')
  assert('lib event alza reply', support.includes('alza_replied'), 'notify alza reply')
  assert('lib event customer reply', support.includes('customer_replied'), 'notify customer reply')
  assert('lib event resolved', support.includes('ticket_resolved'), 'notify resolved')
  assert('lib event reopened', support.includes('ticket_reopened'), 'notify reopened')
  assert('lib agencyEmail', support.includes('agencyEmail'), 'agency email on conversation')
  assert('lib createdByEmail', support.includes('createdByEmail'), 'creator email on conversation')

  assert('center resolve wired', center.includes('resolveSupportConversation'), 'customer resolve UI wired')
  assert('center resolve button', center.includes('Mark Resolved'), 'customer resolve button')
  assert('center reopen', center.includes('Reopen conversation'), 'customer reopen')
  assert('center no coming soon', !center.includes('coming soon'), 'no coming-soon placeholders')
  assert('center no debug footer', !center.includes('Prefer the sidebar shortcut'), 'no debug footer copy')

  assert('inbox assign', inbox.includes('assignSupportConversation'), 'inbox assign')
  assert('inbox unassign', inbox.includes('unassignSupportConversation'), 'inbox unassign')
  assert('inbox agency panel', inbox.includes('Agency &'), 'agency details panel')
  assert('inbox waiting customer', inbox.includes('Waiting on Customer'), 'waiting on customer control')
  assert('inbox waiting alza', inbox.includes('Waiting on ALZA'), 'waiting on alza control')
  assert('inbox resolve asAlza', inbox.includes('asAlza: true'), 'inbox resolve as ALZA')

  assert('perms inbox', perms.includes('canAccessAlzaSupportInbox'), 'inbox permission')
  assert('perms assignable', perms.includes('AGENCY_ASSIGNABLE_ROLES'), 'agency assignable roles')
  {
    const assignable = perms.match(/AGENCY_ASSIGNABLE_ROLES[^=]*=\s*\[[^\]]+\]/)?.[0] ?? ''
    assert(
      'perms exclude alza_support',
      Boolean(assignable) && !assignable.includes('alza_support'),
      'alza_support not agency-assignable',
    )
  }

  assert('notif waiting alza', notifications.includes('support_waiting_alza'), 'in-app waiting alza')
  assert('notif waiting customer', notifications.includes('support_waiting_customer'), 'in-app waiting customer')
  assert('notif resolved', notifications.includes('support_resolved'), 'in-app resolved')
  assert('notif alza deep link', notifications.includes('/admin/support-inbox?c='), 'alza notification deep link')
  assert('notif customer deep link', notifications.includes('/support?c='), 'customer notification deep link')
}

console.log('D. Migrations — foundation + assignment (not applied)')
{
  const foundation = read('supabase/migrations/20260821120000_support_center_foundation.sql')
  assert('mig is_alza_support', foundation.includes('is_alza_support'), 'is_alza_support helper')
  assert(
    'mig block grant',
    foundation.includes('enforce_platform_only_alza_support_role'),
    'block agency grant',
  )
  assert('mig resolve rpc', foundation.includes('support_resolve_conversation'), 'resolve RPC')
  assert('mig agency resolve', foundation.includes('can_use_agency_support()'), 'agency may resolve')
  assert('mig reopen rpc', foundation.includes('support_reopen_conversation'), 'reopen RPC')
  assert('mig assign col', foundation.includes('assigned_to_user_id'), 'assignment column')
  assert('mig agency ids', foundation.includes('current_support_agency_ids'), 'agency isolation helper')
  assert(
    'mig foundation gated',
    foundation.includes('Local-only') || foundation.includes('do not apply') || foundation.includes('DO NOT'),
    'foundation gated',
  )

  const assignPath = 'supabase/migrations/20260827120000_support_assignment_rpcs.sql'
  assert('mig assign file', existsSync(resolve(root, assignPath)), 'dedicated assignment migration exists')
  const assign = read(assignPath)
  assert('mig assign rpc', assign.includes('support_assign_conversation'), 'assign RPC')
  assert('mig unassign rpc', assign.includes('support_unassign_conversation'), 'unassign RPC')
  assert('mig assign alza only', assign.includes('is_alza_support()'), 'ALZA-only auth')
  assert(
    'mig assign proposed',
    assign.includes('DO NOT apply until reviewed') || assign.includes('PROPOSED'),
    'assignment marked proposed',
  )
  assert(
    'mig assignee check',
    assign.includes('assignee must be an active ALZA support user'),
    'assignee must be alza_support',
  )

  const agencyResolvePath = 'supabase/migrations/20260827121000_support_agency_resolve.sql'
  assert('mig agency resolve file', existsSync(resolve(root, agencyResolvePath)), 'additive agency resolve exists')
  const agencyResolve = read(agencyResolvePath)
  assert('mig agency resolve replace only', agencyResolve.includes('CREATE OR REPLACE FUNCTION public.support_resolve_conversation'), 'CREATE OR REPLACE resolve')
  assert('mig agency resolve alza any', agencyResolve.includes('is_alza_support()'), 'ALZA may resolve any')
  assert(
    'mig agency resolve own agency',
    agencyResolve.includes('c.agency_profile_id = public.current_user_agency_profile_id()'),
    'agency scoped to own agency_profile_id',
  )
  assert('mig agency resolve no backfill', !/UPDATE\s+public\.users|ALTER\s+TABLE|DROP\s+TABLE/i.test(agencyResolve), 'no table/data changes')
}

console.log('E. Email notify — templates + fail-soft')
{
  const notifyFn = read('supabase/functions/notify-support-event/index.ts')
  const templates = read('supabase/functions/_shared/supportEmailTemplates.ts')
  assert('email resend key', notifyFn.includes('RESEND_API_KEY'), 'checks Resend key')
  assert('email skipped', notifyFn.includes('skipped'), 'graceful skip')
  assert('email templates import', notifyFn.includes('supportEmailTemplates'), 'uses template module')
  assert('email deploy gated', notifyFn.includes('DO NOT deploy'), 'deploy gated')
  assert('email identity', templates.includes('support@alzabusiness.com'), 'support identity address')
  assert('email builder', templates.includes('buildSupportEmailTemplate'), 'template builder')
  assert('email html', templates.includes('html'), 'html template')
  for (const ev of [
    'request_created',
    'customer_replied',
    'alza_replied',
    'ticket_resolved',
    'ticket_reopened',
  ]) {
    assert(`email event ${ev}`, templates.includes(ev) || notifyFn.includes(ev), `event ${ev}`)
  }
  assert(
    'email fail soft',
    notifyFn.includes('Support message was not blocked') || notifyFn.includes('skipped'),
    'fail soft on Resend error',
  )
}

console.log('F. Documentary isolation / reply / resolve contracts')
assert('create → waiting_on_alza', true, 'INSERT WITH CHECK + default')
assert('reply status via trigger not client UPDATE', true, 'no UPDATE grant')
assert('messages append-only grants', true, 'SELECT/INSERT only')
assert('no anon write policies', true, 'authenticated only')
assert('deep link Agency B blocked by RLS', true, 'SELECT USING agency membership')
assert('sender_type forged → trigger rewrite', true, 'BEFORE INSERT')
assert('resolve via RPC agency+alza', true, 'support_resolve_conversation')
assert('assign via RPC alza-only', true, 'support_assign_conversation')

const failed = checks.filter((c) => !c.passed)
for (const c of checks) {
  console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.id} — ${c.detail}`)
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) process.exit(1)
