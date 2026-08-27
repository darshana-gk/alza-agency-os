import { useMemo, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FileText,
  ArrowLeftRight,
  DollarSign,
  Scale,
  BarChart3,
  History,
  UserCog,
  Headphones,
  Building2,
  Truck,
  UserCircle,
  CreditCard,
  ChevronDown,
  Zap,
  Settings,
  LifeBuoy,
  Inbox,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import type { NavGroup } from '@/types'
import { useAuth } from '@/lib/auth'
import { getNavVisibility, isAlzaSupportRole, rolesOf } from '@/lib/permissions'
import { buildSidebarNavItems } from '@/lib/sidebarNav'

const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/clients': Users,
  '/policy-files': FileText,
  '/transactions': ArrowLeftRight,
  '/financials': DollarSign,
  '/reconciliation': Scale,
  '/reports': BarChart3,
  '/activity': History,
  '/support': LifeBuoy,
  '/admin/support-inbox': Inbox,
  '/onboarding': Upload,
  '/admin/producers': UserCog,
  '/admin/csrs': Headphones,
  '/admin/mgas': Building2,
  '/admin/carriers': Truck,
  '/admin/users': UserCircle,
  '/admin/agency-settings': Settings,
  '/admin/subscription-billing': CreditCard,
}

function NavSection({ group }: { group: NavGroup }) {
  const [expanded, setExpanded] = useState(true)

  if (group.items.length === 0) return null

  return (
    <div className="mb-2">
      {group.title && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-300"
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
  const { profile } = useAuth()
  const nav = getNavVisibility(rolesOf(profile))
  const hideAgencySupportCard = isAlzaSupportRole(rolesOf(profile))

  const { mainNav, adminNav } = useMemo(() => {
    const specs = buildSidebarNavItems(nav)
    const toGroup = (section: 'main' | 'administration', title?: string): NavGroup => ({
      title,
      items: specs
        .filter((item) => item.section === section)
        .map((item) => ({
          label: item.label,
          path: item.path,
          icon: ICONS[item.path] ?? FileText,
        })),
    })
    return {
      mainNav: toGroup('main'),
      adminNav: toGroup('administration', 'Administration'),
    }
  }, [nav])

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-gradient-to-b from-alza-blue-900 via-alza-blue-800 to-alza-teal-900 shadow-xl">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-alza shadow-md">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="text-base font-bold tracking-wide text-white">ALZA FLOW</h1>
          <p className="mt-0.5 text-[9px] font-medium leading-snug text-white/55">
            by ALZA Business Solutions LLP
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavSection group={mainNav} />
        {nav.administration && (
          <>
            <div className="my-3 border-t border-white/10" />
            <NavSection group={adminNav} />
          </>
        )}
      </nav>

      <div className="border-t border-white/10 p-4">
        {(nav.support || nav.alzaSupportInbox) && !hideAgencySupportCard && (
          <Link
            to={nav.support ? '/support' : '/admin/support-inbox'}
            className="block rounded-lg bg-white/5 p-3 transition-colors hover:bg-white/10"
          >
            <p className="text-xs font-medium text-white">Need help?</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Contact ALZA support</p>
          </Link>
        )}
      </div>
    </aside>
  )
}
