import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { PublicBrandLink } from './PublicBrandLink'
import {
  contactSalesPath,
  PUBLIC_GET_STARTED_PATH,
  PUBLIC_LANDING_PATH,
  PUBLIC_LOGIN_PATH,
  PUBLIC_PRICING_PATH,
} from '../../lib/publicSite'

export function TalkToAlzaLink({
  className,
  children = 'Talk to ALZA',
  source = 'landing_contact',
}: {
  className?: string
  children?: ReactNode
  source?: 'landing_contact' | 'pricing_contact' | 'header_contact'
}) {
  return (
    <Link to={contactSalesPath(source)} className={className}>
      {children}
    </Link>
  )
}

const PUBLIC_NAV = [
  { href: `${PUBLIC_LANDING_PATH}#product`, label: 'Product', kind: 'hash' as const },
  { href: `${PUBLIC_LANDING_PATH}#how-it-works`, label: 'How It Works', kind: 'hash' as const },
  { href: PUBLIC_PRICING_PATH, label: 'Pricing', kind: 'route' as const },
  { href: contactSalesPath('header_contact'), label: 'Contact us', kind: 'route' as const },
]

export function PublicMarketingHeader({ cta = 'Get Started' }: { cta?: string }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-[4.75rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <PublicBrandLink />

        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 lg:flex" aria-label="Product">
          {PUBLIC_NAV.map((item) =>
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
            {cta}
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
            {PUBLIC_NAV.map((item) =>
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
              {cta}
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  )
}

export function PublicMarketingFooter() {
  return (
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
  )
}
