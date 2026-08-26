import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PROSPECT_HOME_PATH } from '../lib/agencyLifecycle'

/**
 * Minimal prospect signup (not a marketing page).
 * Future CTA: Pricing → /signup → agency prospect → checkout → (later) active ops.
 */
export function SignupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [agencyName, setAgencyName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.title = 'Create agency account — ALZA Flow'
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!agencyName.trim() || !email.trim() || !password) {
      setError('Agency name, email, and password are required.')
      return
    }
    setLoading(true)
    const { data, error: invokeError } = await supabase.functions.invoke('create-agency-signup', {
      body: {
        agency_name: agencyName.trim(),
        full_name: fullName.trim() || agencyName.trim(),
        email: email.trim(),
        password,
      },
    })
    setLoading(false)

    if (invokeError) {
      setError(invokeError.message || 'Unable to create agency account.')
      return
    }

    const payload = data as {
      ok?: boolean
      message?: string
      access_token?: string
      refresh_token?: string
      lifecycle?: string
    } | null

    if (!payload?.ok) {
      setError(payload?.message || 'Unable to create agency account.')
      return
    }

    if (payload.access_token && payload.refresh_token) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      })
      if (sessionError) {
        setError(sessionError.message)
        return
      }
    }

    const q = searchParams.toString()
    navigate(q ? `${PROSPECT_HOME_PATH}?${q}` : PROSPECT_HOME_PATH, { replace: true })
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
          <p className="mt-1 text-xs font-medium text-slate-500">Create agency account</p>
          <p className="mt-3 text-sm text-slate-600">
            Create your workspace, then choose a subscription. Operational ALZA Flow unlocks after
            activation.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency / workspace name</span>
              <input
                value={agencyName}
                onChange={(e) => setAgencyName(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="Your Agency LLC"
                autoComplete="organization"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Your name</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="Optional"
                autoComplete="name"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="you@agency.com"
                autoComplete="username"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg gradient-alza text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Already have an account?{' '}
          <Link to="/" className="font-medium text-alza-blue-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
