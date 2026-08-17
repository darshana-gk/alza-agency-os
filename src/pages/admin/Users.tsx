import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Search, UserCircle, X } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import {
  APP_ROLES,
  canChangeUserRole,
  canChangeUserStatus,
  canManageUsers,
  normalizeAppRole,
  primaryAppRole,
  toAppRoles,
  type AppRole,
} from '../../lib/permissions'
import { syncProducerDirectoryForUser, fetchProducerLinkOptions, suggestProducerLinkId, type ProducerLinkOption } from '../../lib/directory'
import { supabase } from '../../lib/supabase'

type UserStatus = 'active' | 'inactive'
type InviteStatus = 'pending' | 'accepted' | null
type AuthLinkLabel = 'Active' | 'Invitation Pending' | 'Unlinked'

interface ManagedUser {
  id: string
  authUserId: string | null
  fullName: string
  email: string
  role: AppRole | string
  roles: AppRole[]
  status: UserStatus
  archivedAt: string | null
  invitedAt: string | null
  inviteStatus: InviteStatus
}

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function normalizeStatus(value: string | null): UserStatus {
  return (value ?? '').toLowerCase() === 'active' ? 'active' : 'inactive'
}

function normalizeInviteStatus(value: string | null | undefined): InviteStatus {
  const v = (value ?? '').toLowerCase()
  if (v === 'pending' || v === 'accepted') return v
  return null
}

/**
 * Auth / invite column — driven by invite_status (+ Auth link), not a cosmetic rename.
 * pending → Invitation Pending; accepted or linked non-pending → Active; else Unlinked.
 */
function authLinkLabel(user: ManagedUser): AuthLinkLabel {
  if (user.inviteStatus === 'pending') return 'Invitation Pending'
  if (user.inviteStatus === 'accepted') return 'Active'
  if (user.authUserId) return 'Active'
  if (user.invitedAt) return 'Invitation Pending'
  return 'Unlinked'
}

/** Owner/Admin may resend only for active, pending, linked Auth invites. */
function canResendInvite(user: ManagedUser, actorRole: AppRole | null): boolean {
  if (actorRole !== 'owner' && actorRole !== 'admin') return false
  if (actorRole === 'admin' && normalizeAppRole(user.role) === 'owner') return false
  if (user.status !== 'active') return false
  if (user.archivedAt) return false
  if (!user.authUserId) return false
  if (user.inviteStatus !== 'pending') return false
  if (!user.email || user.email === '—') return false
  return true
}

type InviteFnPayload = {
  ok?: boolean
  code?: string
  message?: string
  error?: string
  action?: string
  user_id?: string
}

/** Extract safe server message from functions.invoke result (including non-2xx bodies). */
async function readInviteFunctionResult(
  data: unknown,
  error: { message?: string; name?: string; context?: Response } | null,
): Promise<{ ok: true; data: InviteFnPayload } | { ok: false; message: string; setupRequired: boolean }> {
  let payload: InviteFnPayload | null =
    data && typeof data === 'object' ? (data as InviteFnPayload) : null

  // Non-2xx responses often land in error.context; parse body so we don't mask runtime codes.
  if (error?.context && typeof (error.context as Response).json === 'function') {
    try {
      const response = error.context as Response
      const body = (await (typeof response.clone === 'function' ? response.clone() : response).json()) as InviteFnPayload
      if (body && typeof body === 'object') {
        payload = body
      }
    } catch {
      // ignore JSON parse failures; fall through to transport message
    }
  }

  if (payload?.ok === true) {
    return { ok: true, data: payload }
  }

  const serverMessage =
    (typeof payload?.message === 'string' && payload.message.trim()) ||
    (typeof payload?.error === 'string' && payload.error.trim()) ||
    null

  if (serverMessage) {
    return { ok: false, message: serverMessage, setupRequired: false }
  }

  const transport = (error?.message || '').trim()
  const lower = transport.toLowerCase()
  const setupRequired =
    lower.includes('failed to send a request') ||
    lower.includes('not found') ||
    lower.includes('404') ||
    (lower.includes('edge function') && lower.includes('not found'))

  if (setupRequired) {
    return {
      ok: false,
      message:
        'Setup required: secure invite is not available yet. Deploy Edge Function invite-alza-user (service_role stays server-side).',
      setupRequired: true,
    }
  }

  // Common supabase-js wrapper when function returned non-2xx without a parsed body.
  if (lower.includes('non-2xx') || lower.includes('edge function returned')) {
    return {
      ok: false,
      message: 'Invite request failed with an unexpected server response. Try again or check function logs.',
      setupRequired: false,
    }
  }

  return {
    ok: false,
    message: transport || 'Invite request failed.',
    setupRequired: false,
  }
}

