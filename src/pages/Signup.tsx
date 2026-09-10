import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { createSelfServeAgencySignup } from '../lib/selfServeSignup'
import { purchaseIntentFromSearchParams } from '../lib/purchaseIntent'
import { quoteBillingSelection } from '../lib/billingCatalog'

export function SignupPage() {
  const { status, signIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [fullName, setFullName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const intent = useMemo(() => purchaseIntentFromSearchParams(searchParams), [searchParams])

  const intentQuote = useMemo(() => {
    if (!intent) return null
    return quoteBillingSelection({
      product: intent.product,
      userBand: intent.userBand,
      interval: intent.interval,
    })
  }, [intent])

  useEffect(() => {
    document.title = 'Create account · ALZA Flow'
  }, [])

  if (status === 'authenticated') {
    const billingTarget = intent
      ? `/admin/subscription-billing?plan_key=${encodeURIComponent(intent.planKey)}`
      : '/admin/subscription-billing'
    return <Navigate to={billingTarget} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!fullName.trim() || !agencyName.trim() || !email.trim() || !password) {
      setError('Fill in all fields to create your account.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const created = await createSelfServeAgencySignup({
      fullName,
      agencyName,
      email,
      password,
      product: intent?.product ?? null,
      userBand: intent?.userBand ?? null,
      interval: intent?.interval ?? null,
      planKey: intent?.planKey ?? null,
    })

    if (created.error) {
      setLoading(false)
      setError(created.error)
      return
    }

    const signedIn = await signIn(email.trim(), password)
    setLoading(false)
    if (signedIn.error) {
      setError(
        'Account created, but sign-in failed. Use Sign in with the same email and password.',
      )
      return
    }

    // Intent is persisted on the incomplete billing row; keep plan_key in URL as a belt-and-suspenders.
    const billingPath = intent
      ? `/admin/subscription-billing?plan_key=${encodeURIComponent(intent.planKey)}`
      : '/admin/subscription-billing'
    navigate(billingPath, { replace: true })
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
            Create your agency account to get started.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {intentQuote ? (
            <div className="mb-4 rounded-lg border border-alza-blue-100 bg-alza-blue-50/60 px-3 py-2 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Selected plan</p>
              <p className="mt-0.5">
                {intentQuote.bandLabel} · {intentQuote.intervalLabel} · {intentQuote.displayPrice}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{intent?.planKey}</p>
            </div>
          ) : null}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Your name</span>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="Jane Smith"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Agency / business name
              </span>
              <input
                type="text"
                autoComplete="organization"
                value={agencyName}
                onChange={(e) => setAgencyName(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="Acme Insurance Agency"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Work email</span>
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="At least 8 characters"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Confirm password
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                placeholder="Repeat password"
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

            <p className="text-center text-sm text-slate-600">
              Already have an account?{' '}
              <Link to="/" className="font-medium text-alza-blue-700 hover:underline">
                Sign in
              </Link>
            </p>
            <p className="text-center text-sm text-slate-600">
              <Link to="/pricing" className="font-medium text-alza-blue-700 hover:underline">
                Back to pricing
              </Link>
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          New agencies can create an account here. Invited teammates still use the invite email.
        </p>
      </div>
    </div>
  )
}
