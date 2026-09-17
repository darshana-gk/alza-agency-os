import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
  const navLink = 'text-sm font-medium text-slate-600 hover:text-slate-900'
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-[4.25rem] max-w-7xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <PublicBrandLink />
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Public">
          <Link to={PUBLIC_PRICING_PATH} className={navLink}>
            Pricing
          </Link>
          <TalkToAlzaLink source="header_contact" className={navLink}>
            Contact us
          </TalkToAlzaLink>
        </nav>
        <div className="flex items-center gap-3 sm:gap-5">
          <TalkToAlzaLink source="header_contact" className={`${navLink} lg:hidden`}>
            Contact us
          </TalkToAlzaLink>
          <Link to={PUBLIC_LOGIN_PATH} className={`hidden sm:inline ${navLink}`}>
            Sign In
          </Link>
          <Link
            to={PUBLIC_GET_STARTED_PATH}
            className="inline-flex h-10 items-center rounded-lg gradient-alza px-3 text-sm font-medium text-white shadow-sm hover:opacity-90 sm:px-4"
          >
            {cta}
          </Link>
        </div>
      </div>
    </header>
  )
}
