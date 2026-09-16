/** Polished product-UI preview for the public landing page. Generic labels only — not a live screenshot. */

export function CommissionWorkspacePreview() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="ml-3 text-xs font-medium text-slate-500">ALZA Flow · Commission operations</span>
      </div>
      <div
        className="grid gap-0 md:grid-cols-[11.5rem_minmax(0,1fr)]"
        role="img"
        aria-label="ALZA Flow workspace preview showing expected, received, review, and producer commission areas"
      >
        <aside className="hidden border-r border-slate-200 bg-slate-50/80 px-4 py-5 md:block" aria-hidden="true">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Workspace</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            {['Overview', 'Reconciliation', 'Exceptions', 'Producers'].map((item, index) => (
              <li
                key={item}
                className={
                  index === 0
                    ? 'rounded-lg bg-white px-3 py-2 font-medium text-slate-900 shadow-sm'
                    : 'px-3 py-2'
                }
              >
                {item}
              </li>
            ))}
          </ul>
        </aside>
        <div className="p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Expected', tone: 'slate' },
              { label: 'Received', tone: 'teal' },
              { label: 'Needs attention', tone: 'blue' },
              { label: 'Producers owed', tone: 'navy' },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
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
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                className="grid grid-cols-3 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-700"
              >
                <span>{row[0]}</span>
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
