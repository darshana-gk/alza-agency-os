/**
 * Phase31C — producer identity + self-update guard (source + unit).
 * Run: npx tsx scripts/validate-phase31c-producer-identity.ts
 *
 * Does not write Phase31C agency data.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  canAccessAdminSection,
  canAccessPath,
  canAccessReconciliation,
  resolveProducerBookName,
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

const LOGIN_NAME = 'Phase31C UAT Producer'
const BOOK_NAME = 'Alex Morgan'
const PRODUCER_ID = '2c273a9c-a180-4878-b007-6da9dfcd3ac2'

console.log('A. Auth profile preserves producer_id and uses current_producer_name()')
{
  const auth = read('src/lib/auth.tsx')
  assert(auth.includes("rpc('current_producer_name')"), 'auth calls current_producer_name RPC')
  assert(auth.includes('PROFILE_SELECT_CORE'), 'core profile select constant exists')
  assert(
    auth.includes("'id, auth_user_id, full_name, email, role, status, archived_at, producer_id'"),
    'fallback profile select keeps producer_id',
  )
  assert(!auth.includes('producers(producer_name)'), 'auth does not embed producers()')
  assert(!auth.includes("error.message.includes('producers')"), 'auth no longer drops columns on producers embed error')
  assert(auth.includes("rpc('mark_current_user_invite_accepted')"), 'login still marks invite accepted')
  assert(auth.includes('resolveLinkedProducerNameFromRpc'), 'RPC helper used for linkedProducerName')
}

console.log('B. resolveProducerBookName fail-closed + explicit link')
{
  const matched = resolveProducerBookName('producer', LOGIN_NAME, [BOOK_NAME], {
    linkedProducerName: BOOK_NAME,
    producerId: PRODUCER_ID,
  })
  assert(matched.lockedName === BOOK_NAME, '1. login full_name differs; book resolves to linked producer_name')
  assert(matched.limitation === null, '11. no empty-book warning with valid explicit link')

  const unresolved = resolveProducerBookName('producer', LOGIN_NAME, [BOOK_NAME], {
    linkedProducerName: null,
    producerId: PRODUCER_ID,
  })
  assert(unresolved.lockedName === null, 'explicit producer_id without RPC name fails closed')
  assert(unresolved.limitation?.includes('explicit') === true, 'fail-closed message when link cannot resolve')
  assert(unresolved.lockedName !== LOGIN_NAME, 'does not fall back to login full_name when producer_id exists')

  const unlinked = resolveProducerBookName('producer', LOGIN_NAME, [BOOK_NAME], {
    linkedProducerName: null,
    producerId: null,
  })
  assert(unlinked.lockedName === null, 'producer-only with no producer_id fails closed')
}

console.log('C. Producer-facing pages use linked book identity')
{
  for (const [rel, label] of [
    ['src/pages/Dashboard.tsx', '4. Dashboard'],
    ['src/pages/Clients.tsx', '5. Clients'],
    ['src/pages/PolicyFiles.tsx', '7. Policy Files'],
    ['src/pages/Transactions.tsx', '9. Transactions'],
    ['src/pages/Reports.tsx', '10. Reports'],
    ['src/pages/ClientDetails.tsx', '6. Client Details'],
    ['src/pages/PolicyDetails.tsx', '8. Policy Details'],
  ] as const) {
    const src = read(rel)
    assert(src.includes('producerBookOptionsFromProfile') || src.includes('producerId:'), `${label} passes producerId/link options`)
    assert(src.includes('resolveProducerBookName'), `${label} uses resolveProducerBookName`)
  }
  const clientDetails = read('src/pages/ClientDetails.tsx')
  assert(
    !clientDetails.includes('producerKeysMatch(clientProducer, profile?.fullName)'),
    'Client Details does not compare producer TEXT to fullName only',
  )
  const policyDetails = read('src/pages/PolicyDetails.tsx')
  assert(
    !policyDetails.includes('producerKeysMatch(mapped.producer, profile?.fullName)'),
    'Policy Details does not compare producer TEXT to fullName only',
  )
}

console.log('D. Security — nav / path + self-update migration')
{
  assert(!canAccessReconciliation('producer'), '14. Producer cannot access Reconciliation')
  assert(!canAccessAdminSection('producer'), '15. Producer cannot access Administration')
  assert(!canAccessPath('producer', '/reconciliation'), 'Producer path denies /reconciliation')
  assert(!canAccessPath('producer', '/admin/users'), 'Producer path denies /admin/users')
  assert(canAccessPath('producer', '/'), 'Producer can access Dashboard')
  assert(canAccessPath('producer', '/clients'), 'Producer can access Clients')
  assert(canAccessPath('producer', '/transactions'), 'Producer can access Transactions')
  assert(canAccessPath('producer', '/reports'), 'Producer can access Reports')
  assert(canAccessPath('owner', '/admin/users'), '16. Owner can still access Users')
  assert(canAccessAdminSection('admin'), 'Admin administration preserved')

  const migration = 'supabase/migrations/20260916120000_producer_identity_self_update_guard.sql'
  assert(existsSync(resolve(root, migration)), 'self-update guard migration exists')
  const sql = read(migration)
  assert(sql.includes('NEW.producer_id IS DISTINCT FROM OLD.producer_id'), '12. trigger blocks self producer_id change')
  assert(sql.includes('SECURITY INVOKER'), 'guard is SECURITY INVOKER (JWT role)')
  assert(sql.includes('is_admin_directory_role()'), 'Owner/Admin assignment path preserved')
  assert(sql.includes('aab_multitenancy_protect_user'), 'users update trigger reattached')
}

console.log('E. Invite / Users robustness')
{
  const invite = read('supabase/functions/invite-alza-user/index.ts')
  assert(invite.includes('resolveInviteProducerId'), '17/create: invite resolves producer_id')
  assert(invite.includes('updatePayload.producer_id'), 'create persists producer_id when selected')
  assert(invite.includes('insertPayload.producer_id'), 'insert persists producer_id when selected')
  assert(invite.includes('Resend must not touch users.producer_id'), '17. resend preserves producer_id')
  assert(invite.includes('cross_agency_producer'), 'cross-agency producer assignment rejected')
  const users = read('src/pages/admin/Users.tsx')
  assert(users.includes('preserveManualSelection'), '19. hydration can preserve manual Linked Producer')
  assert(users.includes('producer_id: hasProducer ? addForm.linkedProducerId || null : null'), 'invite body sends producer_id')
  const setPassword = read('src/pages/SetPassword.tsx')
  assert(setPassword.includes("rpc('mark_current_user_invite_accepted')"), '18. set-password calls invite accepted RPC')
  assert(setPassword.includes('acceptError'), 'set-password handles RPC failure')
}

console.log('F. Duplicate-producer prevention still present')
{
  const directory = read('src/lib/directory.ts')
  assert(directory.includes('preferredProducerId'), 'sync accepts explicit preferredProducerId')
  assert(
    directory.includes('Never creates a second row') || directory.includes('findExistingProducer'),
    '20. directory sync prefers existing row over create',
  )
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
