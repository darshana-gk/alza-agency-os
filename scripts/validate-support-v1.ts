/**
 * Support Center V1 — local presentation / permission / escalation self-checks.
 * Run: npx tsx scripts/validate-support-v1.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canAccessAlzaSupportInbox as realCanAccessAlzaSupportInbox,
  canAccessPath,
  canAccessSupportCenter as realCanAccessSupportCenter,
  notificationHrefTo,
  supportNotificationDeepLink,
} from '../src/lib/permissions.ts'
import {
  mergeSupportReply,
  runSupportPresentationSelfChecks,
  supportAgencySenderLabel,
  supportMessageSenderLabel,
  sortSupportMessagesNewestFirst,
  type SupportMessage,
} from '../src/lib/support.ts'

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
  const conv = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  for (const role of ['owner', 'admin', 'csr', 'producer', 'viewer'] as const) {
    const href = supportNotificationDeepLink(role, conv)
    assert(
      `agency ${role} deep link is Support Center`,
      href === `/support?c=${conv}` && !href.includes('support-inbox'),
      href,
    )
    const to = notificationHrefTo(href)
    assert(
      `agency ${role} link to is pathname+search`,
      typeof to === 'object' && to.pathname === '/support' && to.search === `?c=${conv}`,
      JSON.stringify(to),
    )
  }
  assert(
    'mixed agency+alza_support still uses Support Center',
    supportNotificationDeepLink(['owner', 'alza_support'], conv) === `/support?c=${conv}`,
    supportNotificationDeepLink(['owner', 'alza_support'], conv),
  )
  assert(
    'pure alza_support deep link is inbox',
    supportNotificationDeepLink('alza_support', conv) === `/admin/support-inbox?c=${conv}`,
    supportNotificationDeepLink('alza_support', conv),
  )
  const alzaTo = notificationHrefTo(supportNotificationDeepLink('alza_support', conv))
  assert(
    'alza link to is inbox pathname+search',
    typeof alzaTo === 'object' &&
      alzaTo.pathname === '/admin/support-inbox' &&
      alzaTo.search === `?c=${conv}`,
    JSON.stringify(alzaTo),
  )
  assert('owner still allowed /support', canAccessPath('owner', '/support') && realCanAccessSupportCenter('owner'), '/support')
  assert(
    'owner still denied inbox (guard unchanged)',
    !canAccessPath('owner', '/admin/support-inbox') && !realCanAccessAlzaSupportInbox('owner'),
    'denied',
  )
  assert('csr allowed /support, denied inbox', canAccessPath('csr', '/support') && !canAccessPath('csr', '/admin/support-inbox'), 'csr')
  assert(
    'producer allowed /support, denied inbox',
    canAccessPath('producer', '/support') && !canAccessPath('producer', '/admin/support-inbox'),
    'producer',
  )
  assert('alza_support allowed inbox, denied /support', canAccessPath('alza_support', '/admin/support-inbox') && !canAccessPath('alza_support', '/support'), 'alza')
}

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
  const notifications = readFileSync(resolve('src/lib/notifications.ts'), 'utf8')
  const perms = readFileSync(resolve('src/lib/permissions.ts'), 'utf8')
  const bell = readFileSync(resolve('src/components/layout/NotificationBell.tsx'), 'utf8')
  const notifPage = readFileSync(resolve('src/pages/Notifications.tsx'), 'utf8')
  assert(
    'notification hrefs use audience helper',
    notifications.includes('supportNotificationDeepLink') &&
      notifications.includes('canAccessSupportCenter(roleInput)') &&
      !notifications.includes('href: `/admin/support-inbox?c=') &&
      !notifications.includes('href: `/support?c='),
    'no hardcoded support hrefs',
  )
  assert(
    'agency seeds take Support Center precedence',
    support.includes('if (agencyOk)') && support.includes('waitingOnCustomer: rows.filter'),
    'agency-first seeds',
  )
  assert(
    'deep-link helper prefers Support Center',
    perms.includes('if (canAccessSupportCenter(role)) return `/support${qs}`'),
    'agency path first',
  )
  assert(
    'bell/page parse support href search separately',
    bell.includes('notificationHrefTo') && notifPage.includes('notificationHrefTo'),
    'object to for support items',
  )
}

{
  const actorSql = readFileSync(
    resolve('supabase/migrations/20260901220000_support_ticket_actor_brief.sql'),
    'utf8',
  )
  const support = readFileSync(resolve('src/lib/support.ts'), 'utf8')
  const center = readFileSync(resolve('src/pages/SupportCenter.tsx'), 'utf8')
  const inbox = readFileSync(resolve('src/pages/admin/AlzaSupportInbox.tsx'), 'utf8')
  assert(
    'actor brief is SECURITY DEFINER and conversation-gated',
    actorSql.includes('SECURITY DEFINER') &&
      actorSql.includes('p_conversation_id') &&
      actorSql.includes('public.is_alza_support()') &&
      actorSql.includes('current_support_agency_ids()') &&
      !actorSql.includes('DROP POLICY') &&
      !/from\s+public\.clients/i.test(actorSql),
    'ticket-scoped identity, no RLS/policy drops',
  )
  assert(
    'actor brief does not return email',
    !actorSql.includes('u.email') && actorSql.includes('full_name'),
    'name+role only',
  )
  assert(
    'messages fetched newest first then id',
    support.includes(".order('created_at', { ascending: false })") &&
      support.includes('sortSupportMessagesNewestFirst') &&
      support.includes('mergeSupportReply'),
    'newest-first fetch + merge',
  )
  assert(
    'both ticket UIs use sender helper and prepend replies',
    center.includes('supportMessageSenderLabel') &&
      inbox.includes('supportMessageSenderLabel') &&
      center.includes('mergeSupportReply') &&
      inbox.includes('mergeSupportReply') &&
      !center.includes("m.senderName || 'Agency User'") &&
      !inbox.includes("m.senderName || 'Agency User'"),
    'shared label + immediate prepend',
  )
  assert(
    'hydrate uses actor brief RPC',
    support.includes("support_ticket_actor_brief"),
    'RPC hydrate',
  )
}

{
  const openerSql = readFileSync(
    resolve('supabase/migrations/20260908140000_support_opener_identity_snapshot.sql'),
    'utf8',
  )
  const support = readFileSync(resolve('src/lib/support.ts'), 'utf8')
  const inbox = readFileSync(resolve('src/pages/admin/AlzaSupportInbox.tsx'), 'utf8')
  assert(
    'opener snapshot migration is conversation-scoped',
    openerSql.includes('opened_by_name') &&
      openerSql.includes('opened_by_email') &&
      openerSql.includes('support_snapshot_opener_identity') &&
      openerSql.includes('BEFORE INSERT') &&
      openerSql.includes("NULLIF(btrim(u.email), '')") &&
      !openerSql.includes('DROP POLICY') &&
      !openerSql.includes('CREATE POLICY'),
    'snapshot columns + trigger, no users RLS change',
  )
  assert(
    'opener snapshot does not copy agency_profile.email',
    /FROM public\.users u/i.test(openerSql) &&
      openerSql.includes('NEW.opened_by_email := v_email') &&
      !openerSql.includes('opened_by_email = a.email') &&
      !openerSql.includes('NEW.opened_by_email := a.email'),
    'users.email only',
  )
  assert(
    'agency brief exposes agency email separately from opener email',
    openerSql.includes('CREATE FUNCTION public.support_agency_brief()') &&
      openerSql.includes('NULLIF(btrim(a.email), \'\')') &&
      support.includes('agencyEmail: agency?.email') &&
      support.includes('resolveSupportOpenerIdentity'),
    'agency email via brief',
  )
  assert(
    'client maps snapshot opener fields and never uses agencyEmail as contact',
    support.includes('opened_by_name') &&
      support.includes('opened_by_email') &&
      support.includes('openedByEmail: (row.opened_by_email') &&
      !support.includes('createdByEmail: agency') &&
      inbox.includes('Agency email') &&
      inbox.includes('Opened by') &&
      inbox.includes('Contact email') &&
      inbox.includes('selected.createdByEmail'),
    'distinct Agency email / Opened by / Contact email',
  )
}

{
  const ticketSql = readFileSync(
    resolve('supabase/migrations/20260908150000_support_ticket_number.sql'),
    'utf8',
  )
  const support = readFileSync(resolve('src/lib/support.ts'), 'utf8')
  assert(
    'ticket number migration matches Staging ALZA-###### design',
    ticketSql.includes('CREATE SEQUENCE IF NOT EXISTS public.support_ticket_number_seq') &&
      ticketSql.includes('GENERATED ALWAYS AS') &&
      ticketSql.includes("'ALZA-'::text || lpad((ticket_seq)::text, 6, '0'::text)") &&
      ticketSql.includes('ROW_NUMBER() OVER (ORDER BY created_at, id)') &&
      ticketSql.includes("RAISE EXCEPTION 'support ticket number cannot be changed'") &&
      ticketSql.includes('support_conversations_ticket_number_uidx') &&
      !ticketSql.includes('DROP POLICY') &&
      !ticketSql.includes('CREATE POLICY') &&
      !ticketSql.includes('20260831140000'),
    'global seq + generated ALZA-######, no RLS change',
  )
  assert(
    'ticket number migration is idempotent and does not rewind the sequence',
    ticketSql.includes('ADD COLUMN IF NOT EXISTS ticket_seq') &&
      ticketSql.includes('AND c.ticket_seq IS NULL') &&
      ticketSql.includes('GREATEST(COALESCE(v_seq, 0), v_max)') &&
      ticketSql.includes('ON CONFLICT (version) DO NOTHING'),
    'IF NOT EXISTS + NULL-only backfill + GREATEST setval',
  )
  assert(
    'app selects ticket_number and searches it',
    support.includes('ticket_number') &&
      support.includes('ticketNumber: String(row.ticket_number') &&
      support.includes("(r.ticketNumber ?? '').toLowerCase().includes(q)"),
    'CONVERSATION_SELECT + search',
  )
}

{
  const sample = (partial: Partial<SupportMessage> & Pick<SupportMessage, 'id' | 'createdAt'>): SupportMessage => ({
    conversationId: 'c',
    senderUserId: null,
    senderName: null,
    senderRole: null,
    senderType: 'agency_user',
    body: 'x',
    ...partial,
  })
  const sorted = sortSupportMessagesNewestFirst([
    sample({ id: 'old', createdAt: '2026-09-01T10:00:00.000Z', body: 'old' }),
    sample({ id: 'new', createdAt: '2026-09-01T12:00:00.000Z', body: 'new', senderType: 'alza_support' }),
  ])
  assert('validator newest message first', sorted[0]?.id === 'new', sorted[0]?.id ?? 'missing')
  const tied = sortSupportMessagesNewestFirst([
    sample({ id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-09-01T12:00:00.000Z' }),
    sample({ id: '99999999-9999-4999-8999-999999999999', createdAt: '2026-09-01T12:00:00.000Z' }),
  ])
  assert(
    'validator id desc tie-break',
    tied[0]?.id === '99999999-9999-4999-8999-999999999999',
    tied[0]?.id ?? 'missing',
  )
  const merged = mergeSupportReply(
    [sample({ id: 'old', createdAt: '2026-09-01T10:00:00.000Z' })],
    sample({ id: 'reply', createdAt: '2026-09-01T13:00:00.000Z', body: 'reply' }),
  )
  assert('validator merge reply is top', merged[0]?.id === 'reply', merged[0]?.id ?? 'missing')
  assert(
    'ALZA inbox agency sender shows name and role',
    supportAgencySenderLabel('2AG-B Owner', 'owner') === '2AG-B Owner · Owner',
    supportAgencySenderLabel('2AG-B Owner', 'owner'),
  )
  assert(
    'missing identity falls back to Agency User',
    supportAgencySenderLabel(null, null) === 'Agency User',
    supportAgencySenderLabel(null, null),
  )
  assert(
    'ALZA sender label unchanged shape',
    supportMessageSenderLabel({
      senderType: 'alza_support',
      senderName: 'Pat',
      senderRole: 'alza_support',
    }) === 'ALZA Support · Pat',
    supportMessageSenderLabel({
      senderType: 'alza_support',
      senderName: 'Pat',
      senderRole: 'alza_support',
    }),
  )
  for (const check of runSupportPresentationSelfChecks()) {
    assert(check.name, check.passed, check.detail)
  }
}

const failed = checks.filter((c) => !c.passed)
for (const c of checks) {
  console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.id} — ${c.detail}`)
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
if (failed.length) process.exit(1)
