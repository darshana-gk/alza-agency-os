import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Menu, X, Zap } from 'lucide-react'
import { ProductPreview } from '../components/marketing/ProductPreview'
import {
  BILLING_INTERVALS,
  billingUserBands,
  formatUsdWhole,
  quoteBillingSelection,
  type BillingInterval,
  type BillingUserBandKey,
} from '../lib/billingCatalog'
import { signupPathForPlan, type PurchaseIntent } from '../lib/purchaseIntent'
import {
  PUBLIC_DEMO_MAILTO,
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LOGIN_PATH,
  PUBLIC_PRICING_INQUIRY_MAILTO,
  applyPublicDocumentMeta,
} from '../lib/publicSite'

const NAV = [
  { href: '#in-action', label: 'Product' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#solves', label: 'Learn' },
] as const

export function PublicLandingPage() {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [interval, setInterval] = useState<BillingInterval>('monthly')

  useEffect(() => {
    applyPublicDocumentMeta()
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
    const intent: PurchaseIntent = {
      product: 'alza_flow',
      userBand: bandKey,
      interval,
      planKey: quote.sku,
    }
    navigate(signupPathForPlan(intent.planKey))
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="absolute left-4 top-4 z-50 -translate-y-16 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow focus:translate-y-0"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#hero" className="flex items-center gap-2.5" aria-label="ALZA Flow home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl gradient-alza shadow-sm">
              <Zap className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-wide text-slate-900">ALZA FLOW</span>
              <span className="block text-[10px] font-medium text-slate-500">
                by ALZA Business Solutions LLP
              </span>
            </span>
          </a>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex" aria-label="Product">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-slate-900">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Link
              to={PUBLIC_LOGIN_PATH}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Sign In
            </Link>
            <Link
              to={PUBLIC_GET_STARTED_PATH}
              className="inline-flex h-10 items-center rounded-lg gradient-alza px-4 text-sm font-medium text-white shadow-sm hover:opacity-90"
            >
              Get Started
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>

        {menuOpen ? (
          <div id="mobile-nav" className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden">
            <nav className="flex flex-col gap-3 text-sm font-medium text-slate-700" aria-label="Mobile">
              {NAV.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                  {item.label}
                </a>
              ))}
              <Link to={PUBLIC_LOGIN_PATH} onClick={() => setMenuOpen(false)}>
                Sign In
              </Link>
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-10 items-center justify-center rounded-lg gradient-alza text-white"
                onClick={() => setMenuOpen(false)}
              >
                Get Started
              </Link>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="main">
        <section id="hero" className="relative overflow-hidden px-4 py-20 sm:px-6 sm:py-28">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-alza-blue-200/50 blur-3xl" />
            <div className="absolute -right-16 top-24 h-80 w-80 rounded-full bg-alza-teal-200/40 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-alza-blue-700">ALZA Flow</p>
            <p className="mt-2 text-sm text-slate-500">by ALZA Business Solutions LLP</p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-tight">
              Know what your agency earned.
              <br />
              Know what was paid.
              <br />
              Know what's missing.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              ALZA Flow helps insurance agencies manage commission operations, reconcile carrier and
              MGA payments, identify discrepancies, manage producer commissions, and understand
              commission revenue — without replacing your AMS.
            </p>
            <p className="mt-5 text-lg font-semibold text-slate-900">
              Keep your AMS. Fix your commission operations.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl gradient-alza px-6 text-sm font-semibold text-white shadow-sm hover:opacity-90 sm:w-auto"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
              <a
                href={PUBLIC_DEMO_MAILTO}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:w-auto"
              >
                Book a Demo
              </a>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Commission operations &amp; reconciliation software for U.S. insurance agencies.
            </p>
          </div>
        </section>

        <section id="in-action" className="border-t border-slate-200 bg-white px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">See ALZA Flow in action</h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              Follow commission operations from statement import through reconciliation, exception
              review, producer commissions, and reporting — in one workflow.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <ProductPreview
                title="Commission reconciliation"
                description="Import carrier and MGA statements and compare them against agency commission activity."
              />
              <ProductPreview
                title="Exception review"
                description="See matched items alongside missing, underpaid, and overpaid commissions that need attention."
              />
              <ProductPreview
                title="Producer commissions"
                description="Give owners a clear view of producer commission amounts and payment status."
              />
              <ProductPreview
                title="Reporting and dashboard"
                description="Understand commission revenue without leaving the same operational workflow."
              />
            </div>
          </div>
        </section>

        <section id="solves" className="border-t border-slate-200 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Commission operations shouldn't live in spreadsheets.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              ALZA Flow is the operational layer that organizes commission work so agencies can see
              what was earned, what was received, and what still needs attention.
            </p>
            <ul className="mt-10 space-y-5">
              {[
                'Carrier and MGA statements take time to reconcile manually.',
                'Missing commissions can be difficult to identify.',
                'Underpayments and overpayments require investigation.',
                'Producer commission calculations and payment status need visibility.',
                'Agency owners need a clear view of commission revenue.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-slate-700">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-alza-teal-600"
                    aria-hidden="true"
                  />
                  <span className="text-base leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how-it-works" className="border-t border-slate-200 bg-white px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">From statement to clarity.</h2>
            <p className="mt-4 max-w-2xl text-base text-slate-600">
              ALZA Flow V1 is commission operations only — not whole-premium accounting, and not an AMS
              replacement.
            </p>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: '1',
                  title: 'Import',
                  copy: 'Import carrier/MGA commission statements using supported file/import methods.',
                },
                {
                  step: '2',
                  title: 'Reconcile',
                  copy: 'ALZA Flow compares statement activity against agency commission transactions.',
                },
                {
                  step: '3',
                  title: 'Review',
                  copy: 'Surface matched items and exceptions including missing, underpaid and overpaid commissions.',
                },
                {
                  step: '4',
                  title: 'Operate',
                  copy: 'Manage producer commissions, payment status and reporting from one workflow.',
                },
              ].map((item) => (
                <li key={item.step}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alza-blue-700">
                    Step {item.step}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="pricing" className="border-t border-slate-200 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Pricing that grows with your agency.
            </h2>
            <p className="mt-4 max-w-2xl text-base text-slate-600">
              Self-service is available for 1–50 users. Annual pricing is approximately two months free
              versus monthly. Larger agencies work with ALZA directly.
            </p>

            <div className="mt-8 flex justify-start">
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

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      {band.label}
                    </h3>
                    <p className="mt-3 text-3xl font-bold text-slate-900">
                      {amount != null ? formatUsdWhole(amount) : '—'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {interval === 'annual' ? 'per year' : 'per month'}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">Self-service checkout</p>
                    <button
                      type="button"
                      disabled={!quote.sku || !quote.checkoutEligible}
                      onClick={() => handleGetStarted(band.key)}
                      className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg gradient-alza text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Get Started
                    </button>
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
                const salesNote =
                  band.key === 'users_51_100' ? 'Sales-assisted only.' : 'Contact ALZA.'
                return (
                  <div
                    key={band.key}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      {band.key === 'users_100_plus' ? '100+ users / complex agencies' : band.label}
                    </h3>
                    <p className="mt-3 text-xl font-bold text-slate-900">{guidance}</p>
                    <p className="mt-2 text-sm text-slate-600">
                      Online checkout is not available. {salesNote}
                    </p>
                    <a
                      href={PUBLIC_PRICING_INQUIRY_MAILTO}
                      className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-800 hover:bg-slate-100"
                    >
                      Contact ALZA
                    </a>
                  </div>
                )
              })}

              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  ALZA Flow Pay
                </h3>
                <p className="mt-3 text-xl font-bold text-slate-900">Coming Soon</p>
                <p className="mt-2 text-sm text-slate-600">
                  Not available for purchase. Checkout is not enabled.
                </p>
                <span className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-medium text-slate-500">
                  Coming Soon
                </span>
              </div>
            </div>
          </div>
        </section>

        <section id="get-started" className="border-t border-slate-200 bg-slate-900 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Take control of your commission operations.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-300">
              Know what was earned, what was received, what needs attention, and what your producers
              are owed.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl gradient-alza px-6 text-sm font-semibold text-white hover:opacity-90 sm:w-auto"
              >
                Get Started
              </Link>
              <a
                href={PUBLIC_DEMO_MAILTO}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white hover:bg-white/10 sm:w-auto"
              >
                Book a Demo / Talk to ALZA
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold tracking-wide text-slate-900">ALZA FLOW</p>
            <p className="mt-1 text-xs text-slate-500">by ALZA Business Solutions LLP</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600" aria-label="Footer">
            <Link to={PUBLIC_GET_STARTED_PATH} className="hover:text-slate-900">
              Pricing
            </Link>
            <Link to={PUBLIC_LOGIN_PATH} className="hover:text-slate-900">
              Sign In
            </Link>
            <a href={PUBLIC_DEMO_MAILTO} className="hover:text-slate-900">
              Contact ALZA
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
