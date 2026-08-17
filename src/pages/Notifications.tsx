import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  CircleDollarSign,
  FileText,
  RotateCcw,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import {
  fetchOperationalNotifications,
  markAllNotificationsRead,
  markNotificationReadState,
  matchesReviewQueueFilter,
  notificationCategoryLabel,
  type NotificationCategory,
  type OperationalNotification,
  type ReviewQueueFilter,
} from '../lib/notifications'
import { roleInputFromProfile } from '../lib/permissions'

const ALL = 'all'

const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

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

export function NotificationsPage() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<OperationalNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [producerLimitation, setProducerLimitation] = useState<string | null>(null)
  const [category, setCategory] = useState<string>(ALL)
  const [kindFilter, setKindFilter] = useState<string>(ALL)
  const [queueFilter, setQueueFilter] = useState<ReviewQueueFilter>(
    (searchParams.get('queue') as ReviewQueueFilter) || 'all',
  )
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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
    setItems(result.items)
    setProducerLimitation(result.producerLimitation)
    setError(result.error)
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const q = searchParams.get('queue')
    if (q === 'assigned' || q === 'submitted' || q === 'returned' || q === 'approved' || q === 'all') {
      setQueueFilter(q)
    }
  }, [searchParams])

  const kindOptions = useMemo(
    () => [...new Set(items.map((item) => item.kind))].sort(),
    [items],
  )

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (category !== ALL && item.category !== category) return false
      if (kindFilter !== ALL && item.kind !== kindFilter) return false
      if (!matchesReviewQueueFilter(item, queueFilter)) return false
      const date = (item.dateLabel || '').slice(0, 10)
      if (dateFrom && (!date || date < dateFrom)) return false
      if (dateTo && (!date || date > dateTo)) return false
      return true
    })
  }, [items, category, kindFilter, queueFilter, dateFrom, dateTo])

  async function setRead(item: OperationalNotification, read: boolean) {
    if (!profile?.id) return
    setSaving(true)
    setError(null)
    const result = await markNotificationReadState({
      userId: profile.id,
      notificationKey: item.id,
      read,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await load()
  }

  async function markAllRead() {
    if (!profile?.id) return
    setSaving(true)
    setError(null)
    const result = await markAllNotificationsRead({
      userId: profile.id,
      notificationKeys: filtered.map((item) => item.id),
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await load()
  }

  const tabs: { id: string; label: string }[] = [
    { id: ALL, label: 'All' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'policies', label: 'Policies / Renewals' },
    { id: 'financials', label: 'Financials' },
    { id: 'recoveries', label: 'Recoveries' },
  ]

  const queueTabs: { id: ReviewQueueFilter; label: string }[] = [
    { id: 'all', label: 'All queues' },
    { id: 'assigned', label: 'Assigned to me' },
    { id: 'submitted', label: 'Submitted' },
    { id: 'returned', label: 'Returned' },
    { id: 'approved', label: 'Approved' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-6 w-6 text-alza-blue-700" />
            <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Live operational alerts with per-user read/unread state. Badge counts unread items only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || filtered.length === 0}
            onClick={() => void markAllRead()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Mark All as Read
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {producerLimitation && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {producerLimitation}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {tabs.map((tab) => {
          const active = category === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border border-b-white border-slate-200 bg-white text-alza-blue-700'
                  : 'border border-transparent text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {queueTabs.map((tab) => {
          const active = queueFilter === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setQueueFilter(tab.id)
                const next = new URLSearchParams(searchParams)
                if (tab.id === 'all') next.delete('queue')
                else next.set('queue', tab.id)
                setSearchParams(next, { replace: true })
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
                active
                  ? 'bg-alza-blue-50 text-alza-blue-800 ring-alza-blue-600/20'
                  : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Status / type</label>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className={selectClassName}
          >
            <option value={ALL}>All actionable</option>
            {kindOptions.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Date from</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={selectClassName}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Date to</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={selectClassName}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="px-6 py-12 text-center text-sm text-slate-500">Loading notifications…</p>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Bell className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-900">No notifications match these filters</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((item) => {
              const Icon = categoryIcon(item.category)
              return (
                <li key={item.id} className={item.read ? 'bg-white' : 'bg-alza-blue-50/30'}>
                  <div className="flex gap-4 px-6 py-4">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-sm ${item.read ? 'font-medium text-slate-800' : 'font-semibold text-slate-900'}`}>
                          {item.title}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {notificationCategoryLabel(item.category)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            item.read
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-alza-teal-50 text-alza-teal-800'
                          }`}
                        >
                          {item.read ? 'Read' : 'Unread'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.context}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Link
                          to={item.href}
                          className="rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-3 py-1.5 text-xs font-medium text-alza-blue-800 hover:bg-alza-blue-100"
                        >
                          {item.actionLabel}
                        </Link>
                        {item.read ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void setRead(item, false)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Mark as Unread
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void setRead(item, true)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Mark as Read
                          </button>
                        )}
                        <span className="ml-auto text-xs text-slate-400">{item.dateLabel || '—'}</span>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
