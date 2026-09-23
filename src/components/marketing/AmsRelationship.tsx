import { useEffect, useRef, useState } from 'react'
import { observeSectionPlay, Reveal, usePrefersReducedMotion } from './LandingMotion'

const AMS_ITEMS = ['Clients', 'Policies', 'Documents', 'Agency workflow'] as const
const FLOW_ITEMS = [
  'Commission operations',
  'Reconciliation',
  'Exceptions',
  'Producer commission visibility',
  'Reporting',
] as const

export function AmsRelationship() {
  const reduced = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(reduced)

  useEffect(() => {
    if (reduced) {
      setOn(true)
      return
    }
    const el = ref.current
    if (!el) return
    return observeSectionPlay(el, () => setOn(true), { ratio: 0.22 })
  }, [reduced])

  return (
    <section id="positioning" className="mkt-ams-band relative z-10 -mt-4 scroll-mt-24 px-4 pb-14 pt-12 sm:px-6 lg:-mt-6 lg:px-8 lg:pb-16 lg:pt-14">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">Keep your AMS</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl lg:text-[2.45rem] lg:leading-tight">
            Keep your AMS.
            <br />
            Give commissions their own workflow.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            ALZA Flow works alongside your existing systems, giving your team one place for reconciliation,
            discrepancies, producer commissions, and reporting.
          </p>
          <p className="mt-5 text-lg font-semibold text-brand-navy">No AMS replacement required.</p>
        </Reveal>

        <div ref={ref} className={`mkt-ams ${on ? 'mkt-ams--on' : ''}`} aria-hidden="true">
          <article className="mkt-ams-side mkt-ams-side--ams">
            <p className="mkt-ams-kicker">Your AMS</p>
            <ul>
              {AMS_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <div className="mkt-ams-link">
            <span className="mkt-ams-line" />
            <span className="mkt-ams-arrow">→</span>
          </div>
          <article className="mkt-ams-side mkt-ams-side--flow">
            <p className="mkt-ams-kicker">ALZA Flow</p>
            <ul>
              {FLOW_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}
