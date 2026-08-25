import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Headphones, Plus, Search, Users, X } from 'lucide-react'
import { ExportMenu } from '../../components/ui/ExportMenu'
import { SearchInput } from '../../components/ui/SearchInput'
import { SortableTh } from '../../components/ui/SortableTh'
import { useAuth } from '../../lib/auth'
import { archiveCsr, createCsr, isAdminDirectoryRole, updateCsr } from '../../lib/directory'
import { csrExportColumns } from '../../lib/exportDefinitions'
import { downloadTableExport } from '../../lib/tableExport'
import {
  DIRECTORY_NAME_SORT,
  nextTableSort,
  sortRows,
  type TableSortState,
} from '../../lib/tableSort'
import { supabase } from '../../lib/supabase'

type CSRStatus = 'active' | 'inactive'

interface CSR {
  id: string
  name: string
  email: string
  phone: string
  status: CSRStatus
  notes: string
}

const PAGE_SIZE = 10
const ALL = 'all'

const statusLabels: Record<CSRStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const statusStyles: Record<CSRStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function normalizeStatus(value: string | null): CSRStatus {
  return (value ?? '').toLowerCase() === 'inactive' ? 'inactive' : 'active'
}

export function CSRs() {
  const { profile } = useAuth()
  const canMutate = isAdminDirectoryRole(profile?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const statusFilter = searchParams.get('status') ?? ALL
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<TableSortState<'name' | 'email' | 'phone' | 'status'>>(
    DIRECTORY_NAME_SORT,
  )
  const [rows, setRows] = useState<CSR[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [selected, setSelected] = useState<CSR | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [form, setForm] = useState({
    csrName: '',
    email: '',
    phone: '',
    status: 'active',
    notes: '',
  })

  const loadRows = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    const { data, error } = await supabase
      .from('csrs')
      .select('id, csr_name, email, phone, status, notes, archived_at')
      .is('archived_at', null)
      .order('csr_name', { ascending: true })

    if (error) {
      setFetchError(error.message)
      setRows([])
    } else {
      setRows(
        (data ?? []).map((row) => ({
          id: row.id as string,
          name: String(row.csr_name ?? '').trim() || '—',
          email: String(row.email ?? '').trim(),
          phone: String(row.phone ?? '').trim(),
          status: normalizeStatus(row.status as string | null),
          notes: String(row.notes ?? '').trim(),
        })),
      )
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, sort])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== ALL && r.status !== statusFilter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        statusLabels[r.status].toLowerCase().includes(q)
      )
    })
  }, [rows, search, statusFilter])

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        name: (r) => r.name,
        email: (r) => r.email,
        phone: (r) => r.phone,
        status: (r) => r.status,
      }),
    [filtered, sort],
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const activeCount = rows.filter((r) => r.status === 'active').length

  function setParam(key: string, value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === ALL) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  function openAdd() {
    setSelected(null)
    setForm({ csrName: '', email: '', phone: '', status: 'active', notes: '' })
    setFormError(null)
    setArchiveConfirm(false)
    setModalMode('add')
  }

  function openEdit(csr: CSR) {
    setSelected(csr)
    setForm({
      csrName: csr.name,
      email: csr.email,
      phone: csr.phone,
      status: csr.status,
      notes: csr.notes,
    })
    setFormError(null)
    setArchiveConfirm(false)
    setModalMode('edit')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canMutate || saving) return
    setSaving(true)
    setFormError(null)

    if (modalMode === 'add') {
      const result = await createCsr(form)
      setSaving(false)
      if (result.error) {
        setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
        return
      }
    } else if (modalMode === 'edit' && selected) {
      const result = await updateCsr({
        id: selected.id,
        email: form.email,
        phone: form.phone,
        status: form.status,
        notes: form.notes,
      })
      setSaving(false)
      if (result.error) {
        setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
        return
      }
    }

    setModalMode(null)
    await loadRows()
  }

  async function handleArchive() {
    if (!canMutate || !selected || saving) return
    setSaving(true)
    setFormError(null)
    const result = await archiveCsr(selected.id)
    setSaving(false)
    if (result.error) {
      setFormError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
      setArchiveConfirm(false)
      return
    }
    setModalMode(null)
    setArchiveConfirm(false)
    await loadRows()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <SearchInput
              value={search}
              onChange={(e) => setParam('search', e.currentTarget.value)}
              onSearch={(e) => setParam('search', e.currentTarget.value)}
              placeholder="Search CSRs..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setParam('status', e.target.value)} className={`${selectClassName} sm:w-40`}>
            <option value={ALL}>All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <ExportMenu
            rowCount={filtered.length}
            disabled={loading}
            onExport={(format) =>
              downloadTableExport({
                format,
                sheetName: 'CSRs',
                columns: csrExportColumns,
                rows: filtered,
                filenameBase: 'CSRs',
                label: 'CSRs',
              })
            }
          />
        </div>
        {canMutate && (
          <button type="button" onClick={openAdd} className="inline-flex items-center justify-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90">
            <Plus className="h-4 w-4" />
            Add CSR
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total CSRs</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
              <Headphones className="h-5 w-5 text-alza-blue-600" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Active CSRs</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{activeCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Users className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
        </div>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load CSRs: {fetchError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {(
                  [
                    ['name', 'CSR'],
                    ['email', 'Email'],
                    ['phone', 'Phone'],
                    ['status', 'Status'],
                  ] as const
                ).map(([key, col]) => (
                  <SortableTh
                    key={key}
                    className="px-6"
                    active={sort.key === key}
                    direction={sort.direction}
                    onSort={() => setSort((s) => nextTableSort(s, key))}
                  >
                    {col}
                  </SortableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-600">Loading CSRs...</td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-500">No CSRs found</td>
                </tr>
              ) : (
                paginated.map((csr) => (
                  <tr
                    key={csr.id}
                    onClick={() => canMutate && openEdit(csr)}
                    className={canMutate ? 'cursor-pointer hover:bg-alza-blue-50/60' : 'hover:bg-alza-blue-50/40'}
                  >
                    <td className="px-6 py-4 text-sm font-medium text-alza-blue-700">{csr.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-700">{csr.email || '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-700">{csr.phone || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[csr.status]}`}>
                        {statusLabels[csr.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-sm text-slate-600">Page {currentPage} of {totalPages}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={() => !saving && setModalMode(null)} />
          <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{modalMode === 'add' ? 'Add CSR' : 'Edit CSR'}</h3>
              <button type="button" disabled={saving} onClick={() => setModalMode(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
              {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">CSR name *</label>
                <input
                  required
                  disabled={modalMode === 'edit'}
                  className={`${inputClassName} ${modalMode === 'edit' ? 'bg-slate-50 text-slate-600' : ''}`}
                  value={form.csrName}
                  onChange={(e) => setForm((f) => ({ ...f, csrName: e.target.value }))}
                />
                {modalMode === 'edit' && (
                  <p className="mt-1 text-xs text-slate-500">
                    Name is locked because clients, policies, and transactions store the CSR as text.
                  </p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Email</label>
                  <input type="email" className={inputClassName} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Phone</label>
                  <input className={inputClassName} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Status</label>
                <select className={selectClassName} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">Notes</label>
                <textarea rows={3} className={textareaClassName} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              {modalMode === 'edit' && archiveConfirm && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <p className="font-medium">Archive this CSR?</p>
                  <p className="mt-1 text-amber-800">Soft-archives the record (sets archived_at). Historical text references are unchanged.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={saving} onClick={() => setArchiveConfirm(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">Cancel</button>
                    <button type="button" disabled={saving} onClick={() => void handleArchive()} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60">
                      {saving ? 'Archiving…' : 'Confirm archive'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                {modalMode === 'edit' && !archiveConfirm ? (
                  <button type="button" disabled={saving} onClick={() => setArchiveConfirm(true)} className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
                    Soft Archive
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={saving} onClick={() => setModalMode(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving || archiveConfirm} className="rounded-lg gradient-alza px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
