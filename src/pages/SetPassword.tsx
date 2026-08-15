import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * Invite / recovery landing page.
 * Supabase invite emails redirect here with session tokens in the URL
 * (detectSessionInUrl consumes them). User sets a password, then continues.
 */
export function SetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    document.title = 'ALZA Flow · Set Password'
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      // Give detectSessionInUrl a moment to exchange hash/query tokens.
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
          'This invite or password link is missing, expired, or already used. Ask an Owner/Admin to send a new invite.',
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
      setError('No active invite session. Open the link from your invite email again.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSaving(false)
      setError(updateError.message)
      return
    }

    // Completing password setup accepts the invite in application state.
    await supabase.rpc('mark_current_user_invite_accepted')
    setSaving(false)

    setSuccess('Password saved. Continuing to ALZA Flow…')
    setTimeout(() => {
      navigate('/', { replace: true })
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
          <p className="mt-3 text-sm text-slate-600">Set your password to activate your agency account.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {!ready ? (
            <p className="text-sm text-slate-600">Validating invite link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-alza-blue-700" />
                <div className="min-w-0 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">Invite acceptance</p>
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
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Confirm password</span>
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
                {saving ? 'Saving…' : 'Save password & continue'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Already activated?{' '}
          <Link to="/" className="font-medium text-alza-blue-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
