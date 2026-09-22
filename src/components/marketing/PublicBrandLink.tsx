import { Link, useLocation } from 'react-router-dom'
import { Zap } from 'lucide-react'
import type { MouseEvent } from 'react'
import { usePrefersReducedMotion } from './LandingMotion'
import { PUBLIC_LANDING_PATH } from '../../lib/publicSite'
import wordmark from '../../assets/brand/alza-wordmark.png'

export function PublicBrandLink({
  className = '',
  variant = 'header',
}: {
  className?: string
  variant?: 'header' | 'stacked' | 'text' | 'footer'
}) {
  const location = useLocation()
  const reduced = usePrefersReducedMotion()
  const onLanding = location.pathname === PUBLIC_LANDING_PATH

  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (!onLanding) return
    event.preventDefault()
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  const lockup =
    variant === 'stacked' ? (
      <>
        <span className="flex h-12 w-12 items-center justify-center rounded-xl gradient-alza shadow-md">
          <Zap className="h-6 w-6 text-white" aria-hidden="true" />
        </span>
        <span className="mt-4 text-center leading-tight">
          <span className="block text-2xl font-bold tracking-wide text-slate-900">ALZA FLOW</span>
          <span className="mt-1 block text-xs font-medium text-slate-500">
            by ALZA Business Solutions LLP
          </span>
        </span>
      </>
    ) : variant === 'text' ? (
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide text-brand-navy">ALZA FLOW</span>
        <span className="mt-1 block text-xs text-slate-500">by ALZA Business Solutions LLP</span>
      </span>
    ) : variant === 'footer' ? (
      <span className="flex flex-col items-start gap-3">
        <img
          src={wordmark}
          alt=""
          width={430}
          height={127}
          className="mkt-wordmark mkt-wordmark--footer"
        />
        <span className="leading-tight">
          <span className="block text-sm font-bold tracking-wide text-brand-navy">ALZA FLOW</span>
          <span className="mt-1 block text-xs font-medium text-slate-500">
            by ALZA Business Solutions LLP
          </span>
        </span>
      </span>
    ) : (
      <>
        <img
          src={wordmark}
          alt=""
          width={430}
          height={127}
          className="mkt-wordmark mkt-wordmark--header"
        />
        <span className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden="true" />
        <span className="leading-none">
          <span className="block text-sm font-bold tracking-wide text-brand-navy">ALZA FLOW</span>
        </span>
      </>
    )

  return (
    <Link
      to={PUBLIC_LANDING_PATH}
      onClick={goHome}
      className={
        variant === 'stacked'
          ? `flex flex-col items-center ${className}`
          : variant === 'text'
            ? className
            : variant === 'footer'
              ? className
      : `flex items-center gap-2.5 ${className}`
      }
      aria-label="ALZA Flow home"
    >
      {lockup}
    </Link>
  )
}
