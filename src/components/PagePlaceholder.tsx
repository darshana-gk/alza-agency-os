import { type LucideIcon } from 'lucide-react'

interface PagePlaceholderProps {
  icon: LucideIcon
  title: string
  description: string
}

export function PagePlaceholder({ icon: Icon, title, description }: PagePlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white py-20 shadow-sm">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-alza-blue-50 to-alza-teal-50">
        <Icon className="h-8 w-8 text-alza-blue-600" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-center text-sm text-slate-500">{description}</p>
      <button className="mt-6 rounded-lg gradient-alza px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
        Get Started
      </button>
    </div>
  )
}
