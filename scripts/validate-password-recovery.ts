/**
 * Password recovery routing + validation.
 * Run: npx tsx scripts/validate-password-recovery.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_PATH,
  parseAuthCallbackParams,
  postPasswordResetPath,
  urlIndicatesPasswordRecovery,
  validateNewPassword,
} from '../src/lib/passwordRecovery.ts'

let failed = 0
let passed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    console.log(`  OK: ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL: ${message}`)
}

console.log('A. URL recovery detection')
{
  assert(
    urlIndicatesPasswordRecovery('https://preview.example/#access_token=x&type=recovery&refresh_token=y'),
    'hash type=recovery',
  )
  assert(
    urlIndicatesPasswordRecovery('https://preview.example/?type=recovery&code=abc'),
    'query type=recovery',
  )
  assert(
    urlIndicatesPasswordRecovery(`https://preview.example${RESET_PASSWORD_PATH}`),
    'reset password path',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/'),
    'bare origin is not recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/#access_token=x&type=signup'),
    'signup hash is not recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/auth/set-password'),
    'invite set-password path is not recovery',
  )
  assert(parseAuthCallbackParams('https://x/#type=recovery').get('type') === 'recovery', 'parse hash type')
}

console.log('B. Password validation (existing 8-character rule)')
{
  assert(MIN_PASSWORD_LENGTH === 8, 'min length 8')
  assert(validateNewPassword('short', 'short').ok === false, 'reject short')
  assert(validateNewPassword('longenough', 'different1').ok === false, 'reject mismatch')
  const mismatch = validateNewPassword('longenough', 'different1')
  assert(!mismatch.ok && mismatch.error === 'Passwords do not match.', 'mismatch copy')
  const short = validateNewPassword('abc', 'abc')
  assert(!short.ok && short.error === 'Password must be at least 8 characters.', 'short copy')
  assert(validateNewPassword('longenough', 'longenough').ok === true, 'accept matching 8+')
}

console.log('C. Post-reset routing')
{
  assert(postPasswordResetPath('alza_support') === '/admin/support-inbox', 'alza_support → inbox')
  assert(postPasswordResetPath(['alza_support']) === '/admin/support-inbox', 'alza_support roles array')
  assert(postPasswordResetPath('owner') === '/', 'owner → app home')
  assert(postPasswordResetPath('admin') === '/', 'admin → app home')
  assert(postPasswordResetPath('csr') === '/', 'csr → app home')
  assert(postPasswordResetPath(null) === '/', 'empty → app home')
}

console.log('D. Source contracts')
{
  const root = resolve(process.cwd())
  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
  const auth = readFileSync(resolve(root, 'src/lib/auth.tsx'), 'utf8')
  const page = readFileSync(resolve(root, 'src/pages/ResetPassword.tsx'), 'utf8')
  assert(app.includes('passwordRecoveryPending'), 'App intercepts recovery pending')
  assert(app.includes('ResetPasswordPage'), 'App mounts ResetPasswordPage')
  assert(auth.includes('PASSWORD_RECOVERY'), 'auth listens for PASSWORD_RECOVERY')
  assert(page.includes('updateUser({ password })'), 'reset uses updateUser password')
  assert(page.includes('Update Password'), 'Update Password button copy')
  assert(!page.includes('mark_current_user_invite_accepted'), 'reset does not accept invite')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
console.log('validate-password-recovery: ALL GREEN')
