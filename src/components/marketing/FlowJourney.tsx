import { useEffect, useRef, useState } from 'react'
import { observeSectionPlay, Reveal, usePrefersReducedMotion } from './LandingMotion'

const JOURNEY_STEPS = [
  'Bound transaction',
  'Expected commission',
  'Carrier / MGA statement',
  'Reconciliation',
  'Verified commission',
  'Producer commission',
  'Commission status',
] as const

export function FlowJourney() {
  const reduced = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(reduced ? JOURNEY_STEPS.length : 0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced) {
      setActive(JOURNEY_STEPS.length)
      return
    }

    let timers: number[] = []
    const start = () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers = JOURNEY_STEPS.map((_, index) =>
        window.setTimeout(() => setActive(index + 1), 80 + index * 95),
      )
    }

    const stop = observeSectionPlay(el, start, { ratio: 0.2 })
    return () => {
      stop()
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [reduced])

  const progress = active >= JOURNEY_STEPS.length ? 1 : Math.max((active - 1) / (JOURNEY_STEPS.length - 1), 0)

  return (
    <section id="how-it-works" className="scroll-mt-24 bg-gradient-to-b from-white via-white to-brand-sky/80 px-4 py-14 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">How it works</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl lg:text-[2.5rem] lg:leading-tight">
            Keep the commission path connected.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            From bound transaction to verified commission to producer commission tracking — ALZA Flow
            keeps the agency's commission operation connected.
          </p>
        </Reveal>

        <div ref={ref} className="mkt-fj mt-8" data-active={active}>
          <div className="mkt-fj-line" aria-hidden="true">
            <span className="mkt-fj-line-fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <ol className="mkt-fj-list">
            {JOURNEY_STEPS.map((step, index) => {
              const state = index < active - 1 ? 'done' : index === active - 1 ? 'active' : 'wait'
              return (
                <li key={step} className={`mkt-fj-step mkt-fj-step--${state}`}>
                  <span className="mkt-fj-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mkt-fj-label">{step}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
