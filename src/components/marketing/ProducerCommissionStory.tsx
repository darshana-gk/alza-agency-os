import { useEffect, useRef, useState } from 'react'
import { observeSectionPlay, Reveal, usePrefersReducedMotion } from './LandingMotion'

const ROWS = [
  { producer: 'Alex R.', agency: '$1,500', split: 60, amount: '$900', status: 'Commission Ready', tone: 'ok' },
  { producer: 'Jordan M.', agency: '$1,250', split: 50, amount: '$625', status: 'Commission Ready', tone: 'ok' },
  { producer: 'Taylor K.', agency: '$980', split: 60, amount: '$588', status: 'Review commissions', tone: 'review' },
  { producer: 'Casey L.', agency: '$1,100', split: 50, amount: '$550', status: 'Commission Ready', tone: 'ok' },
] as const

export function ProducerCommissionStory() {
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
    <section id="producers" className="mkt-pc-band -mt-2 scroll-mt-24 px-4 py-14 sm:px-6 lg:-mt-3 lg:px-8 lg:py-16">
      <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] lg:gap-12">
        <Reveal className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">Producer commissions</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl lg:text-[2.45rem] lg:leading-tight">
            Producer commissions,
            <br />
            without the spreadsheet chase.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Track producer commissions, approval status, and commission amounts in the same operational
            workflow.
          </p>
          <p className="mt-4 text-sm font-medium text-brand-navy">
            From commission earned to commission status, keep the trail clear.
          </p>
        </Reveal>

        <div ref={ref} className={`mkt-pc ${on ? 'mkt-pc--on' : ''}`} aria-hidden="true">
          <p className="mkt-pc-calc">
            <span className="mkt-pc-calc-label">Agency commission × split</span>
            <span className="mkt-pc-calc-eq">$1,500 × 60% → $900</span>
          </p>
          <div className="mkt-pc-surface">
            <div className="mkt-pc-head">
              <span>Producer</span>
              <span>Agency commission</span>
              <span>Split</span>
              <span>Producer commission</span>
              <span>Status</span>
            </div>
            {ROWS.map((row) => (
              <div key={row.producer} className={`mkt-pc-row mkt-pc-row--${row.tone}`}>
                <span className="mkt-pc-name">{row.producer}</span>
                <span className="mkt-pc-agency">{row.agency}</span>
                <span className="mkt-pc-split">
                  <span className="mkt-pc-split-bar" style={{ ['--split' as string]: `${row.split}%` }} />
                  <span className="mkt-pc-split-val">{row.split}%</span>
                </span>
                <span className="mkt-pc-amount">{row.amount}</span>
                <span className="mkt-pc-status">{row.status}</span>
              </div>
            ))}
          </div>
          <p className="mkt-pc-note">Stylized preview · demo labels only</p>
        </div>
      </div>
    </section>
  )
}
