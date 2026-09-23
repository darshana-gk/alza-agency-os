import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import { BackToTopButton } from '../components/marketing/BackToTopButton'
import { AmsRelationship } from '../components/marketing/AmsRelationship'
import { CommissionStory } from '../components/marketing/CommissionStory'
import { ExceptionStory } from '../components/marketing/ExceptionStory'
import { FlowJourney } from '../components/marketing/FlowJourney'
import { ProducerCommissionStory } from '../components/marketing/ProducerCommissionStory'
import { ReportingStory } from '../components/marketing/ReportingStory'
import { PublicBrandLink } from '../components/marketing/PublicBrandLink'
import {
  MarketingOrbs,
  OpsTicker,
  Reveal,
  usePrefersReducedMotion,
} from '../components/marketing/LandingMotion'
import { DashboardProductFrame, ReconciliationProductFrame } from '../components/marketing/ProductPreview'
import { TalkToAlzaLink } from '../components/marketing/TalkToAlzaLink'
import {
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LOGIN_PATH,
  applyPublicDocumentMeta,
  contactSalesPath,
} from '../lib/publicSite'

const NAV = [
  { href: '#product', label: 'Product', kind: 'hash' as const },
  { href: '#how-it-works', label: 'How It Works', kind: 'hash' as const },
  { href: PUBLIC_GET_STARTED_PATH, label: 'Pricing', kind: 'route' as const },
  { href: contactSalesPath('header_contact'), label: 'Contact us', kind: 'route' as const },
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
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    applyPublicDocumentMeta()
    const id = window.location.hash.replace('#', '')
    if (!id) return
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
  }, [])

  return (
    <div className={`min-h-screen overflow-x-clip bg-white text-brand-navy ${reducedMotion ? '' : 'scroll-smooth'}`}>
      <a
        href="#main"
        className="absolute left-4 top-4 z-50 -translate-y-16 rounded-lg bg-white px-3 py-2 text-sm font-medium text-brand-navy shadow focus:translate-y-0"
      >
        Skip to content
      </a>
      <BackToTopButton />

      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[4.75rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <PublicBrandLink />

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 lg:flex" aria-label="Product">
            {NAV.map((item) =>
              item.kind === 'route' ? (
                <Link key={item.href} to={item.href} className="hover:text-brand-navy">
                  {item.label}
                </Link>
              ) : (
                <a key={item.href} href={item.href} className="hover:text-brand-navy">
                  {item.label}
                </a>
              ),
            )}
          </nav>

          <div className="hidden items-center gap-5 lg:flex">
            <Link to={PUBLIC_LOGIN_PATH} className="text-sm font-medium text-slate-600 hover:text-brand-navy">
              Sign In
            </Link>
            <Link
              to={PUBLIC_GET_STARTED_PATH}
              className="inline-flex h-10 items-center rounded-lg bg-brand-teal px-4 text-sm font-medium text-brand-navy shadow-sm hover:opacity-90"
            >
              Get Started
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-brand-navy lg:hidden"
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
            <nav className="flex flex-col gap-3 text-sm font-medium text-brand-navy" aria-label="Mobile">
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
                className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-teal text-sm font-medium text-brand-navy"
                onClick={() => setMenuOpen(false)}
              >
                Get Started
              </Link>
            </nav>
          </div>
        ) : null}
      </header>

      <main id="main">
        <section id="hero" className="relative overflow-hidden px-4 pb-8 pt-14 sm:px-6 sm:pt-16 lg:px-8 lg:pb-2 lg:pt-20">
          <MarketingOrbs />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,26.5rem)_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
            <div className="lg:pb-12">
              <p className="mkt-enter-1 text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">
                Commission Operations for Insurance Agencies
              </p>
              <h1 className="mkt-enter-2 mt-5 text-[2.4rem] font-bold leading-[1.08] tracking-tight text-brand-navy sm:text-5xl lg:text-[3.35rem] lg:leading-[1.05]">
                Take control of your
                <br />
                commission operations.
              </h1>
              <p className="mkt-enter-3 mt-6 max-w-md text-base leading-relaxed text-slate-600 sm:text-lg">
                Reconcile carrier and MGA statements, catch commission discrepancies, track producer
                commissions, and see what your agency has earned — all in one place.
              </p>
              <p className="mkt-truth">
                <span>Know what you've earned.</span>
                <span>Know what you've received.</span>
                <span>Know what's missing.</span>
              </p>
              <div className="mkt-enter-5 mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={PUBLIC_GET_STARTED_PATH}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-teal px-7 text-sm font-semibold text-brand-navy shadow-sm hover:opacity-90"
                >
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-sm font-semibold text-brand-navy ring-1 ring-slate-200 hover:bg-brand-neutral"
                >
                  See How It Works
                </a>
              </div>
            </div>
            <div className="relative lg:-mr-6 lg:translate-y-8 xl:-mr-10">
              <div
                className="pointer-events-none absolute -inset-8 rounded-[2rem] bg-gradient-to-br from-brand-sky to-brand-teal/20 blur-2xl"
                aria-hidden="true"
              />
              <div className="relative mkt-enter-5">
                <div className="mkt-float-ui">
                  <DashboardProductFrame size="hero" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <OpsTicker />

        <CommissionStory />

        <section id="product" className="scroll-mt-24 bg-gradient-to-b from-brand-neutral from-70% to-white px-4 py-16 sm:px-6 lg:px-8 lg:pb-16 lg:pt-[4.5rem]">
          <div className="mx-auto max-w-7xl">
            <Reveal className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl lg:text-[2.6rem] lg:leading-tight">
                One place to understand your commission business.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
                From expected commissions to received payments, discrepancies, producer commissions, and
                reporting — ALZA Flow keeps the workflow connected.
              </p>
            </Reveal>
            <Reveal delayMs={80} className="mx-auto mt-8 w-full max-w-6xl">
              <div className="mkt-hover-lift">
                <DashboardProductFrame />
              </div>
            </Reveal>
          </div>
        </section>

        <FlowJourney />

        <section
          id="reconciliation"
          className="scroll-mt-24 bg-gradient-to-b from-brand-sky via-white to-white px-4 pb-8 pt-14 sm:px-6 lg:px-8 lg:pb-5 lg:pt-16"
        >
          <div className="mx-auto max-w-7xl">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">Reconciliation</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl lg:text-[2.6rem] lg:leading-tight">
                Turn commission statements into answers.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
                Bring in carrier and MGA statements and compare them against what your agency expected.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                {OUTCOME_CHIPS.map((chip) => (
                  <span
                    key={chip.label}
                    className={
                      chip.tone === 'ok'
                        ? 'inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15'
                        : 'inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 ring-1 ring-inset ring-orange-600/15'
                    }
                  >
                    <span className="mkt-status-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                    {chip.label}
                  </span>
                ))}
              </div>
            </Reveal>
            <Reveal delayMs={80} className="mt-7 w-full">
              <div className="mkt-hover-lift">
                <ReconciliationProductFrame />
              </div>
            </Reveal>
          </div>
        </section>

        <ExceptionStory />

        <ProducerCommissionStory />

        <ReportingStory />

        <AmsRelationship />

        <section id="get-started" className="bg-brand-navy px-4 py-14 sm:px-6 lg:px-8 lg:py-[4.5rem]">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl sm:leading-tight">
              Ready to make your commission operations easier?
            </h2>
            <div className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to={PUBLIC_GET_STARTED_PATH}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-teal px-7 text-sm font-semibold text-brand-navy hover:opacity-90 sm:w-auto"
              >
                Get Started
              </Link>
              <TalkToAlzaLink className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/20 bg-white/5 px-7 text-sm font-semibold text-white hover:bg-white/10 sm:w-auto">
                Talk to Us
              </TalkToAlzaLink>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-9 sm:px-6 lg:px-8">
        <div className="mkt-ft">
          <div className="mkt-ft-brand">
            <PublicBrandLink variant="footer" />
            <div className="mkt-ft-tag">
              <p className="mkt-ft-kicker">
                OPERATIONS <span className="mkt-ft-dot">•</span> TALENT <span className="mkt-ft-dot">•</span>{' '}
                TECHNOLOGY <span className="mkt-ft-dot">•</span>
              </p>
              <p className="mkt-ft-line">A More Efficient. More Connected Tomorrow.</p>
            </div>
          </div>
          <nav className="mkt-ft-nav" aria-label="Footer">
            <Link to={PUBLIC_GET_STARTED_PATH} className="hover:text-brand-navy">
              Pricing
            </Link>
            <Link to={PUBLIC_LOGIN_PATH} className="hover:text-brand-navy">
              Sign In
            </Link>
            <TalkToAlzaLink className="hover:text-brand-navy">Contact ALZA</TalkToAlzaLink>
          </nav>
        </div>
      </footer>
    </div>
  )
}
