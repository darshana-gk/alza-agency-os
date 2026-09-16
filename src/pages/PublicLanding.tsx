import { useEffect, useState, type ReactNode } from 'react'
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

function ProductStory({
  id,
  reverse,
  eyebrow,
  title,
  copy,
  visual,
}: {
  id: string
  reverse?: boolean
  eyebrow: string
  title: string
  copy: string
  visual: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 px-4 py-14 sm:px-6 sm:py-16">
      <div
        className={`mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-2 lg:gap-12 ${
          reverse ? 'lg:[&>div:first-child]:order-2' : ''
        }`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-alza-blue-700">{eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-[2.15rem] sm:leading-tight">
            {title}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">{copy}</p>
        </div>
        <div>{visual}</div>
      </div>
    </section>
  )
}

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
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
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
        <section id="hero" className="relative overflow-hidden px-4 pb-6 pt-14 sm:px-6 sm:pt-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-[12%] top-0 h-[28rem] w-[28rem] rounded-full bg-alza-blue-200/50 blur-3xl" />
            <div className="absolute right-[8%] top-10 h-[24rem] w-[24rem] rounded-full bg-alza-teal-200/40 blur-3xl" />
          </div>
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">
                Commission Operations for Insurance Agencies
              </p>
              <h1 className="mt-4 text-[2.2rem] font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.15rem] lg:leading-[1.05]">
                Know what you earned.
                <br />
                Know what was paid.
                <br />
                Know what's missing.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                ALZA Flow brings commission reconciliation, discrepancies, and producer commissions into one
                clear workflow for insurance agencies.
              </p>
              <p className="mt-5 text-lg font-semibold text-slate-900">
                Keep your AMS. Fix your commission operations.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
                  See ALZA Flow
                </a>
              </div>
            </div>
            <div className="lg:translate-y-6 lg:scale-[1.02]">
              <DashboardProductFrame />
            </div>
          </div>
        </section>

        <div className="bg-white">
          <div id="how-it-works" className="scroll-mt-24" />
          <ProductStory
            id="product"
            eyebrow="Reconciliation"
            title="Stop hunting through commission statements."
            copy="Bring carrier and MGA commission statements into ALZA Flow and reconcile them against what your agency expected."
            visual={<ReconciliationProductFrame />}
          />
        </div>

        <div className="bg-slate-50">
          <ProductStory
            id="exceptions"
            reverse
            eyebrow="Needs Review"
            title="See what doesn't add up."
            copy="Missing, underpaid, overpaid, and unmatched commissions surface for review so your team knows exactly where attention is needed."
            visual={<ExceptionsProductFrame />}
          />
        </div>

        <div className="bg-white">
          <ProductStory
            id="producers"
            eyebrow="Producer commissions"
            title="Know what your producers are owed."
            copy="Keep producer commissions, approval status, and payment activity connected to the business that generated them."
            visual={<ProducerProductFrame />}
          />
        </div>

        <section id="reporting" className="scroll-mt-24 bg-gradient-to-b from-alza-blue-950 to-slate-950 px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-alza-teal-300">Dashboard & reporting</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl sm:leading-tight">
              See the commission picture clearly.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300">
              Give agency owners visibility into commission revenue, producer commissions, discrepancies, and
              payment status from one operational workspace.
            </p>
            <div className="mt-10">
              <DashboardProductFrame wide />
            </div>
          </div>
        </section>

        <section id="positioning" className="scroll-mt-24 bg-white px-4 py-16 sm:px-6">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">
                Built for insurance agencies
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl sm:leading-tight">
                Your AMS manages policies.
                <br />
                ALZA Flow manages the commission work around them.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-600">
                Keep the systems you already use. ALZA Flow gives your team a dedicated workflow for commission
                reconciliation, discrepancies, producer commissions, and reporting.
              </p>
              <p className="mt-6 text-lg font-semibold text-slate-900">No AMS replacement required.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Your AMS</p>
                <ul className="mt-4 space-y-2 text-sm text-slate-700">
                  <li>Policies</li>
                  <li>Clients</li>
                  <li>Documents</li>
                </ul>
              </div>
              <div className="rounded-2xl gradient-alza p-5 text-white shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/80">ALZA Flow</p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li>Reconciliation</li>
                  <li>Discrepancies</li>
                  <li>Producer commissions</li>
                  <li>Reporting</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="get-started" className="bg-slate-900 px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl sm:leading-tight">
              Your commissions shouldn't require detective work.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
              Bring statements, reconciliation, discrepancies, and producer commissions into one clear workflow.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
            <TalkToAlzaLink className="hover:text-slate-900">Contact ALZA</TalkToAlzaLink>
          </nav>
        </div>
      </footer>
    </div>
  )
}
