import { type LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string
  change: string
  changeType: 'positive' | 'negative' | 'neutral'
  icon: LucideIcon
  iconBg: string
  iconColor: string
}

const changeIcons = {
  positive: TrendingUp,
  negative: TrendingDown,
  neutral: Minus,
}

const changeColors = {
  positive: 'text-emerald-600 bg-emerald-50',
  negative: 'text-red-600 bg-red-50',
  neutral: 'text-slate-600 bg-slate-100',
}

export function StatCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  iconBg,
  iconColor,
}: StatCardProps) {
  const ChangeIcon = changeIcons[changeType]

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-alza-blue-200">
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br from-alza-blue-50 to-alza-teal-50 opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="relative flex items-start justify-between">
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${changeColors[changeType]}`}>
            <ChangeIcon className="h-3 w-3" />
            {change}
          </div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  )
}
