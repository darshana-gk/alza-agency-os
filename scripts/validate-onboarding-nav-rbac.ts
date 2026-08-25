/**
 * Onboarding Import RBAC + sidebar placement regression (no network).
 * Run: npx tsx scripts/validate-onboarding-nav-rbac.ts
 */

import { canAccessOnboardingImport } from '../src/lib/onboardingImport.ts'
import {
  canAccessPath,
  getNavVisibility,
  roleInputFromProfile,
} from '../src/lib/permissions.ts'
import {
  roleCanOpenOnboarding,
  sidebarNavForRole,
} from '../src/lib/sidebarNav.ts'

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.error(`FAIL: ${message}`)
}

function adminLabels(role: string) {
  return sidebarNavForRole(role)
    .filter((i) => i.section === 'administration')
    .map((i) => i.label)
}

function mainLabels(role: string) {
  return sidebarNavForRole(role)
    .filter((i) => i.section === 'main')
    .map((i) => i.label)
}

console.log('Owner sees Onboarding Import under Administration')
{
  const nav = getNavVisibility('owner')
  assert(nav.onboardingImport === true, 'owner onboardingImport visibility true')
  assert(nav.administration === true, 'owner administration visibility true')
  assert(roleCanOpenOnboarding('owner'), 'owner canAccessPath(/onboarding)')
  assert(canAccessPath('owner', '/onboarding'), 'canAccessPath owner /onboarding')
  assert(canAccessOnboardingImport('owner'), 'canAccessOnboardingImport owner')

  const admin = adminLabels('owner')
  assert(admin.includes('Onboarding Import'), 'owner Administration includes Onboarding Import')
  assert(admin[0] === 'Onboarding Import', 'Onboarding Import is first Administration item')
  assert(
    !mainLabels('owner').includes('Onboarding Import'),
    'owner main nav does NOT list Onboarding Import',
  )
  assert(admin.includes('Producers'), 'owner still has Producers in Administration')
  assert(admin.includes('Subscription & Billing'), 'owner still has Subscription & Billing')
}

console.log('Admin same as Owner for onboarding nav/access')
{
  assert(getNavVisibility('admin').onboardingImport === true, 'admin onboardingImport true')
  assert(roleCanOpenOnboarding('admin'), 'admin can open /onboarding')
  assert(
    adminLabels('admin').includes('Onboarding Import'),
    'admin Administration includes Onboarding Import',
  )
}

console.log('CSR blocked from onboarding nav and route')
{
  const nav = getNavVisibility('csr')
  assert(nav.onboardingImport === false, 'csr onboardingImport false')
  assert(nav.administration === false, 'csr no Administration section')
  assert(!roleCanOpenOnboarding('csr'), 'csr cannot open /onboarding')
  assert(!canAccessOnboardingImport('csr'), 'canAccessOnboardingImport csr false')
  assert(
    !sidebarNavForRole('csr').some((i) => i.label === 'Onboarding Import'),
    'csr sidebar has no Onboarding Import anywhere',
  )
}

console.log('Producer blocked from onboarding nav and route')
{
  const nav = getNavVisibility('producer')
  assert(nav.onboardingImport === false, 'producer onboardingImport false')
  assert(!roleCanOpenOnboarding('producer'), 'producer cannot open /onboarding')
  assert(!canAccessOnboardingImport('producer'), 'canAccessOnboardingImport producer false')
  assert(
    !sidebarNavForRole('producer').some((i) => i.label === 'Onboarding Import'),
    'producer sidebar has no Onboarding Import anywhere',
  )
}

console.log('Multi-role Owner+Producer still sees onboarding')
{
  const roles: string[] = ['owner', 'producer']
  assert(getNavVisibility(roles).onboardingImport === true, 'owner+producer visibility')
  assert(roleCanOpenOnboarding(roles), 'owner+producer can open route')
  assert(
    sidebarNavForRole(roles).some(
      (i) => i.label === 'Onboarding Import' && i.section === 'administration',
    ),
    'owner+producer Administration includes Onboarding Import',
  )
}

console.log('roleInputFromProfile prefers additive roles[]')
{
  const input = roleInputFromProfile({
    role: 'producer',
    roles: ['owner', 'producer'],
  })
  assert(
    getNavVisibility(input).onboardingImport === true,
    'profile with roles=[owner,producer] shows onboarding even if primary string is producer',
  )
  assert(roleCanOpenOnboarding(input), 'additive owner role opens /onboarding')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
