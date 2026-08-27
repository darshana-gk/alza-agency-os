import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Zap } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { postPasswordResetPath, validateNewPassword } from '../lib/passwordRecovery'

/**
 * Dedicated password-reset screen for Supabase PASSWORD_RECOVERY.
 * Must render even when the recovery email lands on `/` (not /auth/set-password).
 */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { profile, refreshProfile, completePasswordRecovery } = useAuth()
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    document.title = 'ALZA Flow · Reset Password'
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      await new Promise((r) => setTimeout(r, 50))
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (cancelled) return

      if (sessionError) {
        setError(sessionError.message)
        setReady(true)
        return
      }

      const session = data.session
      setHasSession(Boolean(session))
      setEmail(session?.user?.email ?? null)
      if (!session) {
        setError(
          'This reset link is missing, expired, or already used. Request a new password recovery email and open it once.',
        )
      }
      setReady(true)
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!hasSession) {
      setError('No active reset session. Open the Reset password link from your email again.')
      return
    }

    const check = validateNewPassword(password, confirm)
    if (!check.ok) {
      setError(check.error)
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSaving(false)
      setError(updateError.message)
      return
    }

    const nextProfile = await refreshProfile()
    setSaving(false)
    setSuccess('Password updated. Continuing to ALZA Flow…')

    const next = postPasswordResetPath(nextProfile?.roles ?? nextProfile?.role ?? profile?.roles ?? profile?.role)
    window.setTimeout(() => {
      completePasswordRecovery()
      navigate(next, { replace: true })
    }, 600)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-alza-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-alza-teal-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl gradient-alza shadow-md">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-wide text-slate-900">ALZA FLOW</h1>
          <p className="mt-1 text-xs font-medium text-slate-500">by ALZA Business Solutions LLP</p>
          <p className="mt-3 text-sm text-slate-600">Choose a new password for your account.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {!ready ? (
            <p className="text-sm text-slate-600">Validating reset link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-alza-blue-700" />
                <div className="min-w-0 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">Reset password</p>
                  <p className="mt-0.5 truncate text-slate-600">{email || 'No email on session'}</p>
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!hasSession || saving}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20 disabled:bg-slate-50"
                  placeholder="At least 8 characters"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={!hasSession || saving}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20 disabled:bg-slate-50"
                  placeholder="Repeat password"
                />
              </label>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={!hasSession || saving}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg gradient-alza text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Remembered your password?{' '}
          <Link
            to="/"
            className="font-medium text-alza-blue-700 hover:underline"
            onClick={() => completePasswordRecovery()}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
