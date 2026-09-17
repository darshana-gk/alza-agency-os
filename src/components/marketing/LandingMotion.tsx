import { useEffect, useRef, useState, type ReactNode } from 'react'

const TICKER_ITEMS = [
  'Statements compared',
  'Exceptions highlighted',
  'Producer amounts tracked',
  'Payment status updated',
  'Missing lines flagged',
  'Matched activity confirmed',
] as const

const JOURNEY_STEPS = [
  'Bound transaction',
  'Expected commission',
  'Carrier / MGA statement',
  'Reconciliation',
  'Verified commission',
  'Producer commission',
  'Payment status',
] as const

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduced
}

export function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: ReactNode
  className?: string
  delayMs?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      setVisible(true)
      return
    }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  return (
    <div
      ref={ref}
      className={`mkt-reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  )
}

export function MarketingOrbs({ variant = 'hero' }: { variant?: 'hero' | 'dark' }) {
  const dark = variant === 'dark'
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className={`mkt-orb-a absolute left-[18%] top-8 h-[28rem] w-[28rem] rounded-full blur-3xl md:h-[34rem] md:w-[34rem] ${
          dark ? 'bg-alza-teal-400/15' : 'bg-alza-blue-300/45'
        }`}
      />
      <div
        className={`mkt-orb-b absolute -right-16 top-24 hidden h-[22rem] w-[22rem] rounded-full blur-3xl sm:block ${
          dark ? 'bg-alza-blue-400/20' : 'bg-alza-teal-200/50'
        }`}
      />
      <div
        className={`mkt-orb-c absolute -left-20 bottom-0 h-[18rem] w-[18rem] rounded-full blur-3xl ${
          dark ? 'bg-alza-blue-300/10' : 'bg-alza-blue-200/40'
        }`}
      />
    </div>
  )
}

function TickerRow({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      className={`flex w-max items-center gap-10 ${duplicate ? 'mkt-ticker-dup' : ''}`}
      aria-hidden={duplicate}
    >
      {TICKER_ITEMS.map((item) => (
        <li key={`${duplicate ? 'dup' : 'src'}-${item}`} className="flex items-center gap-3 whitespace-nowrap">
          <span className="mkt-status-dot h-1.5 w-1.5 rounded-full bg-gradient-to-r from-alza-blue-600 to-alza-teal-500" />
          <span className="text-sm font-medium text-slate-600">{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function OpsTicker() {
  return (
    <div className="relative overflow-hidden border-y border-slate-200/80 bg-white/70 py-4" aria-label="Operational activity">
      <div className="pointer-events-none mkt-ticker-track flex w-max gap-10">
        <TickerRow />
        <TickerRow duplicate />
      </div>
    </div>
  )
}

function FlowConnector({ axis = 'x' }: { axis?: 'x' | 'y' }) {
  if (axis === 'y') {
    return (
      <span className="relative mx-auto my-1 block h-7 w-px overflow-hidden bg-alza-blue-200 sm:hidden" aria-hidden="true">
        <span className="mkt-flow-pulse-y absolute left-1/2 top-0 h-3 w-1.5 -translate-x-1/2 rounded-full bg-alza-teal-500" />
      </span>
    )
  }
  return (
    <span className="relative hidden h-px w-5 overflow-hidden bg-alza-blue-200 sm:block" aria-hidden="true">
      <span className="mkt-flow-pulse absolute top-1/2 left-0 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-alza-teal-500" />
    </span>
  )
}

export function CommissionJourney() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-white px-4 py-24 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-alza-blue-700">How it works</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.5rem] lg:leading-tight">
            Keep the commission path connected.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            From bound transaction to verified commission to producer payout — ALZA Flow keeps the agency's commission operation connected.
          </p>
        </Reveal>
        <Reveal delayMs={80} className="mt-12">
          <ol className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-2 sm:gap-y-3">
            {JOURNEY_STEPS.map((step, index) => (
              <li key={step} className="flex flex-col items-center sm:flex-row sm:items-center">
                {index > 0 ? <FlowConnector axis="y" /> : null}
                {index > 0 ? <FlowConnector axis="x" /> : null}
                <div className="w-full rounded-2xl bg-slate-50 px-4 py-4 text-center ring-1 ring-slate-200/80 sm:w-auto sm:min-w-[9.5rem] sm:px-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">{step}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  )
}
