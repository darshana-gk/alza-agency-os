import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X, Zap } from 'lucide-react'
import { CommissionWorkspacePreview } from '../components/marketing/ProductPreview'
import {
  PUBLIC_DEMO_MAILTO,
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LOGIN_PATH,
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
    <div className="min-h-screen scroll-smooth bg-white text-slate-900">
      <a
        href="#main"
        className="absolute left-4 top-4 z-50 -translate-y-16 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow focus:translate-y-0"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
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

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 lg:flex" aria-label="Product">
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

          <div className="hidden items-center gap-5 lg:flex">
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
        <section id="hero" className="relative overflow-hidden px-4 pb-8 pt-20 sm:px-6 sm:pb-10 sm:pt-28">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-alza-blue-100/50 blur-3xl" />
            <div className="absolute right-0 top-24 h-72 w-72 rounded-full bg-alza-teal-100/50 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-4xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">
              Commission Operations for Insurance Agencies
            </p>
            <h1 className="mt-6 text-[2.35rem] font-bold leading-[1.12] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl lg:leading-[1.08]">
              Know what you earned.
              <br />
              Know what was paid.
              <br />
              Know what's missing.
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              ALZA Flow brings commission reconciliation, discrepancies, and producer commissions
              into one clear workflow for insurance agencies.
            </p>
            <p className="mt-6 text-lg font-semibold text-slate-900">
              Keep your AMS. Fix your commission operations.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl gradient-alza px-7 text-sm font-semibold text-white shadow-sm hover:opacity-90 sm:w-auto"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
              <a
                href="#product"
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-white px-7 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 sm:w-auto"
              >
                See ALZA Flow
              </a>
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 px-4 pb-24 pt-6 sm:px-6 sm:pb-28">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                See your commission operations clearly.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
                Expected commissions, received payments, discrepancies, and producer commissions —
                organized in one workflow.
              </p>
            </div>
            <div className="mt-12">
              <CommissionWorkspacePreview />
            </div>
          </div>
        </section>

        <section id="outcomes" className="scroll-mt-24 border-t border-slate-100 bg-slate-50 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Commission operations shouldn't be guesswork.
            </h2>
            <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-16">
              {[
                {
                  title: 'Reconcile with confidence.',
                  copy: 'Compare carrier and MGA statements against expected agency commissions.',
                },
                {
                  title: 'Find discrepancies sooner.',
                  copy: 'Surface missing, underpaid, and overpaid commissions that need attention.',
                },
                {
                  title: 'Keep producer commissions clear.',
                  copy: "Know what producers earned, what's ready, and what's been paid.",
                },
              ].map((item, index) => (
                <div key={item.title}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alza-blue-700">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-slate-600">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              From statement to clarity.
            </h2>
            <ol className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
              {[
                {
                  step: '01',
                  title: 'Import',
                  copy: 'Bring in carrier and MGA commission statements using supported import methods.',
                },
                {
                  step: '02',
                  title: 'Reconcile',
                  copy: 'ALZA Flow compares statement activity against agency commission transactions.',
                },
                {
                  step: '03',
                  title: 'Review',
                  copy: 'Investigate missing, underpaid, overpaid, or unmatched commissions.',
                },
                {
                  step: '04',
                  title: 'Operate',
                  copy: 'Manage producer commissions, payment status, and reporting from one workflow.',
                },
              ].map((item) => (
                <li key={item.step}>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alza-blue-700">
                    {item.step}
                  </p>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-slate-600">{item.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="positioning" className="scroll-mt-24 border-t border-slate-100 bg-slate-50 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">
              Built for insurance agencies
            </p>
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl sm:leading-tight">
              Your AMS manages policies.
              <br />
              ALZA Flow manages the commission work around them.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-slate-600 sm:text-lg">
              ALZA Flow gives agencies a dedicated place to reconcile carrier and MGA commissions,
              investigate discrepancies, manage producer commissions, and understand commission
              revenue.
            </p>
            <p className="mt-8 text-lg font-semibold text-slate-900">No AMS replacement required.</p>
          </div>
        </section>

        <section id="get-started" className="bg-slate-900 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl sm:leading-tight">
              Your commissions shouldn't require detective work.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
              Bring statements, reconciliation, discrepancies, and producer commissions into one
              clear workflow.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl gradient-alza px-7 text-sm font-semibold text-white hover:opacity-90 sm:w-auto"
              >
                Get Started
              </Link>
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/20 bg-white/5 px-7 text-sm font-semibold text-white hover:bg-white/10 sm:w-auto"
              >
                View Pricing
              </Link>
            </div>
            <p className="mt-6 text-sm text-slate-400">
              <a href={PUBLIC_DEMO_MAILTO} className="font-medium text-slate-200 hover:text-white">
                Talk to ALZA
              </a>
            </p>
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
