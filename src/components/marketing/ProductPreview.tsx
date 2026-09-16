/** Large product-UI preview for the public landing page. Generic labels only — not a live screenshot. */

export function CommissionWorkspacePreview() {
  return (
    <figure className="overflow-hidden rounded-3xl bg-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.28)] ring-1 ring-slate-200/80">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/90 px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="ml-3 text-xs font-medium tracking-wide text-slate-500">
          ALZA Flow · Commission operations
        </span>
      </div>
      <div
        className="grid gap-0 lg:grid-cols-[13.5rem_minmax(0,1fr)]"
        role="img"
        aria-label="ALZA Flow workspace preview showing expected commission, received commission, needs attention, and producer commissions"
      >
        <aside className="hidden border-r border-slate-100 bg-slate-50/70 px-5 py-7 lg:block" aria-hidden="true">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
          <ul className="mt-5 space-y-1 text-sm text-slate-600">
            {['Overview', 'Reconciliation', 'Exceptions', 'Producers'].map((item, index) => (
              <li
                key={item}
                className={
                  index === 0
                    ? 'rounded-lg bg-white px-3 py-2.5 font-medium text-slate-900 shadow-sm'
                    : 'px-3 py-2.5'
                }
              >
                {item}
              </li>
            ))}
          </ul>
        </aside>
        <div className="p-5 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Expected Commission', tone: 'slate' },
              { label: 'Received Commission', tone: 'teal' },
              { label: 'Needs Attention', tone: 'blue' },
              { label: 'Producer Commissions', tone: 'navy' },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {tile.label}
                </p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={
                      tile.tone === 'teal'
                        ? 'h-full w-3/4 rounded-full bg-alza-teal-500'
                        : tile.tone === 'blue'
                          ? 'h-full w-1/3 rounded-full bg-alza-blue-500'
                          : tile.tone === 'navy'
                            ? 'h-full w-1/2 rounded-full bg-alza-blue-800'
                            : 'h-full w-2/3 rounded-full bg-slate-400'
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-7">
            <div className="grid grid-cols-3 px-1 pb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              <span>Statement</span>
              <span>Status</span>
              <span>Next step</span>
            </div>
            {[
              ['Carrier statement', 'Matched', 'Complete'],
              ['MGA statement', 'Needs review', 'Investigate'],
              ['Producer commissions', 'In progress', 'Operate'],
            ].map((row) => (
              <div
                key={row[0]}
                className="grid grid-cols-3 border-t border-slate-100 py-3.5 text-sm text-slate-700"
              >
                <span className="font-medium">{row[0]}</span>
                <span className="text-slate-600">{row[1]}</span>
                <span className="text-slate-500">{row[2]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        Stylized product interface preview. Not a live screenshot and not customer data.
      </figcaption>
    </figure>
  )
}
