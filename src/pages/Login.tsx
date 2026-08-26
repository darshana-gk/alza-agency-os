import { useEffect, useState, type FormEvent } from 'react'
import { Zap } from 'lucide-react'
import { useAuth } from '../lib/auth'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.title = 'ALZA Flow'
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Enter your email and password to sign in.')
      return
    }

    setLoading(true)
    const result = await signIn(email, password)
    setLoading(false)

    if (result.error) {
      setError(result.error)
    }
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
          <p className="mt-1 text-xs font-medium text-slate-500">
            by ALZA Business Solutions LLP
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Sign in with your agency account to continue.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="you@agency.com"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="••••••••"
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
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need an agency workspace?{' '}
          <a href="/signup" className="font-medium text-alza-blue-700 hover:underline">
            Create agency account
          </a>
        </p>
        <p className="mt-2 text-center text-xs text-slate-500">
          Existing accounts may also be provisioned by ALZA administrators.
        </p>
      </div>
    </div>
  )
}
