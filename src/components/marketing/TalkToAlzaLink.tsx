import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { PublicBrandLink } from './PublicBrandLink'
import {
  contactSalesPath,
  PUBLIC_GET_STARTED_PATH,
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

export function PublicMarketingHeader({ cta = 'Get Started' }: { cta?: string }) {
  const navLink = 'text-sm font-medium text-slate-600 hover:text-brand-navy'
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-[4.75rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <PublicBrandLink />
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Public">
          <Link to={PUBLIC_PRICING_PATH} className={navLink}>
            Pricing
          </Link>
          <TalkToAlzaLink source="header_contact" className={navLink}>
            Contact us
          </TalkToAlzaLink>
        </nav>
        <div className="flex shrink-0 items-center gap-3 sm:gap-5">
          <TalkToAlzaLink source="header_contact" className={`${navLink} hidden sm:inline lg:hidden`}>
            Contact us
          </TalkToAlzaLink>
          <Link to={PUBLIC_LOGIN_PATH} className={`hidden sm:inline ${navLink}`}>
            Sign In
          </Link>
          <Link
            to={PUBLIC_GET_STARTED_PATH}
            className="mkt-btn mkt-btn-primary inline-flex h-10 shrink-0 items-center px-3 text-sm sm:px-5"
          >
            {cta}
            <ArrowRight className="mkt-cta-arrow ml-1.5 h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  )
}
