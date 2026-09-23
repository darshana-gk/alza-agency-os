import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { usePrefersReducedMotion } from './LandingMotion'
import { TalkToAlzaLink } from './TalkToAlzaLink'

const FRAGMENTS = [
  { id: 'statement-file', kind: 'strip', kicker: 'Carrier statement', value: 'August' },
  { id: 'policy', kind: 'tile', kicker: 'Policy', value: '10482' },
  { id: 'expected', kind: 'value', kicker: 'Expected', value: '$1,500' },
  { id: 'statement', kind: 'metric', kicker: 'Statement', value: '$1,425' },
  { id: 'trx', kind: 'snip', kicker: 'Transaction', value: 'TRX-1048' },
  { id: 'split', kind: 'pill', kicker: 'Producer split', value: '60%' },
] as const

const ACTIVATE_RATIO = 0.3
const ACTIVATE_THRESHOLDS = [0, 0.15, 0.25, 0.3, 0.35, 0.5, 0.75, 1]
const SKIP_IDLE_MS = 90

function visualVisibleRatio(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const vh = window.innerHeight || document.documentElement.clientHeight
  const visible = Math.min(rect.bottom, vh) - Math.max(rect.top, 0)
  return visible / Math.max(rect.height, 1)
}

function isAnchorSkip() {
  const hash = window.location.hash
  return Boolean(hash) && hash !== '#problem' && hash !== '#main'
}

export function CommissionStory() {
  const reduced = usePrefersReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)
  const visualRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const [phase, setPhase] = useState(reduced ? 4 : 0)

  useEffect(() => {
    if (reduced) {
      setPhase(4)
      return
    }

    const visual = visualRef.current
    if (!visual) return

    let t2 = 0
    let t3 = 0
    let t4 = 0
    let idle = 0
    let io: IntersectionObserver

    const stopWatching = () => {
      window.clearTimeout(idle)
      window.removeEventListener('scroll', onScroll)
      io.disconnect()
    }

    const start = () => {
      if (startedRef.current) return
      startedRef.current = true
      stopWatching()
      setPhase(1)
      t2 = window.setTimeout(() => setPhase(2), 400)
      t3 = window.setTimeout(() => setPhase(3), 700)
      t4 = window.setTimeout(() => setPhase(4), 1200)
    }

    const confirmAndStart = () => {
      if (visualVisibleRatio(visual) >= ACTIVATE_RATIO) start()
    }

    const armIdleConfirm = () => {
      window.clearTimeout(idle)
      idle = window.setTimeout(confirmAndStart, SKIP_IDLE_MS)
    }

    const onScroll = () => {
      if (startedRef.current) return
      if (isAnchorSkip()) armIdleConfirm()
    }

    io = new IntersectionObserver(
      ([entry]) => {
        if (startedRef.current) return
        if (entry.intersectionRatio < ACTIVATE_RATIO) return
        if (isAnchorSkip()) {
          armIdleConfirm()
          return
        }
        start()
      },
      { threshold: ACTIVATE_THRESHOLDS, rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(visual)
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
      window.clearTimeout(idle)
      window.removeEventListener('scroll', onScroll)
      io.disconnect()
    }
  }, [reduced])

  return (
    <section
      id="problem"
      ref={sectionRef}
      className="scroll-mt-24 bg-white"
      aria-label="The problem we solve"
    >
      <div className="px-4 py-16 sm:px-6 lg:px-8 lg:py-[4.5rem]">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:gap-12">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">
              The problem we solve
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-brand-navy sm:text-4xl lg:text-[2.5rem] lg:leading-tight">
              Commission chaos, reconciled.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Agencies can lose visibility into commissions when expected amounts, carrier and MGA
              statements, exceptions and producer commissions are tracked across disconnected files
              and workflows. ALZA Flow brings that activity into one reviewable commission workflow.
            </p>
            <TalkToAlzaLink className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-brand-teal px-7 text-sm font-semibold text-brand-navy shadow-sm hover:opacity-90">
              Talk to us about ALZA Flow
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </TalkToAlzaLink>
          </div>

          <div ref={visualRef} className={`mkt-cs mkt-cs--p${phase}`} aria-hidden="true">
            <div className="mkt-cs-wash" />
            <div className="mkt-cs-before">
              <p className="mkt-cs-zone">Scattered</p>
              <div className="mkt-cs-frags">
                {FRAGMENTS.map((fragment, index) => (
                  <article
                    key={fragment.id}
                    className={`mkt-cs-frag mkt-cs-frag--${fragment.kind} mkt-cs-frag--${index}`}
                  >
                    <p className="mkt-cs-kicker">{fragment.kicker}</p>
                    <p className="mkt-cs-value">{fragment.value}</p>
                  </article>
                ))}
              </div>
            </div>
            <div className="mkt-cs-path">
              <p className="mkt-cs-path-label">Organized in ALZA Flow</p>
              <span className="mkt-cs-path-line" />
              <span className="mkt-cs-path-arrow">→</span>
            </div>
            <div className="mkt-cs-after">
              <p className="mkt-cs-zone">Organized</p>
              <div className="mkt-cs-record">
                <div className="mkt-cs-record-head">
                  <p className="mkt-cs-kicker">Policy 10482</p>
                  <p className="mkt-cs-record-title">Carrier A</p>
                </div>
                <dl className="mkt-cs-record-grid">
                  <div>
                    <dt>Expected commission</dt>
                    <dd>$1,500</dd>
                  </div>
                  <div>
                    <dt>Statement commission</dt>
                    <dd>$1,425</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>August statement</dd>
                  </div>
                  <div>
                    <dt>Transaction</dt>
                    <dd>TRX-1048</dd>
                  </div>
                </dl>
                <p className="mkt-cs-ready">
                  Ready for reconciliation
                  <span>→</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
