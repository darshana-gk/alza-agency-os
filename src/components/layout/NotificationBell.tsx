import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  CircleDollarSign,
  FileText,
  RotateCcw,
  X,
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import {
  fetchOperationalNotifications,
  formatBadgeCount,
  type NotificationCategory,
  type OperationalNotification,
} from '../../lib/notifications'
import { roleInputFromProfile } from '../../lib/permissions'

function categoryIcon(category: NotificationCategory) {
  switch (category) {
    case 'transactions':
      return ArrowLeftRight
    case 'policies':
      return CalendarClock
    case 'financials':
      return CircleDollarSign
    case 'recoveries':
      return RotateCcw
    default:
      return FileText
  }
}

export function NotificationBell() {
  const { profile } = useAuth()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<OperationalNotification[]>([])
  const [badgeCount, setBadgeCount] = useState(0)
  const [producerLimitation, setProducerLimitation] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchOperationalNotifications({
      role: roleInputFromProfile(profile),
      fullName: profile?.fullName,
      email: profile?.email,
      profileId: profile?.id,
      linkedProducerName: profile?.linkedProducerName,
    })
    setItems(result.items.slice(0, 12))
    setBadgeCount(result.badgeCount)
    setProducerLimitation(result.producerLimitation)
    setError(result.error)
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    function onPointerDown(event: MouseEvent | PointerEvent) {
      const target = event.target as Node | null
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const badge = formatBadgeCount(badgeCount)

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alza-blue-500/40"
        aria-label={badgeCount > 0 ? `Notifications, ${badgeCount} actionable` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev
            if (next) void load()
            return next
          })
        }}
      >
        <Bell className="h-5 w-5" />
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-alza-teal-500 px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 flex max-h-[min(28rem,70vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
              <p className="text-xs text-slate-500">
                {badgeCount === 0 ? 'No unread items' : `${badgeCount} unread`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-alza-blue-700 hover:text-alza-blue-800"
              >
                View all
              </Link>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Loading notifications…</p>
            ) : error ? (
              <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>
            ) : (
              <>
                {producerLimitation && (
                  <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                    {producerLimitation}
                  </div>
                )}
                {items.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <Bell className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-2 text-sm font-medium text-slate-900">All clear</p>
                    <p className="mt-1 text-xs text-slate-500">No live operational alerts right now.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const Icon = categoryIcon(item.category)
                      return (
                        <li key={item.id}>
                          <Link
                            to={item.href}
                            onClick={() => setOpen(false)}
                            className={`flex gap-3 px-4 py-3 transition-colors hover:bg-alza-blue-50/50 ${
                              item.read ? 'bg-white' : 'bg-alza-blue-50/40'
                            }`}
                          >
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className={`text-sm ${item.read ? 'font-medium text-slate-800' : 'font-semibold text-slate-900'}`}>
                                  {item.title}
                                </p>
                                {!item.read && (
                                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-alza-teal-500" aria-label="Unread" />
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-600">{item.context}</p>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-400">{item.dateLabel || '—'}</span>
                                <span className="text-[11px] font-medium text-alza-blue-700">
                                  {item.actionLabel}
                                </span>
                              </div>
                            </div>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
