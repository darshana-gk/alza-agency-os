/**
 * Password recovery routing + validation.
 * Run: npx tsx scripts/validate-password-recovery.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_PATH,
  getRecoveryTokenHash,
  parseAuthCallbackParams,
  passwordResetRedirectTo,
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
    'reset password path without leftover type',
  )
  assert(
    urlIndicatesPasswordRecovery(`https://preview.example${RESET_PASSWORD_PATH}?code=pkce`),
    'reset path PKCE code without type=recovery',
  )
  assert(
    urlIndicatesPasswordRecovery('https://preview.example/?token_hash=abc&type=recovery'),
    'token_hash + type=recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/'),
    'bare origin is not recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/?code=oauth'),
    'PKCE code on / is not recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/#access_token=x&type=signup'),
    'signup hash is not recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/auth/set-password'),
    'invite set-password path is not recovery',
  )
  assert(
    !urlIndicatesPasswordRecovery('https://preview.example/auth/set-password?token_hash=abc&type=invite'),
    'invite token_hash is not recovery',
  )
  assert(parseAuthCallbackParams('https://x/#type=recovery').get('type') === 'recovery', 'parse hash type')
}

console.log('B. token_hash extraction')
{
  assert(
    getRecoveryTokenHash('https://preview.example/?token_hash=th1&type=recovery') === 'th1',
    'extract token_hash with type=recovery',
  )
  assert(
    getRecoveryTokenHash(`https://preview.example${RESET_PASSWORD_PATH}?token_hash=th2`) === 'th2',
    'extract token_hash on reset path',
  )
  assert(
    getRecoveryTokenHash('https://preview.example/auth/set-password?token_hash=th3&type=invite') === null,
    'do not extract invite token_hash',
  )
  assert(
    getRecoveryTokenHash('https://preview.example/#access_token=x&type=recovery') === null,
    'implicit hash has no token_hash',
  )
}

console.log('C. Password validation (existing 8-character rule)')
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

console.log('D. Post-reset routing')
{
  assert(postPasswordResetPath('alza_support') === '/admin/support-inbox', 'alza_support → inbox')
  assert(postPasswordResetPath(['alza_support']) === '/admin/support-inbox', 'alza_support roles array')
  assert(postPasswordResetPath('owner') === '/', 'owner → app home')
  assert(postPasswordResetPath('admin') === '/', 'admin → app home')
  assert(postPasswordResetPath('csr') === '/', 'csr → app home')
  assert(postPasswordResetPath(null) === '/', 'empty → app home')
  assert(
    passwordResetRedirectTo('https://preview.example') === 'https://preview.example/auth/reset-password',
    'redirectTo uses origin + reset path',
  )
}

console.log('E. Source contracts')
{
  const root = resolve(process.cwd())
  const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
  const auth = readFileSync(resolve(root, 'src/lib/auth.tsx'), 'utf8')
  const login = readFileSync(resolve(root, 'src/pages/Login.tsx'), 'utf8')
  const page = readFileSync(resolve(root, 'src/pages/ResetPassword.tsx'), 'utf8')
  const recovery = readFileSync(resolve(root, 'src/lib/passwordRecovery.ts'), 'utf8')
  const setPassword = readFileSync(resolve(root, 'src/pages/SetPassword.tsx'), 'utf8')

  assert(app.includes('passwordRecoveryPending'), 'App intercepts recovery pending')
  assert(app.includes('ResetPasswordPage'), 'App mounts ResetPasswordPage')
  assert(app.includes('/auth/set-password'), 'App still routes invite set-password')
  assert(auth.includes('PASSWORD_RECOVERY'), 'auth listens for PASSWORD_RECOVERY')
  assert(
    auth.indexOf("from './passwordRecovery'") < auth.indexOf("from './supabase'"),
    'passwordRecovery imported before supabase so URL is captured first',
  )
  assert(
    auth.indexOf('supabase.auth.onAuthStateChange') < auth.indexOf('export function AuthProvider'),
    'PASSWORD_RECOVERY listener registered at module load',
  )
  assert(recovery.includes('capturePasswordRecoveryFromLocation'), 'captures recovery before hash strip')
  assert(login.includes('Forgot password?'), 'Login has Forgot password?')
  assert(login.includes('resetPasswordForEmail'), 'Login requests recovery email')
  assert(
    login.includes('redirectTo: `${window.location.origin}/auth/reset-password`'),
    'Login redirectTo is current origin reset path',
  )
  assert(page.includes('updateUser({ password })'), 'reset uses updateUser password')
  assert(page.includes('verifyOtp'), 'reset exchanges token_hash via verifyOtp')
  assert(page.includes("type: 'recovery'"), 'verifyOtp type is recovery')
  assert(page.includes('token_hash: tokenHash'), 'verifyOtp uses token_hash')
  assert(page.includes('Update Password'), 'Update Password button copy')
  assert(!page.includes('mark_current_user_invite_accepted'), 'reset does not accept invite')
  assert(setPassword.includes('/auth/set-password') || setPassword.includes('invite'), 'invite set-password page preserved')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
console.log('validate-password-recovery: ALL GREEN')
