import type { ReactNode } from 'react'
import { PUBLIC_DEMO_MAILTO } from '../../lib/publicSite'

/**
 * Contact CTA for public marketing.
 * Currently uses the existing support mailbox. Swap href later for a Book a Demo route/modal.
 */
export function TalkToAlzaLink({
  className,
  children = 'Talk to ALZA',
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <a href={PUBLIC_DEMO_MAILTO} className={className}>
      {children}
    </a>
  )
}
