import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FileText,
  ArrowLeftRight,
  DollarSign,
  BarChart3,
  UserCog,
  Headphones,
  Building2,
  Truck,
  UserCircle,
  ChevronDown,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import type { NavGroup } from '@/types'

const mainNav: NavGroup = {
  items: [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Clients', path: '/clients', icon: Users },
    { label: 'Policy Files', path: '/policy-files', icon: FileText },
    { label: 'Transactions', path: '/transactions', icon: ArrowLeftRight },
    { label: 'Financials', path: '/financials', icon: DollarSign },
    { label: 'Reports', path: '/reports', icon: BarChart3 },
  ],
}

const adminNav: NavGroup = {
  title: 'Administration',
  items: [
    { label: 'Producers', path: '/admin/producers', icon: UserCog },
    { label: 'CSRs', path: '/admin/csrs', icon: Headphones },
    { label: 'MGAs', path: '/admin/mgas', icon: Building2 },
    { label: 'Carriers', path: '/admin/carriers', icon: Truck },
    { label: 'Users', path: '/admin/users', icon: UserCircle },
  ],
}

function NavSection({ group }: { group: NavGroup }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="mb-2">
      {group.title && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-300 transition-colors"
        >
          {group.title}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}
          />
        </button>
      )}
      {(!group.title || expanded) && (
        <ul className="space-y-0.5">
          {group.items.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <item.icon className="h-5 w-5 shrink-0 opacity-80 group-hover:opacity-100" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-gradient-to-b from-alza-blue-900 via-alza-blue-800 to-alza-teal-900 shadow-xl">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-alza shadow-md">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">ALZA Flow</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-alza-teal-300">
            Business Solutions
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavSection group={mainNav} />
        <div className="my-3 border-t border-white/10" />
        <NavSection group={adminNav} />
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-4">
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-xs font-medium text-white">Need help?</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Contact ALZA support</p>
        </div>
      </div>
    </aside>
  )
}
