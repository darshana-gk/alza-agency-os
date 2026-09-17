import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
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
import { PublicMarketingHeader } from '../components/marketing/TalkToAlzaLink'
import { contactSalesPath, PUBLIC_LOGIN_PATH } from '../lib/publicSite'

const SELF_SERVE_INCLUDED = [
  'Commission reconciliation',
  'Discrepancy tracking',
  'Producer commissions',
] as const

function getStartedHref(intent: PurchaseIntent, authenticatedBilling: boolean): string {
  return authenticatedBilling ? billingPathForPlan(intent.planKey) : signupPathForPlan(intent.planKey)
}

export function PricingPage() {
  const { status, profile } = useAuth()
  const navigate = useNavigate()
  const [interval, setInterval] = useState<BillingInterval>('monthly')

  const authenticated = status === 'authenticated'
  const canPickForBilling = authenticated && canManageBilling(rolesOf(profile))

  useEffect(() => {
    document.title = 'Pricing · ALZA Flow'
  }, [])

  const selfServeBands = useMemo(
    () => billingUserBands('alza_flow').filter((b) => b.checkoutEligible),
    [],
  )

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
    navigate(href)
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-alza-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-alza-teal-200/40 blur-3xl" />
      </div>
      <PublicMarketingHeader />

      <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <div className="mb-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">Pricing</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">ALZA FLOW</h1>
          <p className="mt-1 text-xs font-medium text-slate-500">by ALZA Business Solutions LLP</p>
          <p className="mx-auto mt-4 max-w-xl text-sm text-slate-600 sm:text-base">
            Commission operations for insurance agencies. Choose your user band, then create your account
            and subscribe.
          </p>
        </div>

        <div className="mb-10 flex justify-center">
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

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
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
                className="flex h-full min-h-[17.5rem] flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)]"
              >
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{band.label}</h2>
                <p className="mt-5 text-3xl font-bold tracking-tight text-slate-900">
                  {amount != null ? formatUsdWhole(amount) : '—'}
                </p>
                <p className="mt-1 text-sm text-slate-500">{interval === 'annual' ? 'per year' : 'per month'}</p>
                {interval === 'annual' && band.monthly != null ? (
                  <p className="mt-3 text-xs text-alza-teal-700">
                    2 months free · {formatUsdWhole(band.monthly * 10)} billed annually
                  </p>
                ) : (
                  <p className="mt-3 min-h-[1rem]" aria-hidden="true" />
                )}
                <ul className="mt-5 flex-1 space-y-2">
                  {SELF_SERVE_INCLUDED.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm leading-5 text-slate-700">
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-alza-teal-600"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={!quote.sku || !quote.checkoutEligible}
                  onClick={() => handleGetStarted(band.key)}
                  className="group mt-auto inline-flex h-11 w-full items-center justify-center rounded-xl gradient-alza text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {canPickForBilling ? 'Continue to billing' : 'Get Started'}
                  <ArrowRight className="mkt-cta-arrow ml-2 h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="mx-auto mt-6 grid w-full max-w-[44rem] gap-5 sm:grid-cols-2">
          <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)]">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">51+ users</h2>
            <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Custom Pricing</p>
            <Link
              to={contactSalesPath('pricing_contact')}
              className="mt-8 inline-flex h-11 w-full max-w-[12.5rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
            >
              Contact us
            </Link>
          </div>

          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/80 px-6 py-8 text-center">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">ALZA Flow Pay</h2>
            <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Coming Soon</p>
            <p className="mt-3 max-w-[16rem] text-sm text-slate-600">Integrated producer payments are on the waitlist.</p>
            <span className="mt-8 inline-flex h-11 w-full max-w-[12.5rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm font-medium text-slate-500">
              Waitlist only
            </span>
          </div>
        </div>

        <p className="mt-12 text-center text-sm text-slate-600">
          {authenticated ? (
            <>
              Already signed in.{' '}
              <Link to="/admin/subscription-billing" className="font-medium text-alza-blue-700 hover:underline">
                Open Subscription Billing
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link to={PUBLIC_LOGIN_PATH} className="font-medium text-alza-blue-700 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
