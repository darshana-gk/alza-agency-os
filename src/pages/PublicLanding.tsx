import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X, Zap } from 'lucide-react'
import {
  DashboardProductFrame,
  ExceptionsProductFrame,
  ProducerProductFrame,
  ReconciliationProductFrame,
} from '../components/marketing/ProductPreview'
import { TalkToAlzaLink } from '../components/marketing/TalkToAlzaLink'
import {
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LOGIN_PATH,
  applyPublicDocumentMeta,
} from '../lib/publicSite'

const NAV = [
  { href: '#product', label: 'Product', kind: 'hash' as const },
  { href: '#how-it-works', label: 'How It Works', kind: 'hash' as const },
  { href: PUBLIC_GET_STARTED_PATH, label: 'Pricing', kind: 'route' as const },
]

const OUTCOME_CHIPS = [
  { label: 'Matched', tone: 'ok' },
  { label: 'Needs Review', tone: 'warn' },
  { label: 'Missing', tone: 'warn' },
  { label: 'Underpaid', tone: 'warn' },
  { label: 'Overpaid', tone: 'warn' },
] as const

export function PublicLandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    applyPublicDocumentMeta()
    const id = window.location.hash.replace('#', '')
    if (!id) return
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
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
        <div className="mx-auto flex h-[4.25rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
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
            <Link to={PUBLIC_LOGIN_PATH} className="text-sm font-medium text-slate-600 hover:text-slate-900">
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
        <section id="hero" className="relative overflow-hidden px-4 pb-10 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-4 lg:pt-24">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-0 h-[32rem] w-[32rem] rounded-full bg-alza-blue-200/45 blur-3xl" />
            <div className="absolute right-0 top-10 h-[28rem] w-[28rem] rounded-full bg-alza-teal-200/40 blur-3xl" />
          </div>
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,26.5rem)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
            <div className="lg:pb-12">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">
                Commission Operations for Insurance Agencies
              </p>
              <h1 className="mt-5 text-[2.4rem] font-bold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.35rem] lg:leading-[1.05]">
                Take control of your
                <br />
                commission operations.
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-slate-600 sm:text-lg">
                Reconcile carrier and MGA statements, catch commission discrepancies, manage producer payouts,
                and see what your agency has earned — all in one place.
              </p>
              <p className="mt-5 text-lg font-semibold text-slate-900">Know what came in. Catch what didn't.</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={PUBLIC_GET_STARTED_PATH}
                  className="inline-flex h-12 items-center justify-center rounded-xl gradient-alza px-7 text-sm font-semibold text-white shadow-sm hover:opacity-90"
                >
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#product"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Explore ALZA Flow
                </a>
              </div>
            </div>
            <div className="lg:-mr-6 lg:translate-y-8 xl:-mr-10">
              <DashboardProductFrame size="hero" />
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 bg-slate-50 px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.6rem] lg:leading-tight">
                One place to understand your commission business.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
                From expected commissions to received payments, discrepancies, producer commissions, and
                reporting — ALZA Flow keeps the workflow connected.
              </p>
            </div>
            <div className="mx-auto mt-14 w-full max-w-6xl">
              <DashboardProductFrame />
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="scroll-mt-24 bg-gradient-to-b from-alza-blue-50 via-white to-white px-4 py-24 sm:px-6 lg:px-8 lg:py-28"
        >
          <div className="mx-auto max-w-7xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">Reconciliation</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.6rem] lg:leading-tight">
              Turn commission statements into answers.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Bring in carrier and MGA statements and compare them against what your agency expected.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              {OUTCOME_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  className={
                    chip.tone === 'ok'
                      ? 'rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15'
                      : 'rounded-full bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 ring-1 ring-inset ring-orange-600/15'
                  }
                >
                  {chip.label}
                </span>
              ))}
            </div>
            <div className="mt-14 w-full">
              <ReconciliationProductFrame />
            </div>
          </div>
        </section>

        <section id="exceptions" className="scroll-mt-24 bg-white px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
          <div className="relative mx-auto max-w-7xl lg:min-h-[38rem]">
            <div className="lg:ml-[32%] lg:w-[68%]">
              <ExceptionsProductFrame />
            </div>
            <div className="mt-10 rounded-3xl bg-white p-8 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 lg:absolute lg:left-0 lg:top-16 lg:mt-0 lg:w-[38%] lg:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">Exceptions</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-[2.15rem] sm:leading-tight">
                Spot the commissions that need attention.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                ALZA Flow surfaces missing, underpaid, overpaid, and unmatched activity so your team can focus
                on the exceptions instead of searching for them.
              </p>
            </div>
          </div>
        </section>

        <section id="producers" className="scroll-mt-24 bg-alza-teal-50/40 px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-teal-800">Producer commissions</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.6rem] lg:leading-tight">
                Producer commissions,
                <br />
                without the spreadsheet chase.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
                Track producer commissions, approval status, and payment activity in the same operational
                workflow.
              </p>
              <p className="mt-4 text-sm font-medium text-slate-700">
                From commission earned to payment status, keep the trail clear.
              </p>
            </div>
            <div className="mt-14 w-full">
              <ProducerProductFrame />
            </div>
          </div>
        </section>

        <section
          id="reporting"
          className="scroll-mt-24 bg-gradient-to-b from-alza-blue-950 via-alza-blue-900 to-slate-950 px-4 py-24 sm:px-6 lg:px-8 lg:py-32"
        >
          <div className="mx-auto max-w-7xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-teal-300">Dashboard</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[2.7rem] lg:leading-tight">
              See the business behind your commissions.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Understand agency commission revenue, producer commissions, discrepancies, and payment status from
              one operational view.
            </p>
            <div className="mt-14 w-full">
              <DashboardProductFrame />
            </div>
          </div>
        </section>

        <section id="positioning" className="scroll-mt-24 bg-white px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">
              Built for insurance agencies
            </p>
            <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.6rem] lg:leading-tight">
              Keep your AMS.
              <br />
              Give commissions their own workflow.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              ALZA Flow works alongside your existing systems, giving your team one place for reconciliation,
              discrepancies, producer commissions, and reporting.
            </p>
            <p className="mt-6 text-lg font-semibold text-slate-900">No AMS replacement required.</p>
            <div className="mt-14 flex flex-col items-stretch gap-5 lg:flex-row lg:items-center">
              <div className="flex-1 rounded-3xl bg-slate-50 p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Your existing systems
                </p>
                <ul className="mt-6 space-y-3 text-base text-slate-700">
                  <li>Policies</li>
                  <li>Clients</li>
                  <li>Documents</li>
                </ul>
              </div>
              <p className="hidden text-2xl font-semibold text-slate-300 lg:block" aria-hidden="true">
                →
              </p>
              <p className="text-center text-sm font-semibold uppercase tracking-[0.16em] text-slate-400 lg:hidden">
                to
              </p>
              <div className="flex-1 rounded-3xl gradient-alza p-8 text-white shadow-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/80">ALZA Flow</p>
                <ul className="mt-6 space-y-3 text-base">
                  <li>Reconciliation</li>
                  <li>Discrepancies</li>
                  <li>Producer commissions</li>
                  <li>Reporting</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="get-started" className="bg-slate-900 px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl sm:leading-tight">
              Ready to make commission operations easier?
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
              Bring reconciliation, discrepancies, producer commissions, and reporting into one operational
              workflow.
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
              <TalkToAlzaLink className="font-medium text-slate-200 hover:text-white" />
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
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
            <TalkToAlzaLink className="hover:text-slate-900">Contact ALZA</TalkToAlzaLink>
          </nav>
        </div>
      </footer>
    </div>
  )
}
