import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Headphones, ArrowLeft, Search } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { canAccessAlzaSupportInbox, roleInputFromProfile } from '../../lib/permissions'
import {
  SUPPORT_CATEGORIES,
  fetchSupportConversation,
  fetchSupportConversations,
  fetchSupportMessages,
  reopenSupportConversation,
  replyToSupportConversation,
  resolveSupportConversation,
  setSupportWaitingStatus,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusClass,
  supportStatusLabelForAlza,
  type SupportCategory,
  type SupportConversation,
  type SupportMessage,
  type SupportStatus,
} from '../../lib/support'

const selectClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function ageLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const hours = Math.max(0, Math.round((Date.now() - t) / (1000 * 60 * 60)))
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function AlzaSupportInboxPage() {
  const { profile } = useAuth()
  const role = roleInputFromProfile(profile)
  const allowed = canAccessAlzaSupportInbox(role)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('c')

  const [statusFilter, setStatusFilter] = useState<SupportStatus | 'all'>('waiting_on_alza')
  const [categoryFilter, setCategoryFilter] = useState<SupportCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<SupportConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchSupportConversations({
      forAlzaInbox: true,
      status: statusFilter,
      category: categoryFilter,
      search,
      tab: 'all',
    })
    if (result.error) setError(result.error)
    setRows(result.data)
    setLoading(false)
  }, [statusFilter, categoryFilter, search])

  const loadDetail = useCallback(async (id: string) => {
    const [conv, msgs] = await Promise.all([fetchSupportConversation(id), fetchSupportMessages(id)])
    if (conv.error) setError(conv.error)
    setSelected(conv.data)
    setMessages(msgs.data)
  }, [])

  useEffect(() => {
    if (!allowed) return
    void loadList()
  }, [allowed, loadList])

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      setMessages([])
      return
    }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  function openConversation(id: string | null) {
    if (!id) {
      setSearchParams({}, { replace: true })
      return
    }
    setSearchParams({ c: id }, { replace: true })
  }

  async function handleReply() {
    if (!profile || !selectedId) return
    setBusy(true)
    setError(null)
    const result = await replyToSupportConversation({
      conversationId: selectedId,
      body: reply,
      profile,
      asAlza: true,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setReply('')
    await loadDetail(selectedId)
    await loadList()
  }

  async function handleResolve() {
    if (!profile || !selectedId) return
    setBusy(true)
    const result = await resolveSupportConversation({ conversationId: selectedId, profile })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await loadDetail(selectedId)
    await loadList()
  }

  async function handleReopen() {
    if (!profile || !selectedId) return
    setBusy(true)
    const result = await reopenSupportConversation({
      conversationId: selectedId,
      profile,
      asAlza: true,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await loadDetail(selectedId)
    await loadList()
  }

  async function handleWaiting(status: 'waiting_on_customer' | 'waiting_on_alza') {
    if (!profile || !selectedId) return
    setBusy(true)
    const result = await setSupportWaitingStatus({ conversationId: selectedId, status, profile })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await loadDetail(selectedId)
    await loadList()
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        ALZA Support Inbox is only available to ALZA platform support staff.
      </div>
    )
  }

  if (selectedId && !selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => openConversation(null)}
          className="inline-flex items-center gap-1 text-sm font-medium text-alza-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support Inbox
        </button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Conversation not found or not visible.
        </div>
      </div>
    )
  }

  if (selectedId && selected) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => openConversation(null)}
          className="inline-flex items-center gap-1 text-sm font-medium text-alza-blue-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support Inbox
        </button>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{selected.subject}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {selected.agencyName || 'Agency'} · {supportCategoryLabel(selected.category)} ·{' '}
                {supportPriorityLabel(selected.priority)}
              </p>
            </div>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${supportStatusClass(selected.status)}`}
            >
              {supportStatusLabelForAlza(selected.status)}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Opened by</dt>
              <dd className="mt-0.5 text-slate-800">{selected.createdByName || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Created</dt>
              <dd className="mt-0.5 text-slate-800">{formatWhen(selected.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Updated</dt>
              <dd className="mt-0.5 text-slate-800">{formatWhen(selected.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Assigned</dt>
              <dd className="mt-0.5 text-slate-800">{selected.assignedToName || 'Unassigned'}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.status !== 'resolved' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve()}
                  className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Resolve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleWaiting('waiting_on_customer')}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Waiting on Customer
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleWaiting('waiting_on_alza')}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Waiting on ALZA
                </button>
              </>
            )}
            {selected.status === 'resolved' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleReopen()}
                className="h-9 rounded-lg bg-alza-blue-700 px-3 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
              >
                Reopen
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {messages.map((m) => {
            const isAlza = m.senderType === 'alza_support'
            return (
              <div
                key={m.id}
                className={`rounded-xl border px-4 py-3 shadow-sm ${
                  isAlza ? 'border-alza-blue-100 bg-alza-blue-50/40' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {isAlza ? 'ALZA Support' : m.senderName || 'Agency User'}
                  </p>
                  <p className="text-xs text-slate-500">{formatWhen(m.createdAt)}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
              </div>
            )
          })}
        </div>

        {selected.status !== 'resolved' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Reply as ALZA Support</span>
              <textarea
                rows={4}
                className={textareaClass}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type your reply…"
              />
            </label>
            <button
              type="button"
              disabled={busy || !reply.trim()}
              onClick={() => void handleReply()}
              className="mt-3 h-10 rounded-lg bg-alza-blue-700 px-4 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
            >
              Send Reply
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <Headphones className="h-6 w-6 text-alza-blue-700" />
          ALZA Support Inbox
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Cross-agency support requests for ALZA Business Solutions staff.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, agency, message…"
          />
        </div>
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SupportStatus | 'all')}
        >
          <option value="all">All statuses</option>
          <option value="waiting_on_alza">Waiting on ALZA</option>
          <option value="waiting_on_customer">Waiting on Customer</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          className={selectClass}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as SupportCategory | 'all')}
        >
          <option value="all">All categories</option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Agency</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Message</th>
              <th className="px-4 py-3">Age</th>
              <th className="px-4 py-3">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading inbox…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No support requests match these filters.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => openConversation(row.id)}
              >
                <td className="px-4 py-3 font-medium text-slate-900">{row.agencyName || '—'}</td>
                <td className="px-4 py-3 text-slate-800">{row.subject}</td>
                <td className="px-4 py-3 text-slate-700">{supportCategoryLabel(row.category)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${supportStatusClass(row.status)}`}
                  >
                    {supportStatusLabelForAlza(row.status)}
                  </span>
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                  {row.lastMessagePreview || '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{ageLabel(row.updatedAt)}</td>
                <td className="px-4 py-3 text-slate-600">{row.assignedToName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
