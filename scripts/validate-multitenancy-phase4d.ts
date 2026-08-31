/**
 * Multi-tenancy V1 Phase 4D — Support routes + producer identity (source-only).
 * Run: npx tsx scripts/validate-multitenancy-phase4d.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canAccessPath,
  homePathForRoles,
  isPurePlatformSupport,
  rolesOf,
  resolveProducerBookName,
  type AppRole,
} from '../src/lib/permissions.ts'

const root = resolve(process.cwd())
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

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

console.log('A. Pure alza_support route allow-list / deny')
{
  assert(isPurePlatformSupport('alza_support'), 'pure support detected')
  assert(!isPurePlatformSupport(['alza_support', 'owner']), 'multi-role with agency not pure support')
  assert(homePathForRoles('alza_support') === '/admin/support-inbox', 'support home → inbox')
  assert(homePathForRoles('owner') === '/', 'owner home → /')
  assert(canAccessPath('alza_support', '/admin/support-inbox'), 'support inbox allowed')
  assert(!canAccessPath('alza_support', '/'), 'support denied /')
  assert(!canAccessPath('alza_support', '/clients'), 'support denied /clients')
  assert(!canAccessPath('alza_support', '/transactions'), 'support denied /transactions')
  assert(!canAccessPath('alza_support', '/financials'), 'support denied /financials')
  assert(!canAccessPath('alza_support', '/reconciliation'), 'support denied /reconciliation')
  assert(!canAccessPath('alza_support', '/reports'), 'support denied /reports')
  assert(!canAccessPath('alza_support', '/onboarding'), 'support denied /onboarding')
  assert(!canAccessPath('alza_support', '/integrations'), 'support denied /integrations')
  assert(!canAccessPath('alza_support', '/admin/producers'), 'support denied /admin/producers')
  assert(!canAccessPath('alza_support', '/admin/users'), 'support denied /admin/users')
  assert(!canAccessPath('alza_support', '/admin/agency-settings'), 'support denied agency settings')
  assert(!canAccessPath('alza_support', '/admin/subscription-billing'), 'support denied billing')
  assert(!canAccessPath('alza_support', '/support'), 'support denied agency /support')
  assert(canAccessPath('owner', '/clients'), 'owner still has /clients')
  assert(canAccessPath(['csr', 'producer'], '/transactions'), 'CSR+Producer multi-role ops path')
}

console.log('B. Multi-role guard input')
{
  const requirePerm = read('src/components/auth/RequirePermission.tsx')
  assert(requirePerm.includes('rolesOf(profile)'), 'RequirePathAccess uses rolesOf')
  assert(requirePerm.includes('canAccessPath(roles, path)'), 'RequirePathAccess passes full roles')
  assert(requirePerm.includes('isPurePlatformSupport'), 'pure support redirect')
  assert(requirePerm.includes('/admin/support-inbox'), 'redirect target inbox')
  const app = read('src/App.tsx')
  assert(app.includes('RedirectHome'), 'App catch-all uses RedirectHome')
  assert(!app.includes('<Navigate to="/" replace />'), 'App no hard Navigate to / catch-all')
}

console.log('C. Support Inbox uses support_agency_brief')
{
  const support = read('src/lib/support.ts')
  assert(support.includes("rpc('support_agency_brief')"), 'support calls support_agency_brief')
  assert(support.includes('hydrateConversationAgencyNames'), 'hydrate helper present')
  assert(
    !support.includes('agency_profile:agency_profile_id'),
    'no agency_profile embed in conversation select',
  )
  assert(support.includes('CONVERSATION_SELECT'), 'conversation select present')
}

console.log('D. Producer identity linkage contract')
{
  const directory = read('src/lib/directory.ts')
  assert(directory.includes('agency_profile_id'), 'producer sync aware of agency')
  assert(
    directory.includes('belongs to another agency') ||
      directory.includes('another agency'),
    'rejects foreign producer assignment',
  )
  assert(directory.includes(".eq('agency_profile_id', agencyProfileId)") || directory.includes(".eq('agency_profile_id', userAgencyId)"), 'options/sync scoped by agency')
  assert(directory.includes('isMissingColumnError'), 'producer directory retries when optional columns are absent')
  assert(directory.includes('fetchLiveProducerDirectory'), 'Add Transaction producer names use live-directory helper')
  const migration = 'supabase/migrations/20260829090000_multitenancy_v1_phase4d_producer_link.sql'
  assert(existsSync(resolve(root, migration)), '4D producer migration present')
  const sql = read(migration)
  assert(sql.includes('SECURITY INVOKER'), 'protect user privilege is SECURITY INVOKER')
  assert(sql.includes('NEW.producer_id IS DISTINCT FROM OLD.producer_id'), 'protect blocks self producer_id')
  assert(sql.includes('current_producer_name'), 'current_producer_name tightened')
  assert(sql.includes('p.agency_profile_id = u.agency_profile_id'), 'producer name requires same agency')
  assert(
    sql.includes('Does NOT add transactions.producer_id') || !/\bALTER TABLE public\.transactions\b/.test(sql),
    'no transactions.producer_id column added',
  )

  const scoped = resolveProducerBookName('producer', 'No Match', ['DUMMY Payout V1 Producer'], {
    linkedProducerName: null,
  })
  assert(scoped.lockedName === null, 'unlinked producer-only fail closed (no display-name book)')
  const linked = resolveProducerBookName('producer', 'X', ['DUMMY Payout V1 Producer'], {
    linkedProducerName: 'DUMMY Payout V1 Producer',
  })
  assert(linked.lockedName === 'DUMMY Payout V1 Producer', 'linked producer book resolves')
}

console.log('E. Users UI + no agency-admin alza_support grant')
{
  const users = read('src/pages/admin/Users.tsx')
  assert(users.includes('linked-producer-panel'), 'Users edit has linked producer panel')
  assert(users.includes('linked-producer-panel-add'), 'Users invite has linked producer panel')
  assert(users.includes('AGENCY_ASSIGNABLE_ROLES'), 'Users uses agency assignable roles')
  assert(
    users.includes('ALZA Support is a platform role and cannot be assigned here'),
    'Users blocks alza_support assignment',
  )
  const perms = read('src/lib/permissions.ts')
  assert(perms.includes("AGENCY_ASSIGNABLE_ROLES"), 'AGENCY_ASSIGNABLE_ROLES exported')
  assert(!perms.includes("AGENCY_ASSIGNABLE_ROLES: AppRole[] = [") || !/'alza_support'/.test(
    perms.match(/AGENCY_ASSIGNABLE_ROLES[^=]*=\s*\[[^\]]+\]/)?.[0] ?? '',
  ), 'AGENCY_ASSIGNABLE excludes alza_support')
  const invite = read('supabase/functions/invite-alza-user/index.ts')
  assert(
    invite.includes('alza_support') &&
      (invite.includes('cannot') || invite.includes('forbidden') || invite.includes('not allowed')),
    'invite edge rejects alza_support grant path',
  )
}

console.log('F. 4C cleanup narrowed')
{
  const preclean = read('tmp-phase4c-precleanup.sql')
  assert(preclean.includes('POL-STAGING-0001'), 'precleanup protects seed policy')
  assert(preclean.includes('05000000-0000-4000-8000-000000000005'), 'precleanup protects seed policy id')
  const staging = read('tmp-phase4c-staging-jwt.ts')
  assert(staging.includes('fixtureIds.policyId'), '4C test deletes by fixture policy id')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
