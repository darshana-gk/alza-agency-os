import { useEffect, useMemo, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
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
  Cable,
  type LucideIcon,
} from 'lucide-react'
import type { NavGroup, NavItem } from '@/types'
import { useAuth } from '@/lib/auth'
import { getNavVisibility, isAlzaSupportRole, rolesOf } from '@/lib/permissions'
import {
  ADMIN_UMBRELLA_LABELS,
  adminGroupHasActivePath,
  buildSidebarNavItems,
  type AdminNavUmbrella,
  type SidebarNavItemSpec,
} from '@/lib/sidebarNav'

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
  '/integrations': Cable,
  '/admin/producers': UserCog,
  '/admin/csrs': Headphones,
  '/admin/mgas': Building2,
  '/admin/carriers': Truck,
  '/admin/users': UserCircle,
  '/admin/agency-settings': Settings,
  '/admin/subscription-billing': CreditCard,
}

const UMBRELLA_ORDER: AdminNavUmbrella[] = ['data_integrations', 'agency_network']

function specToNavItem(item: SidebarNavItemSpec): NavItem {
  return {
    label: item.label,
    path: item.path,
    icon: ICONS[item.path] ?? FileText,
  }
}

function NavLinkItem({ item, indented }: { item: NavItem; indented?: boolean }) {
  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === '/'}
        className={({ isActive }) =>
          `group flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-all duration-200 ${
            indented ? 'px-3 pl-7' : 'px-3'
          } ${
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
  )
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
            <NavLinkItem key={item.path} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AdminUmbrellaGroup({
  title,
  items,
  forceOpen,
}: {
  title: string
  items: NavItem[]
  forceOpen: boolean
}) {
  const [expanded, setExpanded] = useState(forceOpen)

  useEffect(() => {
    if (forceOpen) setExpanded(true)
  }, [forceOpen])

  if (items.length === 0) return null

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <span>{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            expanded ? 'rotate-0' : '-rotate-90'
          }`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <NavLinkItem key={item.path} item={item} indented />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AdministrationNav({ specs }: { specs: SidebarNavItemSpec[] }) {
  const location = useLocation()
  const [expanded, setExpanded] = useState(true)

  const umbrellas = UMBRELLA_ORDER.map((id) => ({
    id,
    title: ADMIN_UMBRELLA_LABELS[id],
    items: specs.filter((item) => item.adminGroup === id).map(specToNavItem),
    forceOpen: adminGroupHasActivePath(specs, id, location.pathname),
  }))
  const standalone = specs.filter((item) => !item.adminGroup).map(specToNavItem)

  if (specs.length === 0) return null

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-300"
      >
        Administration
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      {expanded ? (
        <div className="space-y-0.5">
          {umbrellas.map((group) => (
            <AdminUmbrellaGroup
              key={group.id}
              title={group.title}
              items={group.items}
              forceOpen={group.forceOpen}
            />
          ))}
          {standalone.length > 0 ? (
            <ul className="space-y-0.5">
              {standalone.map((item) => (
                <NavLinkItem key={item.path} item={item} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function Sidebar() {
  const { profile } = useAuth()
  const nav = getNavVisibility(rolesOf(profile))
  const hideAgencySupportCard = isAlzaSupportRole(rolesOf(profile))

  const { mainNav, adminSpecs } = useMemo(() => {
    const specs = buildSidebarNavItems(nav)
    return {
      mainNav: {
        items: specs.filter((item) => item.section === 'main').map(specToNavItem),
      } satisfies NavGroup,
      adminSpecs: specs.filter((item) => item.section === 'administration'),
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
            <AdministrationNav specs={adminSpecs} />
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
