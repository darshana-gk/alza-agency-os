/**
 * Offline self-serve signup profile validation + invite-flow regression.
 * Does NOT call Razorpay. Does NOT create accounts. Does NOT touch Production.
 *
 * Run: npx tsx scripts/validate-self-serve-signup.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isValidWorkPhone,
  validateSelfServeSignupProfile,
} from '../src/lib/selfServeSignup.ts'

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

const root = resolve(process.cwd())
function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

const valid = {
  fullName: 'Jordan Lee',
  agencyName: 'Example Agency',
  jobTitle: 'Operations Manager',
  workPhone: '+1 202 555 0147',
  email: 'jordan@example.com',
  password: 'Password1!',
  confirmPassword: 'Password1!',
}

console.log('A. Profile validation')
{
  const ok = validateSelfServeSignupProfile(valid)
  assert(ok.ok === true, 'valid profile accepted')
  assert(validateSelfServeSignupProfile({ ...valid, fullName: '' }).ok === false, 'full name required')
  assert(validateSelfServeSignupProfile({ ...valid, agencyName: '' }).ok === false, 'company name required')
  assert(validateSelfServeSignupProfile({ ...valid, jobTitle: '' }).ok === false, 'job title required')
  assert(validateSelfServeSignupProfile({ ...valid, email: '' }).ok === false, 'work email required')
  assert(validateSelfServeSignupProfile({ ...valid, workPhone: '' }).ok === false, 'work phone required')
  assert(validateSelfServeSignupProfile({ ...valid, password: '' }).ok === false, 'password required')
  const mismatch = validateSelfServeSignupProfile({ ...valid, confirmPassword: 'other' })
  assert(mismatch.ok === false && 'code' in mismatch && mismatch.code === 'password_mismatch', 'confirm password mismatch')
  assert(validateSelfServeSignupProfile({ ...valid, jobTitle: 'A' }).ok === false, 'job title min length')
  assert(validateSelfServeSignupProfile({ ...valid, workPhone: '123' }).ok === false, 'too-short phone rejected')
  assert(validateSelfServeSignupProfile({ ...valid, workPhone: 'not-a-phone' }).ok === false, 'alpha phone rejected')
  assert(isValidWorkPhone('+44 20 7946 0958'), 'UK number accepted')
  assert(isValidWorkPhone('+91 98765 43210'), 'India number accepted')
  assert(isValidWorkPhone('(202) 555-0147'), 'formatted local-length number accepted')
  assert(!isValidWorkPhone('+1 555 01'), 'under-digit phone rejected')
  const htmlTitle = validateSelfServeSignupProfile({ ...valid, jobTitle: '<script>x</script>' })
  assert(htmlTitle.ok === true && htmlTitle.value.jobTitle === '<script>x</script>', 'job title stored as plain text')
}

console.log('B. Signup page + pipeline wiring')
{
  const signup = read('src/pages/Signup.tsx')
  const client = read('src/lib/selfServeSignup.ts')
  const fn = read('supabase/functions/create-agency-signup/index.ts')
  const migration = read('supabase/migrations/20260917190000_self_serve_signup_profile_fields.sql')
  assert(signup.includes('Full Name'), 'Full Name')
  assert(signup.includes('Company Name'), 'Company Name')
  assert(signup.includes('Job Title / Designation'), 'Job Title')
  assert(signup.includes('Work Email'), 'Work Email')
  assert(signup.includes('Work Phone'), 'Work Phone')
  assert(signup.includes('Password'), 'Password')
  assert(signup.includes('Confirm Password'), 'Confirm Password')
  assert(!signup.includes('Number of Users'), 'no Number of Users on signup')
  assert(!signup.includes('flow_1_3_monthly'), 'SKU hidden on signup page')
  assert(signup.includes('intentQuote.displayPrice'), 'selected plan price')
  assert(signup.includes('validateSelfServeSignupProfile'), 'client uses shared validator')
  {
    const order = [
      signup.indexOf('Selected plan'),
      signup.indexOf('label="Full Name"'),
      signup.indexOf('label="Company Name"'),
      signup.indexOf('label="Job Title / Designation"'),
      signup.indexOf('label="Work Email"'),
      signup.indexOf('label="Work Phone"'),
      signup.indexOf('label="Password"'),
      signup.indexOf('label="Confirm Password"'),
    ]
    assert(
      order.every((i) => i >= 0) && order.every((v, i, a) => i === 0 || v > a[i - 1]),
      'signup field order after selected plan',
    )
  }
  assert(client.includes('jobTitle: checked.value.jobTitle'), 'client sends jobTitle')
  assert(client.includes('workPhone: checked.value.workPhone'), 'client sends workPhone')
  assert(fn.includes('invalid_job_title'), 'server requires job title')
  assert(fn.includes('invalid_phone'), 'server requires work phone')
  assert(fn.includes('p_job_title: jobTitle'), 'RPC receives job title')
  assert(fn.includes('p_work_phone: workPhone'), 'RPC receives work phone')
  assert(fn.includes("Enter your company name."), 'server company copy')
  assert(migration.includes('ADD COLUMN IF NOT EXISTS job_title'), 'additive users.job_title')
  assert(migration.includes('phone,'), 'RPC writes agency_profile.phone')
  assert(migration.includes('v_job_title'), 'RPC writes users.job_title')
  assert(!migration.includes('SET NOT NULL'), 'new columns stay nullable for existing users')
  assert(!migration.includes('RENAME COLUMN'), 'no destructive rename')
}

console.log('C. Invited teammate flow unchanged')
{
  const invite = read('supabase/functions/invite-alza-user/index.ts')
  const setPassword = existsSync(resolve(root, 'src/pages/SetPassword.tsx'))
    ? read('src/pages/SetPassword.tsx')
    : ''
  assert(!invite.includes('create-agency-signup'), 'invite does not use self-serve signup')
  assert(!invite.includes('self_serve_create_agency_owner'), 'invite does not call self-serve RPC')
  assert(!invite.includes('invalid_job_title'), 'invite does not require job title')
  assert(!invite.includes('jobTitle'), 'invite payload has no jobTitle')
  assert(invite.includes('set-password') || invite.includes('SetPassword'), 'invite still uses set-password')
  assert(!setPassword.includes('Company Name'), 'set-password is not the company-owner form')
  assert(!setPassword.includes('Job Title / Designation'), 'set-password has no job title')
}

console.log('')
console.log(`Self-serve signup profile: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
