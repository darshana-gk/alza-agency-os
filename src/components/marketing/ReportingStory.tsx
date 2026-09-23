import { useEffect, useRef, useState } from 'react'
import { Reveal, usePrefersReducedMotion } from './LandingMotion'

const MONTHS = [
  { id: 'jan', label: 'Jan', expected: 65, received: 60 },
  { id: 'feb', label: 'Feb', expected: 72, received: 68 },
  { id: 'mar', label: 'Mar', expected: 68, received: 62 },
  { id: 'apr', label: 'Apr', expected: 81, received: 75 },
  { id: 'may', label: 'May', expected: 77, received: 69 },
  { id: 'jun', label: 'Jun', expected: 100, received: 67 },
] as const

const SUMMARIES = [
  { label: 'Statements reviewed', value: '12' },
  { label: 'Commission activity', value: '24 transactions' },
  { label: 'Producer commissions', value: '$18,640' },
] as const

export function ReportingStory() {
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
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.22) {
          setOn(true)
          io.disconnect()
        }
      },
      { threshold: [0, 0.22, 0.35], rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  return (
    <section
      id="reporting"
      className="relative scroll-mt-24 overflow-hidden bg-brand-navy px-4 py-14 sm:px-6 lg:px-8 lg:py-20"
    >
      <div
        className="pointer-events-none absolute -right-24 top-8 h-[28rem] w-[28rem] rounded-full bg-brand-teal/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className={`relative mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:gap-10 ${
          on ? 'mkt-rp mkt-rp--on' : 'mkt-rp'
        }`}
      >
        <Reveal className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7ee8de]">Reporting</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[2.55rem] lg:leading-tight">
            See the business behind your commissions.
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
            Understand agency commission revenue, producer commissions, discrepancies, and commission
            status from one operational view.
          </p>
        </Reveal>

        <div ref={ref} className="mkt-rp-stage" aria-hidden="true">
          <div className="mkt-rp-kpis">
            <p className="mkt-rp-kpi mkt-rp-kpi--primary">
              <span>Expected commission</span>
              <strong>$48,200</strong>
            </p>
            <p className="mkt-rp-kpi mkt-rp-kpi--received">
              <span>Received / verified</span>
              <strong>$41,750</strong>
            </p>
          </div>
          <div className="mkt-rp-chart">
            <div className="mkt-rp-legend">
              <p>
                <i className="mkt-rp-swatch mkt-rp-swatch--exp" />
                Expected
              </p>
              <p>
                <i className="mkt-rp-swatch mkt-rp-swatch--rec" />
                Received / verified
              </p>
            </div>
            <div className="mkt-rp-plot">
              <span className="mkt-rp-guide" />
              <span className="mkt-rp-guide" />
              <span className="mkt-rp-guide" />
              <div className="mkt-rp-months">
                {MONTHS.map((month, index) => (
                  <div
                    key={month.id}
                    className="mkt-rp-month"
                    style={{ animationDelay: `${200 + index * 80}ms` }}
                  >
                    <div className="mkt-rp-pair">
                      <span className="mkt-rp-exp" style={{ height: `${month.expected}%` }} />
                      <span className="mkt-rp-rec" style={{ height: `${month.received}%` }} />
                    </div>
                    <p className="mkt-rp-month-label">{month.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <ul className="mkt-rp-sum">
            {SUMMARIES.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
          <p className="mkt-rp-note">Stylized preview · demo labels only</p>
        </div>
      </div>
    </section>
  )
}
