/** Isolated marketing chrome matching the authenticated ALZA Flow sidebar. Not interactive app chrome. */

import type { ReactNode } from 'react'
import {
  BarChart3,
  CircleDollarSign,
  DollarSign,
  LayoutDashboard,
  Scale,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react'

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Reconciliation', icon: Scale },
  { label: 'Financials', icon: DollarSign },
  { label: 'Reports', icon: BarChart3 },
] as const

export function MarketingAppFrame({
  title,
  active,
  children,
  compact,
}: {
  title: string
  active: (typeof NAV)[number]['label']
  children: ReactNode
  compact?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_28px_80px_-28px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/80">
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
        <span className="ml-2 text-[11px] font-medium text-slate-500">ALZA Flow</span>
      </div>
      <div className={`grid ${compact ? 'min-h-[18rem]' : 'min-h-[22rem]'} lg:grid-cols-[11.5rem_minmax(0,1fr)]`}>
        <aside
          className="hidden bg-gradient-to-b from-alza-blue-900 via-alza-blue-800 to-alza-teal-900 px-3 py-4 lg:block"
          aria-hidden="true"
        >
          <div className="mb-5 flex items-center gap-2 px-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg gradient-alza">
              <Zap className="h-3.5 w-3.5 text-white" />
            </span>
            <span className="text-[11px] font-bold tracking-wide text-white">ALZA FLOW</span>
          </div>
          <ul className="space-y-0.5 text-[12px] font-medium">
            {NAV.map((item) => (
              <li
                key={item.label}
                className={
                  item.label === active
                    ? 'flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-2 text-white'
                    : 'flex items-center gap-2 px-2.5 py-2 text-slate-300'
                }
              >
                <item.icon className="h-3.5 w-3.5 opacity-80" />
                {item.label}
              </li>
            ))}
          </ul>
        </aside>
        <div className="bg-slate-50">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="text-[11px] text-slate-500">Stylized preview · demo labels only</p>
          </div>
          <div className="p-3 sm:p-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'ok' | 'warn' | 'ready' | 'muted'
}) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      : tone === 'warn'
        ? 'bg-orange-50 text-orange-800 ring-orange-600/20'
        : tone === 'ready'
          ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
          : 'bg-slate-100 text-slate-600 ring-slate-500/20'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  )
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'ok' | 'warn' | 'muted'
}) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-50 text-emerald-900 ring-emerald-600/15'
      : tone === 'warn'
        ? 'bg-orange-50 text-orange-900 ring-orange-600/15'
        : 'bg-slate-50 text-slate-700 ring-slate-500/15'
  return (
    <div className={`min-w-[4.5rem] rounded-lg px-2.5 py-1.5 ring-1 ring-inset ${cls}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Kpi({
  title,
  value,
  tone,
}: {
  title: string
  value: string
  tone: 'blue' | 'teal' | 'violet' | 'amber'
}) {
  const tones = {
    blue: { wrap: 'bg-alza-blue-50 text-alza-blue-600', Icon: Wallet },
    teal: { wrap: 'bg-alza-teal-50 text-alza-teal-600', Icon: CircleDollarSign },
    violet: { wrap: 'bg-violet-50 text-violet-600', Icon: TrendingUp },
    amber: { wrap: 'bg-amber-50 text-amber-600', Icon: TrendingUp },
  }
  const { wrap, Icon } = tones[tone]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900">{value}</p>
        </div>
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${wrap}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  )
}

export function ReconciliationProductFrame() {
  return (
    <MarketingAppFrame title="Reconciliation" active="Reconciliation">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Carrier statement — August</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Commissions checked against expected agency amounts</p>
          </div>
          <span className="rounded-full bg-alza-blue-50 px-2.5 py-1 text-[10px] font-medium text-alza-blue-800 ring-1 ring-inset ring-alza-blue-600/20">
            Work queue
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SummaryPill label="Matched" value="18" tone="ok" />
          <SummaryPill label="Needs Review" value="3" tone="warn" />
          <SummaryPill label="Missing" value="1" tone="warn" />
          <SummaryPill label="Underpaid" value="1" tone="warn" />
          <SummaryPill label="Overpaid" value="1" tone="warn" />
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-100">
          <div className="grid grid-cols-4 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Line</span>
            <span>Expected</span>
            <span>Statement</span>
            <span>Status</span>
          </div>
          {[
            ['Commercial Auto', '$1,240', '$1,240', 'Matched', 'ok'],
            ['Homeowners', '$890', '$640', 'Underpaid', 'warn'],
            ['Businessowners', '$2,100', '—', 'Missing', 'warn'],
            ['Workers Comp', '$760', '$760', 'Matched', 'ok'],
          ].map((row) => (
            <div
              key={row[0]}
              className="grid grid-cols-4 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-700"
            >
              <span className="font-medium">{row[0]}</span>
              <span className="tabular-nums">{row[1]}</span>
              <span className="tabular-nums">{row[2]}</span>
              <StatusPill label={row[3]} tone={row[4] === 'ok' ? 'ok' : 'warn'} />
            </div>
          ))}
        </div>
      </div>
    </MarketingAppFrame>
  )
}

export function ExceptionsProductFrame() {
  return (
    <MarketingAppFrame title="Needs Review" active="Reconciliation">
      <div className="mb-3 flex gap-2 border-b border-slate-200 text-[12px] font-medium">
        <span className="border-b-2 border-transparent px-2 py-1.5 text-slate-500">Work queue</span>
        <span className="border-b-2 border-alza-blue-700 px-2 py-1.5 text-alza-blue-800">Needs Review (4)</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-4 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Statement</span>
          <span>Line</span>
          <span className="hidden sm:block">Variance</span>
          <span>Discrepancy</span>
        </div>
        {[
          ['Carrier · Aug', 'Homeowners', '−$250', 'Underpaid'],
          ['Carrier · Aug', 'Businessowners', 'Missing', 'Missing'],
          ['MGA · Aug', 'Commercial Auto', '+$80', 'Overpaid'],
          ['MGA · Aug', 'Umbrella', 'No match', 'Needs Review'],
        ].map((row) => (
          <div
            key={row[0] + row[1]}
            className="grid grid-cols-4 border-t border-slate-100 px-3 py-2.5 text-[12px] text-slate-700"
          >
            <span>{row[0]}</span>
            <span className="font-medium">{row[1]}</span>
            <span className="hidden tabular-nums text-slate-500 sm:block">{row[2]}</span>
            <StatusPill label={row[3]} tone="warn" />
          </div>
        ))}
      </div>
    </MarketingAppFrame>
  )
}

export function ProducerProductFrame() {
  return (
    <MarketingAppFrame title="Financials · Producer Payments" active="Financials">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Ready for Payment</p>
            <p className="text-[11px] text-slate-500">Producer commissions ready to include in a payment batch</p>
          </div>
          <span className="rounded-lg gradient-alza px-3 py-1.5 text-[11px] font-medium text-white">
            Create Payment Batch
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-100">
          <div className="grid grid-cols-4 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Producer</span>
            <span>Line</span>
            <span>Amount</span>
            <span>Status</span>
          </div>
          {[
            ['Producer A', 'Commercial Auto', '$410', 'Ready', 'ready'],
            ['Producer B', 'Homeowners', '$280', 'Ready', 'ready'],
            ['Producer A', 'Businessowners', '$620', 'Paid', 'ok'],
            ['Producer C', 'Workers Comp', '$195', 'Paid', 'ok'],
          ].map((row) => (
            <div
              key={row[0] + row[1] + row[3]}
              className="grid grid-cols-4 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-700"
            >
              <span className="font-medium">{row[0]}</span>
              <span>{row[1]}</span>
              <span className="tabular-nums">{row[2]}</span>
              <StatusPill label={row[3]} tone={row[4] === 'ok' ? 'ok' : 'ready'} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Payment confirmation recorded in ALZA Flow. ALZA Flow Pay is not shown here.
        </p>
      </div>
    </MarketingAppFrame>
  )
}

export function DashboardProductFrame({ wide }: { wide?: boolean }) {
  const bars = [
    { m: 'Jan', a: 42, p: 22 },
    { m: 'Feb', a: 48, p: 24 },
    { m: 'Mar', a: 51, p: 26 },
    { m: 'Apr', a: 44, p: 21 },
    { m: 'May', a: 58, p: 29 },
    { m: 'Jun', a: 62, p: 31 },
  ]
  return (
    <MarketingAppFrame title="Dashboard" active="Dashboard" compact={!wide}>
      <div className="relative overflow-hidden rounded-xl gradient-alza p-4 text-white shadow-lg">
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <p className="relative text-sm font-bold">Welcome to ALZA Flow</p>
        <p className="relative mt-1 text-[11px] text-blue-100">
          Live premium, commission, and operational metrics from the agency workspace.
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Kpi title="Agency Commission" value="$48,200" tone="teal" />
        <Kpi title="Agency Received" value="$41,750" tone="blue" />
        <Kpi title="Producer Ready" value="$6,420" tone="amber" />
        <Kpi title="Producer Paid" value="$12,980" tone="violet" />
      </div>
      <div className={`mt-3 grid gap-3 ${wide ? 'lg:grid-cols-3' : ''}`}>
        <div className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${wide ? 'lg:col-span-2' : ''}`}>
          <p className="mb-2 text-[12px] font-semibold text-slate-900">Monthly Premium & Commission</p>
          <div className="flex h-28 items-end gap-2 px-1">
            {bars.map((bar) => (
              <div key={bar.m} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-24 w-full items-end justify-center gap-0.5">
                  <span className="w-1.5 rounded-t bg-alza-blue-600" style={{ height: `${bar.a}%` }} />
                  <span className="w-1.5 rounded-t bg-alza-teal-600" style={{ height: `${bar.p + 20}%` }} />
                </div>
                <span className="text-[9px] text-slate-400">{bar.m}</span>
              </div>
            ))}
          </div>
        </div>
        {wide ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-[12px] font-semibold text-slate-900">Needs Attention</p>
            {[
              ['Needs Review', '4'],
              ['Returned for Correction', '2'],
              ['Ready for Payment', '6'],
            ].map((item) => (
              <div
                key={item[0]}
                className="mb-1.5 flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2"
              >
                <span className="text-[12px] text-slate-700">{item[0]}</span>
                <span className="text-sm font-bold tabular-nums">{item[1]}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </MarketingAppFrame>
  )
}

/** @deprecated V3 generic preview — kept so old imports fail loudly if unused. */
export function CommissionWorkspacePreview() {
  return <DashboardProductFrame />
}
