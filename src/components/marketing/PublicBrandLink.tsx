import { Link, useLocation } from 'react-router-dom'
import { Zap } from 'lucide-react'
import type { MouseEvent } from 'react'
import { usePrefersReducedMotion } from './LandingMotion'
import { PUBLIC_LANDING_PATH } from '../../lib/publicSite'

export function PublicBrandLink({ className = '' }: { className?: string }) {
  const location = useLocation()
  const reduced = usePrefersReducedMotion()
  const onLanding = location.pathname === PUBLIC_LANDING_PATH

  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (!onLanding) return
    event.preventDefault()
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <Link
      to={PUBLIC_LANDING_PATH}
      onClick={goHome}
      className={`flex items-center gap-2.5 ${className}`}
      aria-label="ALZA Flow home"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl gradient-alza shadow-sm">
        <Zap className="h-5 w-5 text-white" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide text-slate-900">ALZA FLOW</span>
        <span className="block text-[10px] font-medium text-slate-500">by ALZA Business Solutions LLP</span>
      </span>
    </Link>
  )
}
