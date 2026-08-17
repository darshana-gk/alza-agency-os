import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { LogOut, Menu, Search } from 'lucide-react'
import { hasMatchingClient } from '@/pages/Clients'
import { formatRoleLabel, getInitials, useAuth } from '@/lib/auth'
import { useAgency } from '@/lib/agencyContext'
import { NotificationBell } from './NotificationBell'
import { SearchInput } from '@/components/ui/SearchInput'

interface HeaderProps {
  title: string
  subtitle?: string
  onMenuClick?: () => void
}

const SEARCHABLE_PATHS = new Set([
  '/clients',
  '/policy-files',
  '/admin/producers',
  '/admin/csrs',
  '/admin/carriers',
  '/admin/mgas',
])

export function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const { profile, signOut } = useAuth()
  const { agency } = useAgency()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSearch = searchParams.get('search') ?? ''
  const isSearchablePage = SEARCHABLE_PATHS.has(location.pathname)
  const isDashboard = location.pathname === '/'
  const menuRef = useRef<HTMLDivElement>(null)

  const [draftSearch, setDraftSearch] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const displayName = profile?.fullName ?? 'ALZA User'
  const displayRole = formatRoleLabel(profile?.role ?? 'user')
  const initials = getInitials(displayName)

  useEffect(() => {
    if (!isSearchFocused) {
      setDraftSearch(isSearchablePage ? urlSearch : '')
    }
  }, [urlSearch, isSearchablePage, isSearchFocused, location.pathname])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  function clearSearchParam() {
    if (!isSearchablePage) {
      setDraftSearch('')
      return
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('search')
        return next
      },
      { replace: true },
    )
    setDraftSearch('')
  }

  function commitHeaderSearch() {
    if (!isSearchablePage) return

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const term = draftSearch.trim()

        if (term) {
          next.set('search', draftSearch)
        } else {
          next.delete('search')
        }

        return next
      },
      { replace: true },
    )
  }

  function commitDashboardSearch() {
    const term = draftSearch.trim()
    if (!term) return

    const params = new URLSearchParams({ search: draftSearch })
    const destination = hasMatchingClient(term) ? '/clients' : '/policy-files'

    navigate(`${destination}?${params.toString()}`)
  }

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.currentTarget.value
    setDraftSearch(value)

    if (value === '') {
      clearSearchParam()
    }
  }

  function handleSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()

      if (isDashboard) {
        commitDashboardSearch()
      } else {
        commitHeaderSearch()
      }

      e.currentTarget.blur()
    }
  }

  function handleSearchBlur() {
    setIsSearchFocused(false)
    setDraftSearch(isSearchablePage ? urlSearch : '')
  }

  function handleNativeSearchClear(e: FormEvent<HTMLInputElement>) {
    const value = e.currentTarget.value
    if (value === '') {
      clearSearchParam()
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
    setMenuOpen(false)
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alza-blue-500/40 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {agency?.agencyName && (
          <div className="hidden items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 md:flex">
            {agency.logoUrl ? (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-white">
                <img
                  src={agency.logoUrl}
                  alt=""
                  className="h-full w-full scale-125 object-contain"
                />
              </div>
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-white text-[10px] font-semibold text-slate-500">
                AG
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">{agency.agencyName}</p>
              <p className="text-[10px] text-slate-500">Workspace</p>
            </div>
          </div>
        )}

        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <SearchInput
            value={draftSearch}
            onChange={handleSearchChange}
            onSearch={handleNativeSearchClear}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={handleSearchBlur}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            className="h-9 w-64 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>

        <NotificationBell />

        <div className="relative border-l border-slate-200 pl-3" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alza-blue-500/40"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="User menu"
          >
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-900">{displayName}</p>
              <p className="text-xs text-slate-500">{displayRole}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full gradient-alza text-sm font-semibold text-white shadow-sm">
              {initials}
            </div>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
            >
              <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
                <p className="text-sm font-medium text-slate-900">{displayName}</p>
                <p className="text-xs text-slate-500">{displayRole}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
