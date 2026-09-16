import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X, Zap } from 'lucide-react'
import { CommissionWorkspacePreview } from '../components/marketing/ProductPreview'
import {
  PUBLIC_DEMO_MAILTO,
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LOGIN_PATH,
  PUBLIC_PRICING_INQUIRY_MAILTO,
  applyPublicDocumentMeta,
} from '../lib/publicSite'

const NAV = [
  { href: '#product', label: 'Product', kind: 'hash' as const },
  { href: '#how-it-works', label: 'How It Works', kind: 'hash' as const },
  { href: PUBLIC_GET_STARTED_PATH, label: 'Pricing', kind: 'route' as const },
]

export function PublicLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    applyPublicDocumentMeta()
  }, [])

  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
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
            {NAV.map((item) =>
              item.kind === 'route' ? (
                <Link key={item.href} to={item.href} className="hover:text-slate-900">
                  {item.label}
                </Link>
              ) : (
                <a key={item.href} href={item.href} className="hover:text-slate-900">
                  {item.label}
                </a>
              ),
            )}
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
              {NAV.map((item) =>
                item.kind === 'route' ? (
                  <Link key={item.href} to={item.href} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </Link>
                ) : (
                  <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </a>
                ),
              )}
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
              ALZA Flow brings your commission operations into one place — from carrier and MGA
              statements to reconciliation, discrepancies, and producer commissions.
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
                href="#how-it-works"
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:w-auto"
              >
                See How It Works
              </a>
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-20 border-t border-slate-200 bg-white px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Your commission operation. One clear view.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
              See what was expected, what was received, what needs attention, and what your producers
              are owed.
            </p>
            <div className="mt-10">
              <CommissionWorkspacePreview />
            </div>

            <h2 className="mt-20 text-3xl font-bold tracking-tight text-slate-900">
              Commission operations without the spreadsheet chase.
            </h2>
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {[
                {
                  title: 'Reconcile faster.',
                  copy: 'Match carrier and MGA commission statements against what your agency expected.',
                },
                {
                  title: "Catch what doesn't add up.",
                  copy: 'Surface missing, underpaid, and overpaid commissions for review.',
                },
                {
                  title: 'Know what producers are owed.',
                  copy: 'Track producer commissions and payment status without another spreadsheet.',
                },
              ].map((item) => (
                <div key={item.title}>
                  <h3 className="text-xl font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-t border-slate-200 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">From statement to clarity.</h2>
            <p className="mt-4 max-w-2xl text-base text-slate-600">
              Built for commission operations. Designed to work alongside your AMS.
            </p>
            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: '01',
                  title: 'Import',
                  copy: 'Bring in carrier and MGA commission statements.',
                },
                {
                  step: '02',
                  title: 'Reconcile',
                  copy: 'Compare statement activity against agency commission transactions.',
                },
                {
                  step: '03',
                  title: 'Review',
                  copy: 'Investigate missing or incorrect commissions.',
                },
                {
                  step: '04',
                  title: 'Operate',
                  copy: 'Manage producer commissions and payment status from one workflow.',
                },
              ].map((item) => (
                <li key={item.step}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alza-blue-700">
                    {item.step}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Plans that grow with your agency.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Simple monthly or annual plans, with self-service signup for teams up to 50 users.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:w-auto"
              >
                View Pricing
              </Link>
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl gradient-alza px-6 text-sm font-semibold text-white shadow-sm hover:opacity-90 sm:w-auto"
              >
                Get Started
              </Link>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              Larger agency?{' '}
              <a href={PUBLIC_PRICING_INQUIRY_MAILTO} className="font-medium text-alza-blue-700 hover:underline">
                Talk to ALZA
              </a>{' '}
              for a tailored plan.
            </p>
          </div>
        </section>

        <section id="get-started" className="border-t border-slate-200 bg-slate-900 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Ready to put your commission operations in order?
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-300">
              See what you've earned, what you've received, and what still needs attention.
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
                Talk to ALZA
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
