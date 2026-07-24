import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Search, Menu } from 'lucide-react'
import { hasMatchingClient } from '@/pages/Clients'

interface HeaderProps {
  title: string
  subtitle?: string
  onMenuClick?: () => void
}

const SEARCHABLE_PATHS = new Set(['/clients', '/policy-files', '/admin/producers', '/admin/csrs', '/admin/carriers', '/admin/mgas'])

export function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSearch = searchParams.get('search') ?? ''
  const isSearchablePage = SEARCHABLE_PATHS.has(location.pathname)
  const isDashboard = location.pathname === '/'

  const [draftSearch, setDraftSearch] = useState('')
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  useEffect(() => {
    if (!isSearchFocused) {
      setDraftSearch(isSearchablePage ? urlSearch : '')
    }
  }, [urlSearch, isSearchablePage, isSearchFocused, location.pathname])

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

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.currentTarget.value
    setDraftSearch(value)

    if (value === '') {
      clearSearchParam()
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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

  function handleNativeSearchClear(e: React.FormEvent<HTMLInputElement>) {
    const value = e.currentTarget.value
    if (value === '') {
      clearSearchParam()
    }
  }

  function handleSearchBlur() {
    setIsSearchFocused(false)
    setDraftSearch(isSearchablePage ? urlSearch : '')
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
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
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
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

        <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-alza-teal-500 ring-2 ring-white" />
        </button>

        <div className="flex items-center gap-3 border-l border-slate-200 pl-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-900">Admin User</p>
            <p className="text-xs text-slate-500">Agency Manager</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full gradient-alza text-sm font-semibold text-white shadow-sm">
            AU
          </div>
        </div>
      </div>
    </header>
  )
}