const roleStyles: Record<string, string> = {
  owner: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  admin: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
  csr: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  producer: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  viewer: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

const statusStyles: Record<UserStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

const authLinkStyles: Record<AuthLinkLabel, string> = {
  Active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Invitation Pending': 'bg-amber-50 text-amber-800 ring-amber-600/20',
  Unlinked: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export function UsersPage() {
  const { profile } = useAuth()
  const canManage = canManageUsers(profile?.role)
  const actorRole = normalizeAppRole(profile?.role)
  const [rows, setRows] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ManagedUser | null>(null)
  const [fullNameValue, setFullNameValue] = useState('')
  const [roleValue, setRoleValue] = useState<AppRole>('viewer')
  const [rolesValue, setRolesValue] = useState<AppRole[]>(['viewer'])
  const [statusValue, setStatusValue] = useState<UserStatus>('active')
  const [defaultSplitValue, setDefaultSplitValue] = useState('')
  const [linkedProducerId, setLinkedProducerId] = useState('')
  const [producerLinkOptions, setProducerLinkOptions] = useState<ProducerLinkOption[]>([])
  const [producerLinkHint, setProducerLinkHint] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    fullName: '',
    email: '',
    role: 'viewer' as AppRole,
    roles: ['viewer'] as AppRole[],
    status: 'active' as UserStatus,
    defaultSplit: '',
    linkedProducerId: '',
  })
  const [addProducerOptions, setAddProducerOptions] = useState<ProducerLinkOption[]>([])
  const [addProducerHint, setAddProducerHint] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const ownerCount = useMemo(
    () => rows.filter((u) => normalizeAppRole(u.role) === 'owner' && u.status === 'active' && !u.archivedAt).length,
    [rows],
  )

  const loadRows = useCallback(async () => {
    setLoading(true)
    setFetchError(null)

    let query = supabase
      .from('users')
      .select('id, auth_user_id, full_name, email, role, status, archived_at, invited_at, invite_status')
      .is('archived_at', null)
      .order('full_name', { ascending: true })

    let { data, error } = await query

    // Migration may not be applied yet — fall back without invite columns.
    if (error && (error.message.includes('invited_at') || error.message.includes('invite_status'))) {
      const fallback = await supabase
        .from('users')
        .select('id, auth_user_id, full_name, email, role, status, archived_at')
        .is('archived_at', null)
        .order('full_name', { ascending: true })
      data = (fallback.data ?? []).map((row) => ({
        ...row,
        invited_at: null,
        invite_status: null,
      })) as typeof data
      error = fallback.error
    }

    if (error) {
      setFetchError(error.message)
      setRows([])
    } else {
      const baseRows = (data ?? []).map((row) => ({
        id: row.id as string,
        authUserId: (row.auth_user_id as string | null) ?? null,
        fullName: String(row.full_name ?? '').trim() || '—',
        email: String(row.email ?? '').trim() || '—',
        role: String(row.role ?? '').trim().toLowerCase() || 'viewer',
        roles: [] as AppRole[],
        status: normalizeStatus(row.status as string | null),
        archivedAt: (row.archived_at as string | null) ?? null,
        invitedAt: (row.invited_at as string | null) ?? null,
        inviteStatus: normalizeInviteStatus(row.invite_status as string | null),
      }))

      const ids = baseRows.map((r) => r.id)
      const rolesByUser = new Map<string, AppRole[]>()
      if (ids.length > 0) {
        const { data: roleRows } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('user_id', ids)
        for (const rr of roleRows ?? []) {
          const uid = String(rr.user_id)
          const role = normalizeAppRole(String(rr.role ?? ''))
          if (!role) continue
          const list = rolesByUser.get(uid) ?? []
          if (!list.includes(role)) list.push(role)
          rolesByUser.set(uid, list)
        }
      }

      setRows(
        baseRows.map((row) => {
          const fromTable = rolesByUser.get(row.id) ?? []
          const roles = toAppRoles([
            ...fromTable,
            normalizeAppRole(row.role) ?? 'viewer',
          ])
          return {
            ...row,
            roles: roles.length ? roles : (['viewer'] as AppRole[]),
            role: primaryAppRole(roles) ?? normalizeAppRole(row.role) ?? 'viewer',
          }
        }),
      )
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        String(u.role).toLowerCase().includes(q),
    )
  }, [rows, search])

  const assignableRoles = useMemo(() => {
    if (actorRole === 'admin') {
      return APP_ROLES.filter((r) => r !== 'owner')
    }
    // Owner may assign Owner (product rule already encoded in canChangeUserRole).
    return [...APP_ROLES]
  }, [actorRole])

  async function hydrateProducerLinkFields(params: {
    fullName: string
    email: string
    existingProducerId?: string | null
    forAdd?: boolean
  }) {
    const { data, error } = await fetchProducerLinkOptions()
    if (error) {
      if (params.forAdd) {
        setAddProducerOptions([])
        setAddProducerHint(`Could not load producers: ${error}`)
      } else {
        setProducerLinkOptions([])
        setProducerLinkHint(`Could not load producers: ${error}`)
      }
      return
    }

    const suggestion = suggestProducerLinkId({
      options: data,
      existingProducerId: params.existingProducerId,
      email: params.email,
      fullName: params.fullName,
    })

    const selectedId = suggestion.producerId ?? ''
    const selectedOption = data.find((o) => o.id === selectedId) ?? null
    const hint =
      suggestion.reason === 'linked'
        ? 'Using existing users.producer_id link.'
        : suggestion.reason === 'email'
          ? 'Auto-matched existing producer by login email.'
          : suggestion.reason === 'name'
            ? 'Suggested unique producer name match — confirm Linked Producer before saving.'
            : data.length > 0
              ? 'No safe auto-match. Select an existing producer or create a new directory row on save.'
              : 'No producer directory rows yet — a new row will be created on save.'

    if (params.forAdd) {
      setAddProducerOptions(data)
      setAddProducerHint(hint)
      setAddForm((f) => ({
        ...f,
        linkedProducerId: selectedId,
        defaultSplit:
          selectedOption?.defaultSplitPercentage != null
            ? String(selectedOption.defaultSplitPercentage)
            : f.defaultSplit,
      }))
      return
    }

    setProducerLinkOptions(data)
    setProducerLinkHint(hint)
    setLinkedProducerId(selectedId)
    if (selectedOption?.defaultSplitPercentage != null) {
      setDefaultSplitValue(String(selectedOption.defaultSplitPercentage))
    }
  }

  async function loadProducerLinkForUser(user: ManagedUser) {
    setDefaultSplitValue('')
    setLinkedProducerId('')
    setProducerLinkHint('Loading producer matches…')
    const email = user.email === '—' ? '' : user.email.trim().toLowerCase()
    const name = user.fullName === '—' ? '' : user.fullName.trim()
    const { data: linked } = await supabase
      .from('users')
      .select('producer_id')
      .eq('id', user.id)
      .maybeSingle()
    const existingProducerId = (linked?.producer_id as string | null) ?? null
    await hydrateProducerLinkFields({
      fullName: name,
      email,
      existingProducerId,
    })
  }

  function openEdit(user: ManagedUser) {
    setSelected(user)
    setFullNameValue(user.fullName === '—' ? '' : user.fullName)
    const roles = user.roles.length
      ? user.roles
      : ([normalizeAppRole(user.role) ?? 'viewer'] as AppRole[])
    setRolesValue(roles)
    setRoleValue((primaryAppRole(roles) ?? normalizeAppRole(user.role) ?? 'viewer') as AppRole)
    setStatusValue(user.status)
    setFormError(null)
    setSuccess(null)
    setActionError(null)
    setDefaultSplitValue('')
    setLinkedProducerId('')
    setProducerLinkHint(null)
    setProducerLinkOptions([])
    if (roles.includes('producer') || normalizeAppRole(user.role) === 'producer') {
      void loadProducerLinkForUser(user)
    }
  }

  function openAdd() {
    setAddOpen(true)
    setAddForm({
      fullName: '',
      email: '',
      role: 'viewer',
      roles: ['viewer'],
      status: 'active',
      defaultSplit: '',
      linkedProducerId: '',
    })
    setAddProducerOptions([])
    setAddProducerHint(null)
    setFormError(null)
    setSuccess(null)
    setActionError(null)
  }

  function parseOptionalSplit(raw: string): number | null | undefined {
    const t = raw.trim()
    if (!t) return null
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0 || n > 100) return undefined
    return n
  }

  function toggleRole(list: AppRole[], role: AppRole, checked: boolean): AppRole[] {
    if (checked) return toAppRoles([...list, role])
    const next = list.filter((r) => r !== role)
    return next.length ? next : (['viewer'] as AppRole[])
  }

  async function handleResendInvite(user: ManagedUser) {
    if (!canManage || !canResendInvite(user, actorRole) || resendingId) return

    const email = user.email.trim().toLowerCase()
    setResendingId(user.id)
    setActionError(null)
    setSuccess(null)

    const { data, error } = await supabase.functions.invoke('invite-alza-user', {
      body: {
        action: 'resend',
        email,
      },
    })

    setResendingId(null)

    const result = await readInviteFunctionResult(data, error)
    if (!result.ok) {
      setActionError(result.message)
      return
    }

    setSuccess(`Invitation resent to ${email}.`)
    await loadRows()
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!selected || !canManage) return

    const nextName = fullNameValue.trim()
    if (!nextName) {
      setFormError('Full name is required.')
      return
    }

    const targetIsSelf = selected.id === profile?.id
    const nextRoles = rolesValue.length ? rolesValue : ([roleValue] as AppRole[])
    const primary = primaryAppRole(nextRoles) ?? roleValue
    const roleCheck = canChangeUserRole({
      actorRole: profile?.role,
      targetRole: selected.role,
      nextRole: primary,
      ownerCount,
      targetIsSelf,
    })
    if (!roleCheck.allowed) {
      setFormError(roleCheck.reason)
      return
    }

    if (actorRole === 'admin' && nextRoles.includes('owner')) {
      setFormError('Admins cannot assign the Owner role.')
      return
    }

    const statusCheck = canChangeUserStatus({
      actorRole: profile?.role,
      targetRole: selected.role,
      targetIsSelf,
      ownerCount,
      nextStatus: statusValue,
    })
    if (!statusCheck.allowed) {
      setFormError(statusCheck.reason)
      return
    }

    setSaving(true)
    setFormError(null)
    const { error } = await supabase
      .from('users')
      .update({
        full_name: nextName,
        role: primary,
        status: statusValue,
      })
      .eq('id', selected.id)
      .is('archived_at', null)

    if (error) {
      setSaving(false)
      setFormError(error.message)
      return
    }

    // Sync additive roles (preserve historical users.role primary).
    await supabase.from('user_roles').delete().eq('user_id', selected.id)
    const { error: rolesError } = await supabase.from('user_roles').insert(
      nextRoles.map((role) => ({ user_id: selected.id, role })),
    )
    if (rolesError) {
      setSaving(false)
      setFormError(`Profile updated, but roles sync failed: ${rolesError.message}`)
      await loadRows()
      return
    }

    const hasProducer = nextRoles.includes('producer')
    let split: number | null | undefined
    if (hasProducer) {
      split = parseOptionalSplit(defaultSplitValue)
      if (split === undefined) {
        setSaving(false)
        setFormError('Default Producer Split % must be between 0 and 100 (or blank).')
        return
      }
    }

    const sync = await syncProducerDirectoryForUser({
      userId: selected.id,
      fullName: nextName,
      email: selected.email === '—' ? '' : selected.email,
      hasProducerRole: hasProducer,
      userStatus: statusValue,
      defaultSplitPercentage: hasProducer ? split ?? null : undefined,
      preferredProducerId: hasProducer ? linkedProducerId || null : undefined,
    })
    setSaving(false)
    if (sync.error) {
      setFormError(`Profile updated, but producer directory sync failed: ${sync.error}`)
      await loadRows()
      return
    }

    const hadProducer =
      selected.roles.includes('producer') || normalizeAppRole(selected.role) === 'producer'
    setSuccess(
      hasProducer
        ? `Updated ${nextName}.${sync.created ? ' Producer directory row created and linked.' : ' Producer directory linked via producer_id.'}`
        : hadProducer
          ? `Updated ${nextName}. Producer role removed — producer master record kept; users.producer_id retained; linked producer set inactive.`
          : `Updated ${nextName}.`,
    )
    setSelected(null)
    await loadRows()
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!canManage) return

    const fullName = addForm.fullName.trim()
    const email = addForm.email.trim().toLowerCase()
    if (!fullName || !email) {
      setFormError('Full name and email are required.')
      return
    }

    if (actorRole === 'admin' && (addForm.role === 'owner' || addForm.roles.includes('owner'))) {
      setFormError('Admins cannot assign the Owner role.')
      return
    }

    const inviteRoles = addForm.roles.length ? addForm.roles : ([addForm.role] as AppRole[])
    const primary = primaryAppRole(inviteRoles) ?? addForm.role
    const hasProducer = inviteRoles.includes('producer')
    let split: number | null | undefined
    if (hasProducer) {
      split = parseOptionalSplit(addForm.defaultSplit)
      if (split === undefined) {
        setFormError('Default Producer Split % must be between 0 and 100 (or blank).')
        return
      }
    }

    setSaving(true)
    setFormError(null)

    const { data, error } = await supabase.functions.invoke('invite-alza-user', {
      body: {
        action: 'invite',
        email,
        full_name: fullName,
        role: primary,
        roles: inviteRoles,
        status: addForm.status,
      },
    })

    const result = await readInviteFunctionResult(data, error)
    if (!result.ok) {
      setSaving(false)
      setFormError(result.message)
      return
    }

    const invitedUserId =
      typeof result.data.user_id === 'string' ? result.data.user_id : null
    if (invitedUserId) {
      const sync = await syncProducerDirectoryForUser({
        userId: invitedUserId,
        fullName,
        email,
        hasProducerRole: hasProducer,
        userStatus: addForm.status,
        defaultSplitPercentage: hasProducer ? split ?? null : undefined,
        preferredProducerId: hasProducer ? addForm.linkedProducerId || null : undefined,
      })
      if (sync.error) {
        setSaving(false)
        setFormError(`Invited, but producer directory sync failed: ${sync.error}`)
        await loadRows()
        return
      }
    }

    setSaving(false)
    setSuccess(`Invited ${fullName} (${email}).`)
    setAddOpen(false)
    await loadRows()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UserCircle className="h-6 w-6 text-alza-blue-700" />
            <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Manage ALZA Flow profiles linked to Supabase Auth. New users are invited through a secure server-side
            Edge Function (no service-role key in the browser).
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load users: {fetchError}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or role…"
          className={`${inputClassName} pl-9`}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Roles</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Auth link / invite</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                    Loading users…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const role = normalizeAppRole(user.role) ?? user.role
                  const lockedForAdmin = actorRole === 'admin' && normalizeAppRole(user.role) === 'owner'
                  const linkLabel = authLinkLabel(user)
                  return (
                    <tr key={user.id} className="hover:bg-alza-blue-50/40">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900">{user.fullName}</td>
                      <td className="px-6 py-4 text-sm text-slate-700">{user.email}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(user.roles.length ? user.roles : [role]).map((r) => (
                            <span
                              key={String(r)}
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${roleStyles[String(r)] ?? roleStyles.viewer}`}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${statusStyles[user.status]}`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${authLinkStyles[linkLabel]}`}
                        >
                          {linkLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {canManage && !lockedForAdmin ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEdit(user)}
                              className="text-sm font-medium text-alza-blue-700 hover:text-alza-blue-800"
                            >
                              Edit
                            </button>
                            {canResendInvite(user, actorRole) && (
                              <button
                                type="button"
                                disabled={resendingId === user.id}
                                onClick={() => void handleResendInvite(user)}
                                className="text-sm font-medium text-amber-800 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {resendingId === user.id ? 'Sending…' : 'Resend Invite'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">{lockedForAdmin ? 'Owner protected' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Edit user</h2>
                <p className="text-sm text-slate-500">{selected.email}</p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setSelected(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 overflow-y-auto px-6 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Full name</label>
                <input
                  required
                  value={fullNameValue}
                  onChange={(e) => setFullNameValue(e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email (login)</label>
                <input disabled value={selected.email} className={`${inputClassName} bg-slate-50 text-slate-500`} />
                <p className="mt-1 text-[11px] text-slate-500">
                  Login email is locked here. Changing Auth email requires the Admin API / Edge Function.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Roles</label>
                <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
                  {assignableRoles.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm capitalize text-slate-700">
                      <input
                        type="checkbox"
                        checked={rolesValue.includes(role)}
                        onChange={(e) => {
                          const next = toggleRole(rolesValue, role, e.target.checked)
                          setRolesValue(next)
                          setRoleValue((primaryAppRole(next) ?? role) as AppRole)
                          if (role === 'producer' && e.target.checked && selected) {
                            void loadProducerLinkForUser({
                              ...selected,
                              fullName: fullNameValue || selected.fullName,
                              roles: next,
                            })
                          }
                          if (role === 'producer' && !e.target.checked) {
                            setLinkedProducerId('')
                            setProducerLinkHint(null)
                            setDefaultSplitValue('')
                          }
                        }}
                      />
                      {role}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Permissions are additive. Primary privilege role stored on the profile:{' '}
                  <span className="font-medium capitalize">{primaryAppRole(rolesValue) ?? roleValue}</span>
                </p>
              </div>
              {rolesValue.includes('producer') ? (
                <div
                  data-testid="linked-producer-panel"
                  className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                      Producer directory
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80">
                      Links this login to <span className="font-medium">users.producer_id</span>. Prefer an
                      existing producer row — never create a duplicate when email already matches.
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="edit-linked-producer"
                      className="mb-1 block text-xs font-medium text-slate-700"
                    >
                      Linked Producer
                    </label>
                    <select
                      id="edit-linked-producer"
                      value={linkedProducerId}
                      onChange={(e) => {
                        const id = e.target.value
                        setLinkedProducerId(id)
                        const opt = producerLinkOptions.find((o) => o.id === id)
                        if (opt?.defaultSplitPercentage != null) {
                          setDefaultSplitValue(String(opt.defaultSplitPercentage))
                        }
                        setProducerLinkHint(
                          id
                            ? 'Explicit producer_id link will be saved on this user.'
                            : 'No existing producer selected — a new directory row will be created only if email/name do not already match.',
                        )
                      }}
                      className={selectClassName}
                    >
                      <option value="">
                        {producerLinkOptions.length
                          ? 'Create new producer directory row (if no email match)'
                          : 'Create new producer directory row on save'}
                      </option>
                      {producerLinkOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.producerName}
                          {opt.email ? ` · ${opt.email}` : ''}
                          {opt.status !== 'active' ? ` (${opt.status})` : ''}
                        </option>
                      ))}
                    </select>
                    {producerLinkHint ? (
                      <p className="mt-1 text-[11px] text-slate-600">{producerLinkHint}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">Loading producer matches…</p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="edit-default-split"
                      className="mb-1 block text-xs font-medium text-slate-700"
                    >
                      Default Producer Split %
                    </label>
                    <input
                      id="edit-default-split"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={defaultSplitValue}
                      onChange={(e) => setDefaultSplitValue(e.target.value)}
                      placeholder="Optional"
                      className={inputClassName}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Stored on the linked producer directory row. Used when assigning this producer on
                      policies/transactions.
                    </p>
                  </div>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                <select
                  value={statusValue}
                  onChange={(e) => setStatusValue(e.target.value as UserStatus)}
                  className={selectClassName}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add User</h2>
                <p className="text-sm text-slate-500">
                  Invites a Supabase Auth user and links <span className="font-medium">public.users</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setAddOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4 overflow-y-auto px-6 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Full name</label>
                <input
                  required
                  value={addForm.fullName}
                  onChange={(e) => setAddForm((f) => ({ ...f, fullName: e.target.value }))}
                  onBlur={() => {
                    if (addForm.roles.includes('producer')) {
                      void hydrateProducerLinkFields({
                        fullName: addForm.fullName,
                        email: addForm.email,
                        forAdd: true,
                      })
                    }
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  required
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  onBlur={() => {
                    if (addForm.roles.includes('producer')) {
                      void hydrateProducerLinkFields({
                        fullName: addForm.fullName,
                        email: addForm.email,
                        forAdd: true,
                      })
                    }
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Roles</label>
                <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
                  {assignableRoles.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm capitalize text-slate-700">
                      <input
                        type="checkbox"
                        checked={addForm.roles.includes(role)}
                        onChange={(e) => {
                          const next = toggleRole(addForm.roles, role, e.target.checked)
                          setAddForm((f) => ({
                            ...f,
                            roles: next,
                            role: (primaryAppRole(next) ?? role) as AppRole,
                          }))
                          if (role === 'producer' && e.target.checked) {
                            setAddProducerHint('Loading producer matches…')
                            void hydrateProducerLinkFields({
                              fullName: addForm.fullName,
                              email: addForm.email,
                              forAdd: true,
                            })
                          }
                          if (role === 'producer' && !e.target.checked) {
                            setAddProducerHint(null)
                            setAddForm((f) => ({ ...f, linkedProducerId: '', defaultSplit: '' }))
                          }
                        }}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
              {addForm.roles.includes('producer') ? (
                <div
                  data-testid="linked-producer-panel-add"
                  className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                      Producer directory
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80">
                      Links this login to <span className="font-medium">users.producer_id</span>. Prefer an
                      existing producer row — never create a duplicate when email already matches.
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="add-linked-producer"
                      className="mb-1 block text-xs font-medium text-slate-700"
                    >
                      Linked Producer
                    </label>
                    <select
                      id="add-linked-producer"
                      value={addForm.linkedProducerId}
                      onChange={(e) => {
                        const id = e.target.value
                        const opt = addProducerOptions.find((o) => o.id === id)
                        setAddForm((f) => ({
                          ...f,
                          linkedProducerId: id,
                          defaultSplit:
                            opt?.defaultSplitPercentage != null
                              ? String(opt.defaultSplitPercentage)
                              : f.defaultSplit,
                        }))
                        setAddProducerHint(
                          id
                            ? 'Explicit producer_id link will be saved on invite.'
                            : 'No existing producer selected — a new directory row will be created only if email/name do not already match.',
                        )
                      }}
                      onFocus={() => {
                        if (addProducerOptions.length === 0) {
                          void hydrateProducerLinkFields({
                            fullName: addForm.fullName,
                            email: addForm.email,
                            forAdd: true,
                          })
                        }
                      }}
                      className={selectClassName}
                    >
                      <option value="">
                        {addProducerOptions.length
                          ? 'Create new producer directory row (if no email match)'
                          : 'Create new producer directory row on save'}
                      </option>
                      {addProducerOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.producerName}
                          {opt.email ? ` · ${opt.email}` : ''}
                          {opt.status !== 'active' ? ` (${opt.status})` : ''}
                        </option>
                      ))}
                    </select>
                    {addProducerHint ? (
                      <p className="mt-1 text-[11px] text-slate-600">{addProducerHint}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">Loading producer matches…</p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="add-default-split"
                      className="mb-1 block text-xs font-medium text-slate-700"
                    >
                      Default Producer Split %
                    </label>
                    <input
                      id="add-default-split"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={addForm.defaultSplit}
                      onChange={(e) => setAddForm((f) => ({ ...f, defaultSplit: e.target.value }))}
                      placeholder="Optional"
                      className={inputClassName}
                    />
                  </div>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                <select
                  value={addForm.status}
                  onChange={(e) => setAddForm((f) => ({ ...f, status: e.target.value as UserStatus }))}
                  className={selectClassName}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setAddOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Inviting…' : 'Invite user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
