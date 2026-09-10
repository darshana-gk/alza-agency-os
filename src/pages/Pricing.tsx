import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { canManageBilling, rolesOf } from '../lib/permissions'
import {
  BILLING_INTERVALS,
  billingUserBands,
  formatUsdWhole,
  quoteBillingSelection,
  type BillingInterval,
  type BillingUserBandKey,
} from '../lib/billingCatalog'
import {
  billingPathForPlan,
  signupPathForPlan,
  type PurchaseIntent,
} from '../lib/purchaseIntent'

const CONTACT_MAILTO =
  'mailto:support@alzabusiness.com?subject=ALZA%20Flow%20pricing%20inquiry'

function getStartedHref(intent: PurchaseIntent, authenticatedBilling: boolean): string {
  return authenticatedBilling ? billingPathForPlan(intent.planKey) : signupPathForPlan(intent.planKey)
}

export function PricingPage() {
  const { status, profile } = useAuth()
  const navigate = useNavigate()
  const [interval, setInterval] = useState<BillingInterval>('monthly')

  const authenticated = status === 'authenticated'
  const canPickForBilling =
    authenticated && canManageBilling(rolesOf(profile))

  useEffect(() => {
    document.title = 'Pricing · ALZA Flow'
  }, [])

  const flowBands = useMemo(() => billingUserBands('alza_flow'), [])
  const selfServeBands = flowBands.filter((b) => b.checkoutEligible)
  const contactBands = flowBands.filter((b) => !b.checkoutEligible)

  function handleGetStarted(bandKey: BillingUserBandKey) {
    const quote = quoteBillingSelection({
      product: 'alza_flow',
      userBand: bandKey,
      interval,
    })
    if (!quote.sku || !quote.checkoutEligible) return
    const href = getStartedHref(
      {
        product: 'alza_flow',
        userBand: bandKey,
        interval,
        planKey: quote.sku,
      },
      canPickForBilling,
    )
    if (canPickForBilling) {
      navigate(href)
      return
    }
    navigate(href)
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-alza-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-alza-teal-200/40 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl gradient-alza shadow-md">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-wide text-slate-900 sm:text-4xl">ALZA FLOW</h1>
          <p className="mt-1 text-xs font-medium text-slate-500">
            by ALZA Business Solutions LLP
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm text-slate-600 sm:text-base">
            Commission operations for insurance agencies. Choose your user band, then create your
            account and subscribe.
          </p>
        </div>

        <div className="mb-8 flex justify-center">
          <div
            className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
            role="group"
            aria-label="Billing interval"
          >
            {BILLING_INTERVALS.map((opt) => {
              const active = interval === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setInterval(opt.key)}
                  className={
                    active
                      ? 'rounded-lg gradient-alza px-4 py-2 text-sm font-medium text-white shadow-sm'
                      : 'rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50'
                  }
                >
                  {opt.label}
                  {opt.key === 'annual' ? (
                    <span className={active ? 'ml-1.5 opacity-90' : 'ml-1.5 text-alza-teal-700'}>
                      · 2 months free
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {selfServeBands.map((band) => {
            const quote = quoteBillingSelection({
              product: 'alza_flow',
              userBand: band.key,
              interval,
            })
            const amount = interval === 'annual' ? band.annual : band.monthly
            return (
              <div
                key={band.key}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {band.label}
                </h2>
                <p className="mt-3 text-3xl font-bold text-slate-900">
                  {amount != null ? formatUsdWhole(amount) : '—'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {interval === 'annual' ? 'per year' : 'per month'}
                </p>
                {interval === 'annual' && band.monthly != null ? (
                  <p className="mt-2 text-xs text-alza-teal-700">
                    2 months free · {formatUsdWhole(band.monthly * 10)} billed annually
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Self-service checkout</p>
                )}
                <button
                  type="button"
                  disabled={!quote.sku || !quote.checkoutEligible}
                  onClick={() => handleGetStarted(band.key)}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg gradient-alza text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {canPickForBilling ? 'Continue to billing' : 'Get Started'}
                </button>
                {quote.sku ? (
                  <p className="mt-2 text-center text-[11px] text-slate-400">{quote.sku}</p>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {contactBands.map((band) => {
            const guidance =
              band.key === 'users_51_100' && band.monthly != null
                ? `Starts at ${formatUsdWhole(band.monthly)}+/month`
                : 'Custom pricing'
            return (
              <div
                key={band.key}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {band.label}
                </h2>
                <p className="mt-3 text-xl font-bold text-slate-900">{guidance}</p>
                <p className="mt-2 text-sm text-slate-600">
                  Online checkout is not available. Contact ALZA for a tailored plan.
                </p>
                <a
                  href={CONTACT_MAILTO}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100"
                >
                  Contact ALZA
                </a>
              </div>
            )
          })}

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              ALZA Flow Pay
            </h2>
            <p className="mt-3 text-xl font-bold text-slate-900">Coming Soon</p>
            <p className="mt-2 text-sm text-slate-600">
              Integrated producer payments are on the waitlist. Checkout is not available yet.
            </p>
            <span className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-medium text-slate-500">
              Waitlist only
            </span>
          </div>
        </div>

        <p className="mt-10 text-center text-sm text-slate-600">
          {authenticated ? (
            <>
              Already signed in.{' '}
              <Link
                to="/admin/subscription-billing"
                className="font-medium text-alza-blue-700 hover:underline"
              >
                Open Subscription Billing
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link to="/" className="font-medium text-alza-blue-700 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
