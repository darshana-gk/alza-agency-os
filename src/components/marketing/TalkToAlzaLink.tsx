import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PublicBrandLink } from './PublicBrandLink'
import { PUBLIC_CONTACT_SALES_PATH, PUBLIC_GET_STARTED_PATH, PUBLIC_LOGIN_PATH } from '../../lib/publicSite'

export function TalkToAlzaLink({
  className,
  children = 'Talk to ALZA',
  source = 'landing_contact',
}: {
  className?: string
  children?: ReactNode
  source?: 'landing_contact' | 'pricing_contact'
}) {
  return (
    <Link to={`${PUBLIC_CONTACT_SALES_PATH}?source=${source}`} className={className}>
      {children}
    </Link>
  )
}

export function PublicMarketingHeader({ cta = 'Get Started' }: { cta?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-[4.25rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <PublicBrandLink />
        <div className="flex items-center gap-5">
          <Link to={PUBLIC_LOGIN_PATH} className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:inline">
            Sign In
          </Link>
          <Link
            to={PUBLIC_GET_STARTED_PATH}
            className="inline-flex h-10 items-center rounded-lg gradient-alza px-4 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            {cta}
          </Link>
        </div>
      </div>
    </header>
  )
}
