import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LifeBuoy, MessageSquarePlus, ArrowLeft } from 'lucide-react'
import { SortableTh } from '../components/ui/SortableTh'
import { useAuth } from '../lib/auth'
import { canAccessSupportCenter, roleInputFromProfile } from '../lib/permissions'
import {
  SUPPORT_CATEGORIES,
  createSupportRequest,
  fetchSupportConversation,
  fetchSupportConversations,
  fetchSupportMessages,
  reopenSupportConversation,
  replyToSupportConversation,
  resolveSupportConversation,
  supportCategoryLabel,
  supportPriorityLabel,
  supportStatusClass,
  supportStatusLabel,
  type SupportCategory,
  type SupportConversation,
  type SupportMessage,
  type SupportPriority,
} from '../lib/support'
import { nextTableSort, sortRows, type TableSortState } from '../lib/tableSort'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

type Tab = 'open' | 'resolved' | 'all'

export function SupportCenterPage() {
  const { profile } = useAuth()
  const role = roleInputFromProfile(profile)
  const allowed = canAccessSupportCenter(role)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('c')

  const [tab, setTab] = useState<Tab>('open')
  const [rows, setRows] = useState<SupportConversation[]>([])
  const [sort, setSort] = useState<TableSortState<'subject' | 'category' | 'status' | 'updatedAt'>>({
    key: 'updatedAt',
    direction: 'desc',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [selected, setSelected] = useState<SupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const [category, setCategory] = useState<SupportCategory>('other')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [priority, setPriority] = useState<SupportPriority>('normal')

  useEffect(() => {
    const cat = searchParams.get('category')
    const sub = searchParams.get('subject')
    if (cat && SUPPORT_CATEGORIES.some((c) => c.value === cat)) {
      setCategory(cat as SupportCategory)
      setComposerOpen(true)
    }
    if (sub) {
      setSubject(sub)
      setComposerOpen(true)
    }
  }, [searchParams])

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchSupportConversations({ tab })
    if (result.error) setError(result.error)
    setRows(result.data)
    setLoading(false)
  }, [tab])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    const [conv, msgs] = await Promise.all([fetchSupportConversation(id), fetchSupportMessages(id)])
    if (conv.error) setError(conv.error)
    setSelected(conv.data)
    setMessages(msgs.data)
    setDetailLoading(false)
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    const result = await createSupportRequest({
      category,
      subject,
      message,
      priority,
      profile,
    })
    setBusy(false)
    if (result.error || !result.data) {
      setError(result.error ?? 'Could not create support request.')
      return
    }
    setSuccess('Support request created.')
    setComposerOpen(false)
    setSubject('')
    setMessage('')
    setCategory('other')
    setPriority('normal')
    await loadList()
    openConversation(result.data.id)
  }

  async function handleReply() {
    if (!profile || !selectedId || busy) return
    setBusy(true)
    setError(null)
    const result = await replyToSupportConversation({
      conversationId: selectedId,
      body: reply,
      profile,
      asAlza: false,
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

  async function handleReopen() {
    if (!profile || !selectedId) return
    setBusy(true)
    const result = await reopenSupportConversation({ conversationId: selectedId, profile })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await loadDetail(selectedId)
    await loadList()
  }

  async function handleResolve() {
    if (!profile || !selectedId) return
    setBusy(true)
    setError(null)
    const result = await resolveSupportConversation({ conversationId: selectedId, profile })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await loadDetail(selectedId)
    await loadList()
  }

  const listTitle = useMemo(() => {
    if (tab === 'open') return 'Open'
    if (tab === 'resolved') return 'Resolved'
    return 'All'
  }, [tab])

  const sortedRows = useMemo(
    () =>
      sortRows(
        rows,
        sort,
        {
          subject: (r) => r.subject,
          category: (r) => r.category,
          status: (r) => r.status,
          updatedAt: (r) => r.updatedAt,
        },
        { updatedAt: 'date' },
      ),
    [rows, sort],
  )

  if (!allowed) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        You do not have access to Support Center.
      </div>
    )
  }

  if (selectedId && detailLoading) {
    return <p className="text-sm text-slate-500">Loading conversation…</p>
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
          Back to Support Center
        </button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This support conversation is not available. It may belong to another agency or no longer exist.
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
          Back to Support Center
        </button>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{selected.subject}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {supportCategoryLabel(selected.category)} · {supportPriorityLabel(selected.priority)}
              </p>
            </div>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${supportStatusClass(selected.status)}`}
            >
              {supportStatusLabel(selected.status)}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Created</dt>
              <dd className="mt-0.5 text-slate-800">{formatWhen(selected.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Agency</dt>
              <dd className="mt-0.5 text-slate-800">{selected.agencyName || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Opened by</dt>
              <dd className="mt-0.5 text-slate-800">{selected.createdByName || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Updated</dt>
              <dd className="mt-0.5 text-slate-800">{formatWhen(selected.updatedAt)}</dd>
            </div>
          </dl>
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
                    {isAlza
                      ? m.senderName
                        ? `ALZA Support · ${m.senderName}`
                        : 'ALZA Support'
                      : m.senderName || 'Agency User'}
                  </p>
                  <p className="text-xs text-slate-500">{formatWhen(m.createdAt)}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
              </div>
            )
          })}
          {messages.length === 0 && (
            <p className="text-sm text-slate-500">No messages yet.</p>
          )}
        </div>

        {selected.status === 'resolved' ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">This conversation is resolved.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleReopen()}
              className="mt-3 h-10 rounded-lg bg-alza-blue-700 px-4 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
            >
              Reopen conversation
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Your reply</span>
              <textarea
                rows={4}
                className={textareaClass}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type your reply…"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !reply.trim()}
                onClick={() => void handleReply()}
                className="h-10 rounded-lg bg-alza-blue-700 px-4 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
              >
                Send Reply
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleResolve()}
                className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <LifeBuoy className="h-6 w-6 text-alza-blue-700" />
            Help &amp; Support
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Submit a request to ALZA Support and track the full conversation for your agency.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setComposerOpen(true)
            setSuccess(null)
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-alza-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-alza-blue-800"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Support Request
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        {(
          [
            ['open', 'Open'],
            ['resolved', 'Resolved'],
            ['all', 'All'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id
                ? 'border-alza-blue-700 text-alza-blue-800'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <SortableTh
                active={sort.key === 'subject'}
                direction={sort.direction}
                onSort={() => setSort((s) => nextTableSort(s, 'subject'))}
              >
                Subject
              </SortableTh>
              <SortableTh
                active={sort.key === 'category'}
                direction={sort.direction}
                onSort={() => setSort((s) => nextTableSort(s, 'category'))}
              >
                Category
              </SortableTh>
              <SortableTh
                active={sort.key === 'status'}
                direction={sort.direction}
                onSort={() => setSort((s) => nextTableSort(s, 'status'))}
              >
                Status
              </SortableTh>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Last Reply
              </th>
              <SortableTh
                active={sort.key === 'updatedAt'}
                direction={sort.direction}
                onSort={() => setSort((s) => nextTableSort(s, 'updatedAt'))}
              >
                Updated
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading {listTitle.toLowerCase()} conversations…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No support requests yet. Create one if you need help from ALZA.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => openConversation(row.id)}
              >
                <td className="px-4 py-3 font-medium text-slate-900">{row.subject}</td>
                <td className="px-4 py-3 text-slate-700">{supportCategoryLabel(row.category)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${supportStatusClass(row.status)}`}
                  >
                    {supportStatusLabel(row.status)}
                  </span>
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                  {row.lastMessagePreview || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatWhen(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {composerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">New Support Request</h2>
            <p className="mt-1 text-sm text-slate-500">Tell ALZA what you need help with.</p>
            <form className="mt-4 space-y-3" onSubmit={(e) => void handleCreate(e)}>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Category *</span>
                <select
                  className={selectClass}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SupportCategory)}
                  required
                >
                  {SUPPORT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Subject *</span>
                <input
                  className={inputClass}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="Short summary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Message *</span>
                <textarea
                  className={textareaClass}
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  maxLength={10000}
                  placeholder="Describe the issue or question"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Priority</span>
                <select
                  className={selectClass}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as SupportPriority)}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setComposerOpen(false)}
                  className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-10 rounded-lg bg-alza-blue-700 px-4 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
                >
                  {busy ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
