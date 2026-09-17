import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { usePrefersReducedMotion } from './LandingMotion'

export function BackToTopButton() {
  const [visible, setVisible] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      className={`mkt-back-top fixed right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg gradient-alza sm:right-6 ${
        visible ? 'is-visible' : ''
      }`}
      style={{ bottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
