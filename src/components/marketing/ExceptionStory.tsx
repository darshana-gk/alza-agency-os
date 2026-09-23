import { Reveal } from './LandingMotion'

const EXCEPTIONS = [
  {
    code: 'Missing',
    policy: 'Policy 28401',
    detail: 'No statement line against expected commission',
    tone: 'miss',
  },
  {
    code: 'Underpaid',
    policy: 'Policy 61128',
    detail: 'Received amount below expected commission',
    tone: 'under',
  },
  {
    code: 'Overpaid',
    policy: 'Policy 39011',
    detail: 'Statement amount above expected commission',
    tone: 'over',
  },
  {
    code: 'Needs Review',
    policy: 'Policy 44820',
    detail: 'Unmatched activity awaiting agency review',
    tone: 'review',
  },
] as const

export function ExceptionStory() {
  return (
    <section
      id="exceptions"
      className="relative z-10 -mt-4 scroll-mt-24 bg-gradient-to-b from-white via-white to-brand-sky/70 px-4 pb-12 pt-8 sm:px-6 lg:-mt-8 lg:px-8 lg:pb-14 lg:pt-5"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] lg:gap-12">
        <Reveal className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-teal">Exceptions</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-navy sm:text-[2.15rem] sm:leading-tight">
            Spot the commissions that need attention.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            ALZA Flow surfaces missing, underpaid, overpaid, and unmatched activity so your team can focus
            on the exceptions instead of searching for them.
          </p>
        </Reveal>

        <Reveal delayMs={80} className="mkt-ex relative min-w-0">
          <div className="mkt-ex-surface" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <ul className="mkt-ex-list">
            {EXCEPTIONS.map((item, index) => (
              <li key={item.policy} className={`mkt-ex-card mkt-ex-card--${item.tone} mkt-ex-card--${index}`}>
                <span className="mkt-ex-code">{item.code}</span>
                <span className="mkt-ex-copy">
                  <span className="mkt-ex-policy">{item.policy}</span>
                  <span className="mkt-ex-detail">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}
