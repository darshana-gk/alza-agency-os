import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { PublicBrandLink } from '../components/marketing/PublicBrandLink'
import { useAuth } from '../lib/auth'
import {
  createSelfServeAgencySignup,
  SELF_SERVE_SIGNUP_LIMITS,
  validateSelfServeSignupProfile,
} from '../lib/selfServeSignup'
import { purchaseIntentFromSearchParams } from '../lib/purchaseIntent'
import { PUBLIC_LOGIN_PATH } from '../lib/publicSite'
import { quoteBillingSelection } from '../lib/billingCatalog'

export function SignupPage() {
  const { status, signIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [fullName, setFullName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [email, setEmail] = useState('')
  const [workPhone, setWorkPhone] = useState('')
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

    const checked = validateSelfServeSignupProfile({
      fullName,
      agencyName,
      jobTitle,
      workPhone,
      email,
      password,
      confirmPassword,
    })
    if (!checked.ok) {
      setError(checked.message)
      return
    }

    setLoading(true)
    const created = await createSelfServeAgencySignup({
      fullName: checked.value.fullName,
      agencyName: checked.value.agencyName,
      jobTitle: checked.value.jobTitle,
      workPhone: checked.value.workPhone,
      email: checked.value.email,
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

    const signedIn = await signIn(checked.value.email, password)
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-neutral px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-sky blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-brand-teal/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <PublicBrandLink variant="stacked" />
          <h1 className="sr-only">ALZA FLOW</h1>
          <p className="mt-3 text-sm text-slate-600">
            Create your company account to get started.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {intentQuote ? (
            <div className="mb-4 rounded-lg border border-brand-sky bg-brand-neutral px-3 py-2 text-sm text-slate-700">
              <p className="font-medium text-brand-navy">Selected plan</p>
              <p className="mt-0.5">
                {intentQuote.bandLabel} · {intentQuote.intervalLabel}
              </p>
              <p className="mt-0.5 text-slate-600">{intentQuote.displayPrice.replace(' / ', '/')}</p>
            </div>
          ) : null}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
            <Field label="Full Name" htmlFor="fullName" required>
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                required
                maxLength={SELF_SERVE_SIGNUP_LIMITS.fullName}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputClass}
                placeholder="Jane Smith"
              />
            </Field>

            <Field label="Company Name" htmlFor="companyName" required>
              <input
                id="companyName"
                name="agencyName"
                type="text"
                autoComplete="organization"
                required
                maxLength={SELF_SERVE_SIGNUP_LIMITS.agencyName}
                value={agencyName}
                onChange={(e) => setAgencyName(e.target.value)}
                className={inputClass}
                placeholder="Acme Insurance Agency"
              />
            </Field>

            <Field label="Job Title / Designation" htmlFor="jobTitle" required>
              <input
                id="jobTitle"
                type="text"
                autoComplete="organization-title"
                required
                maxLength={SELF_SERVE_SIGNUP_LIMITS.jobTitle}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className={inputClass}
                placeholder="e.g. Agency Owner, Operations Manager"
              />
            </Field>

            <Field label="Work Email" htmlFor="workEmail" required>
              <input
                id="workEmail"
                type="email"
                autoComplete="username"
                required
                maxLength={SELF_SERVE_SIGNUP_LIMITS.email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@agency.com"
              />
            </Field>

            <Field label="Work Phone" htmlFor="workPhone" required>
              <input
                id="workPhone"
                type="tel"
                autoComplete="tel"
                required
                maxLength={SELF_SERVE_SIGNUP_LIMITS.workPhone}
                value={workPhone}
                onChange={(e) => setWorkPhone(e.target.value)}
                className={inputClass}
                placeholder="Include country code"
              />
            </Field>

            <Field label="Password" htmlFor="password" required>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={SELF_SERVE_SIGNUP_LIMITS.passwordMin}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="At least 8 characters"
              />
            </Field>

            <Field label="Confirm Password" htmlFor="confirmPassword" required>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                placeholder="Repeat password"
              />
            </Field>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-teal text-sm font-medium text-brand-navy shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>

            <p className="text-center text-sm text-slate-600">
              Already have an account?{' '}
              <Link to={PUBLIC_LOGIN_PATH} className="font-medium text-brand-teal hover:underline">
                Sign in
              </Link>
            </p>
            <p className="text-center text-sm text-slate-600">
              <Link to="/pricing" className="font-medium text-brand-teal hover:underline">
                Back to pricing
              </Link>
            </p>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          New customers can create an account here. Invited teammates still use the invite email.
        </p>
      </div>
    </div>
  )
}

const inputClass =
  'mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none ring-brand-teal/20 placeholder:text-slate-400 focus:border-brand-teal focus:ring-2'

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
        {label}
        {required ? <span className="text-brand-teal"> *</span> : null}
      </label>
      {children}
    </div>
  )
}
