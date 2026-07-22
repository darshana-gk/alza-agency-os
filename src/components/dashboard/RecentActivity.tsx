import {
  DollarSign,
  CreditCard,
  Users,
  RotateCcw,
  CalendarClock,
  FileCheck,
  UserPlus,
  RefreshCw,
} from 'lucide-react'
import type { ActivityItem } from '@/types'

const typeConfig = {
  payment: { icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
  renewal: { icon: RefreshCw, color: 'text-alza-blue-600 bg-alza-blue-50' },
  client: { icon: UserPlus, color: 'text-violet-600 bg-violet-50' },
  policy: { icon: FileCheck, color: 'text-alza-teal-600 bg-alza-teal-50' },
  refund: { icon: RotateCcw, color: 'text-amber-600 bg-amber-50' },
}

interface RecentActivityProps {
  activities: ActivityItem[]
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-900">Recent Activity</h3>
        <p className="text-sm text-slate-500">Latest updates across your agency</p>
      </div>

      <div className="divide-y divide-slate-100">
        {activities.map((activity) => {
          const config = typeConfig[activity.type]
          const Icon = config.icon

          return (
            <div
              key={activity.id}
              className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
            >
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{activity.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{activity.description}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{activity.time}</span>
            </div>
          )
        })}
      </div>

      <div className="border-t border-slate-100 px-5 py-3">
        <button className="text-sm font-medium text-alza-blue-600 hover:text-alza-blue-700 transition-colors">
          View all activity →
        </button>
      </div>
    </div>
  )
}

export function RenewalsWidget({ count }: { count: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
          <CalendarClock className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-500">Renewals Due</p>
          <p className="text-2xl font-bold text-slate-900">{count}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {[
          { name: 'Johnson Family Trust', days: 3 },
          { name: 'Metro Auto Group LLC', days: 7 },
          { name: 'Sunrise Properties Inc', days: 14 },
        ].map((item) => (
          <div key={item.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-700 truncate">{item.name}</span>
            <span className="shrink-0 text-xs font-medium text-amber-600">{item.days}d</span>
          </div>
        ))}
      </div>
    </div>
  )
}
