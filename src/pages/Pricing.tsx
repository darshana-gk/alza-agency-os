import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
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
import { PublicMarketingFooter, PublicMarketingHeader } from '../components/marketing/TalkToAlzaLink'
import { contactSalesPath, PUBLIC_LOGIN_PATH } from '../lib/publicSite'

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
    <div className="mkt-conv min-h-screen overflow-x-hidden bg-white text-brand-navy">
      <PublicMarketingHeader />

      <main className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[22rem] bg-gradient-to-b from-brand-sky/70 to-white" />

        <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="mx-auto mb-9 max-w-2xl text-center">
            <p className="mkt-eyebrow">Pricing</p>
            <h1 className="mkt-display mt-4 text-[2.15rem] sm:text-4xl lg:text-[2.75rem]">
              Priced by the size of your team.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Commission operations for insurance agencies. Choose your user band, then create your account
              and subscribe.
            </p>
          </div>

          <div className="mb-8 flex justify-center">
            <div className="mkt-price-toggle" role="group" aria-label="Billing interval">
              {BILLING_INTERVALS.map((opt) => {
                const active = interval === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setInterval(opt.key)}
                    className={active ? 'is-on' : ''}
                  >
                    {opt.label}
                    {opt.key === 'annual' ? (
                      <span className={active ? 'mkt-price-save is-on' : 'mkt-price-save'}>
                        · 2 months free
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mkt-price-family">
            {selfServeBands.map((band) => {
              const quote = quoteBillingSelection({
                product: 'alza_flow',
                userBand: band.key,
                interval,
              })
              const amount = interval === 'annual' ? band.annual : band.monthly
              return (
                <div key={band.key} className="mkt-price-card">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {band.label}
                  </h2>
                  <p className="mkt-price-amount mt-5">
                    {amount != null ? formatUsdWhole(amount) : '—'}
                  </p>
                  <p className="mt-1.5 text-sm text-slate-500">
                    {interval === 'annual' ? 'per year' : 'per month'}
                  </p>
                  <button
                    type="button"
                    disabled={!quote.sku || !quote.checkoutEligible}
                    onClick={() => handleGetStarted(band.key)}
                    className="group mt-auto inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-navy shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canPickForBilling ? 'Continue to billing' : 'Get Started'}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="mx-auto mt-6 grid w-full max-w-[44rem] gap-5 sm:grid-cols-2">
            <div className="mkt-price-aside flex flex-col items-center justify-center px-6 py-8 text-center">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">51+ users</h2>
              <p className="mt-4 text-[1.65rem] font-bold tracking-tight text-brand-navy">Custom Pricing</p>
              <Link
                to={contactSalesPath('pricing_contact')}
                className="mt-6 inline-flex h-11 w-full max-w-[12.5rem] items-center justify-center rounded-xl bg-white text-sm font-semibold text-brand-navy ring-1 ring-slate-200 hover:bg-brand-neutral"
              >
                Contact us
              </Link>
            </div>

            <div className="mkt-price-aside mkt-price-aside--soon flex flex-col items-center justify-center px-6 py-8 text-center">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">ALZA Flow Pay</h2>
              <p className="mt-4 text-[1.65rem] font-bold tracking-tight text-brand-navy">Coming Soon</p>
              <p className="mt-3 px-2 text-sm leading-relaxed text-slate-600">
                Integrated producer payments are on the waitlist.
              </p>
              <span className="mt-6 inline-flex h-11 w-full max-w-[12.5rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm font-medium text-slate-500">
                Waitlist only
              </span>
            </div>
          </div>

          <p className="mt-12 text-center text-sm text-slate-600">
            {authenticated ? (
              <>
                Already signed in.{' '}
                <Link to="/admin/subscription-billing" className="font-medium text-brand-navy hover:underline">
                  Open Subscription Billing
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link to={PUBLIC_LOGIN_PATH} className="font-medium text-brand-navy hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </main>

      <PublicMarketingFooter />
    </div>
  )
}
