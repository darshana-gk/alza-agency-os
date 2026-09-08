import { resolveCurrentAgencyProfileId } from './agency'
import { recordActivity } from './activity'
import type { AppUserProfile } from './auth'
import { sortNewestCreatedThenCode } from './createdFirstSort'
import {
  isAlzaSupportRole,
  canAccessSupportCenter,
  canAccessAlzaSupportInbox,
  supportNotificationDeepLink,
  toAppRoles,
  type RoleInput,
} from './permissions'
import { supabase } from './supabase'

export const SUPPORT_CATEGORIES = [
  { value: 'account_login', label: 'Account & Login' },
  { value: 'billing_subscription', label: 'Billing & Subscription' },
  { value: 'import_data', label: 'Import / Data' },
  { value: 'reconciliation', label: 'Reconciliation' },
  { value: 'reports_exports', label: 'Reports & Exports' },
  { value: 'technical_issue', label: 'Technical Issue' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'other', label: 'Other' },
] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]['value']

export type SupportStatus = 'open' | 'waiting_on_customer' | 'waiting_on_alza' | 'resolved'
export type SupportPriority = 'normal' | 'urgent'
export type SupportSenderType = 'agency_user' | 'alza_support'

export type SupportConversation = {
  id: string
  ticketNumber: string | null
  agencyProfileId: string
  agencyName: string | null
  agencyEmail: string | null
  agencyPhone: string | null
  agencyWebsite: string | null
  createdByUserId: string
  createdByName: string | null
  createdByEmail: string | null
  category: SupportCategory
  subject: string
  status: SupportStatus
  priority: SupportPriority
  assignedToUserId: string | null
  assignedToName: string | null
  lastMessagePreview: string | null
  lastMessageAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SupportMessage = {
  id: string
  conversationId: string
  senderUserId: string | null
  senderName: string | null
  senderRole: string | null
  senderType: SupportSenderType
  body: string
  createdAt: string
}

export function supportCategoryLabel(category: string | null | undefined): string {
  const hit = SUPPORT_CATEGORIES.find((c) => c.value === category)
  return hit?.label ?? 'Other'
}

export function supportStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'waiting_on_customer':
      return 'Waiting on You'
    case 'waiting_on_alza':
      return 'Waiting on ALZA'
    case 'resolved':
      return 'Resolved'
    default:
      return 'Open'
  }
}

/** ALZA inbox uses customer-facing waiting labels from ALZA's perspective. */
export function supportStatusLabelForAlza(status: string | null | undefined): string {
  switch (status) {
    case 'waiting_on_customer':
      return 'Waiting on Customer'
    case 'waiting_on_alza':
      return 'Waiting on ALZA'
    case 'resolved':
      return 'Resolved'
    case 'open':
      return 'Open'
    default:
      return supportStatusLabel(status)
  }
}

export function supportStatusClass(status: string | null | undefined): string {
  switch (status) {
    case 'waiting_on_customer':
      return 'bg-amber-50 text-amber-800 ring-amber-600/20'
    case 'waiting_on_alza':
      return 'bg-alza-blue-50 text-alza-blue-800 ring-alza-blue-600/20'
    case 'resolved':
      return 'bg-slate-100 text-slate-600 ring-slate-500/20'
    default:
      return 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'
  }
}

export function supportPriorityLabel(priority: string | null | undefined): string {
  return priority === 'urgent' ? 'Urgent' : 'Normal'
}

export function supportSenderRoleLabel(role: string | null | undefined): string | null {
  const value = String(role ?? '').trim().toLowerCase()
  if (!value) return null
  switch (value) {
    case 'owner':
      return 'Owner'
    case 'admin':
      return 'Admin'
    case 'csr':
      return 'CSR'
    case 'producer':
      return 'Producer'
    case 'viewer':
      return 'Viewer'
    case 'alza_support':
      return 'ALZA Support'
    default:
      return value
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
  }
}

/** Agency message header. Fall back to “Agency User” only when name and role are missing. */
export function supportAgencySenderLabel(
  name: string | null | undefined,
  role: string | null | undefined,
): string {
  const displayName = String(name ?? '').trim()
  const roleLabel = supportSenderRoleLabel(role)
  if (displayName && roleLabel) return `${displayName} · ${roleLabel}`
  if (displayName) return displayName
  if (roleLabel) return roleLabel
  return 'Agency User'
}

export function supportMessageSenderLabel(
  message: Pick<SupportMessage, 'senderType' | 'senderName' | 'senderRole'>,
): string {
  if (message.senderType === 'alza_support') {
    const name = String(message.senderName ?? '').trim()
    return name ? `ALZA Support · ${name}` : 'ALZA Support'
  }
  return supportAgencySenderLabel(message.senderName, message.senderRole)
}

/** Newest created_at first, then id DESC. */
export function sortSupportMessagesNewestFirst(messages: SupportMessage[]): SupportMessage[] {
  return sortNewestCreatedThenCode(messages, (m) => m.createdAt, (m) => m.id)
}

export function mergeSupportReply(
  messages: SupportMessage[],
  incoming: SupportMessage,
): SupportMessage[] {
  return sortSupportMessagesNewestFirst([
    incoming,
    ...messages.filter((m) => m.id !== incoming.id),
  ])
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function trimDisplay(value: string | null | undefined): string | null {
  const t = String(value ?? '').trim()
  return t || null
}

/**
 * Opened-by / contact-email for a ticket.
 * Prefer immutable conversation snapshots, then a live users embed when RLS allows it.
 * Never substitute agency_profile.email for the opener's contact email.
 */
export function resolveSupportOpenerIdentity(input: {
  openedByName?: string | null
  openedByEmail?: string | null
  liveName?: string | null
  liveEmail?: string | null
}): { name: string | null; email: string | null } {
  return {
    name: trimDisplay(input.openedByName) || trimDisplay(input.liveName),
    email: trimDisplay(input.openedByEmail) || trimDisplay(input.liveEmail),
  }
}

function mapConversation(row: Record<string, unknown>): SupportConversation {
  // Agency contact is hydrated via support_agency_brief() — never rely on agency_profile embeds
  // (Phase 3B RLS blocks ALZA Support from selecting operational agency_profile rows).
  const creator = firstEmbed(
    row.creator as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null,
  )
  const assignee = firstEmbed(row.assignee as { full_name?: string } | { full_name?: string }[] | null)
  const opener = resolveSupportOpenerIdentity({
    openedByName: (row.opened_by_name as string | null) ?? null,
    openedByEmail: (row.opened_by_email as string | null) ?? null,
    liveName: creator?.full_name ?? null,
    liveEmail: creator?.email ?? null,
  })
  return {
    id: String(row.id),
    ticketNumber: String(row.ticket_number ?? '').trim() || null,
    agencyProfileId: String(row.agency_profile_id ?? ''),
    agencyName: null,
    agencyEmail: null,
    agencyPhone: null,
    agencyWebsite: null,
    createdByUserId: String(row.created_by_user_id ?? ''),
    createdByName: opener.name,
    createdByEmail: opener.email,
    category: String(row.category ?? 'other') as SupportCategory,
    subject: String(row.subject ?? ''),
    status: String(row.status ?? 'waiting_on_alza') as SupportStatus,
    priority: String(row.priority ?? 'normal') as SupportPriority,
    assignedToUserId: row.assigned_to_user_id ? String(row.assigned_to_user_id) : null,
    assignedToName: assignee?.full_name?.trim() || null,
    lastMessagePreview: (row.last_message_preview as string | null) ?? null,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapMessage(row: Record<string, unknown>): SupportMessage {
  const sender = firstEmbed(
    row.sender as { full_name?: string; role?: string } | { full_name?: string; role?: string }[] | null,
  )
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id ?? ''),
    senderUserId: row.sender_user_id ? String(row.sender_user_id) : null,
    senderName: sender?.full_name?.trim() || null,
    senderRole: sender?.role?.trim() || null,
    senderType: String(row.sender_type ?? 'agency_user') as SupportSenderType,
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

const CONVERSATION_SELECT = `
  id, ticket_number, agency_profile_id, created_by_user_id, opened_by_name, opened_by_email,
  category, subject, status, priority,
  assigned_to_user_id, last_message_preview, last_message_at, resolved_at, created_at, updated_at,
  creator:created_by_user_id ( full_name, email ),
  assignee:assigned_to_user_id ( full_name )
`

type AgencyBriefRow = {
  id?: string
  agency_name?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
}

/**
 * Hydrate limited agency id/name/contact via support_agency_brief() — does not reopen agency_profile RLS.
 * ALZA Support receives every agency; agency users receive only their own membership.
 * Agency email is distinct from opener contact email.
 * Returns conversations unchanged when the RPC is unavailable or returns nothing.
 */
async function hydrateConversationAgencyNames(
  conversations: SupportConversation[],
): Promise<SupportConversation[]> {
  if (conversations.length === 0) return conversations
  const { data, error } = await supabase.rpc('support_agency_brief')
  if (error || !data) return conversations
  const byId = new Map<string, { name: string | null; email: string | null; phone: string | null; website: string | null }>()
  for (const row of data as AgencyBriefRow[]) {
    const id = String(row.id ?? '').trim()
    if (!id) continue
    byId.set(id, {
      name: trimDisplay(row.agency_name),
      email: trimDisplay(row.email),
      phone: trimDisplay(row.phone),
      website: trimDisplay(row.website),
    })
  }
  if (byId.size === 0) return conversations
  return conversations.map((c) => {
    const agency = byId.get(c.agencyProfileId)
    return {
      ...c,
      agencyName: agency?.name ?? c.agencyName,
      agencyEmail: agency?.email ?? c.agencyEmail,
      agencyPhone: agency?.phone ?? c.agencyPhone,
      agencyWebsite: agency?.website ?? c.agencyWebsite,
    }
  })
}

async function hydrateConversationOpenerName(
  conversation: SupportConversation,
): Promise<SupportConversation> {
  if (conversation.createdByName) return conversation
  const { data, error } = await supabase.rpc('support_ticket_actor_brief', {
    p_conversation_id: conversation.id,
  })
  if (error || !data) return conversation
  const opener = (data as Array<{ id?: string; full_name?: string | null }>).find(
    (row) => String(row.id ?? '') === conversation.createdByUserId,
  )
  const name = trimDisplay(opener?.full_name)
  if (!name) return conversation
  return { ...conversation, createdByName: name }
}

const MESSAGE_SELECT = `
  id, conversation_id, sender_user_id, sender_type, body, created_at,
  sender:sender_user_id ( full_name, role )
`

async function hydrateSupportMessageActors(
  conversationId: string,
  messages: SupportMessage[],
): Promise<SupportMessage[]> {
  if (messages.length === 0) return messages
  const { data, error } = await supabase.rpc('support_ticket_actor_brief', {
    p_conversation_id: conversationId,
  })
  if (error || !data) return messages
  const byId = new Map<string, { fullName: string | null; role: string | null }>()
  for (const row of data as Array<{ id?: string; full_name?: string | null; role?: string | null }>) {
    const id = String(row.id ?? '').trim()
    if (!id) continue
    byId.set(id, {
      fullName: String(row.full_name ?? '').trim() || null,
      role: String(row.role ?? '').trim() || null,
    })
  }
  if (byId.size === 0) return messages
  return messages.map((m) => {
    const actor = m.senderUserId ? byId.get(m.senderUserId) : undefined
    return {
      ...m,
      senderName: m.senderName || actor?.fullName || null,
      senderRole: m.senderRole || actor?.role || null,
    }
  })
}

export async function fetchSupportConversations(params?: {
  tab?: 'open' | 'resolved' | 'all'
  status?: SupportStatus | 'all'
  category?: SupportCategory | 'all'
  agencyProfileId?: string | 'all'
  search?: string
  /** ALZA inbox: list all visible (RLS-scoped) rows */
  forAlzaInbox?: boolean
}): Promise<{ data: SupportConversation[]; error: string | null }> {
  let query = supabase
    .from('support_conversations')
    .select(CONVERSATION_SELECT)
    .order('updated_at', { ascending: false })
    .limit(300)

  const tab = params?.tab ?? 'all'
  if (tab === 'open') {
    query = query.neq('status', 'resolved')
  } else if (tab === 'resolved') {
    query = query.eq('status', 'resolved')
  }

  if (params?.status && params.status !== 'all') {
    query = query.eq('status', params.status)
  }
  if (params?.category && params.category !== 'all') {
    query = query.eq('category', params.category)
  }
  if (params?.agencyProfileId && params.agencyProfileId !== 'all') {
    query = query.eq('agency_profile_id', params.agencyProfileId)
  }

  const { data, error } = await query
  if (error) return { data: [], error: error.message }

  let rows = (data ?? []).map((r) => mapConversation(r as Record<string, unknown>))
  rows = await hydrateConversationAgencyNames(rows)
  const q = (params?.search ?? '').trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) =>
        r.subject.toLowerCase().includes(q) ||
        (r.ticketNumber ?? '').toLowerCase().includes(q) ||
        supportCategoryLabel(r.category).toLowerCase().includes(q) ||
        (r.agencyName ?? '').toLowerCase().includes(q) ||
        (r.lastMessagePreview ?? '').toLowerCase().includes(q) ||
        (r.createdByName ?? '').toLowerCase().includes(q),
    )
  }
  return { data: rows, error: null }
}

export async function fetchSupportConversation(
  id: string,
): Promise<{ data: SupportConversation | null; error: string | null }> {
  const { data, error } = await supabase
    .from('support_conversations')
    .select(CONVERSATION_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: null }
  const [hydratedAgency] = await hydrateConversationAgencyNames([
    mapConversation(data as Record<string, unknown>),
  ])
  if (!hydratedAgency) return { data: null, error: null }
  const hydrated = await hydrateConversationOpenerName(hydratedAgency)
  return { data: hydrated, error: null }
}

export async function fetchSupportMessages(
  conversationId: string,
): Promise<{ data: SupportMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from('support_messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) return { data: [], error: error.message }
  const mapped = (data ?? []).map((r) => mapMessage(r as Record<string, unknown>))
  const hydrated = await hydrateSupportMessageActors(conversationId, mapped)
  return { data: sortSupportMessagesNewestFirst(hydrated), error: null }
}

export async function createSupportRequest(input: {
  category: SupportCategory
  subject: string
  message: string
  priority?: SupportPriority
  profile: AppUserProfile
}): Promise<{ data: SupportConversation | null; error: string | null }> {
  if (!canAccessSupportCenter(input.profile.roles)) {
    return { data: null, error: 'You do not have access to Support Center.' }
  }
  const subject = input.subject.trim()
  const message = input.message.trim()
  if (!subject) return { data: null, error: 'Subject is required.' }
  if (!message) return { data: null, error: 'Message is required.' }
  if (!SUPPORT_CATEGORIES.some((c) => c.value === input.category)) {
    return { data: null, error: 'Choose a valid category.' }
  }

  const { agencyProfileId, error: agencyError } = await resolveCurrentAgencyProfileId()
  if (agencyError) {
    return { data: null, error: agencyError }
  }
  if (!agencyProfileId) {
    return { data: null, error: 'Agency membership is required to create a support request.' }
  }

  const { data: conv, error: convError } = await supabase
    .from('support_conversations')
    .insert({
      agency_profile_id: agencyProfileId,
      created_by_user_id: input.profile.id,
      category: input.category,
      subject,
      status: 'waiting_on_alza',
      priority: input.priority === 'urgent' ? 'urgent' : 'normal',
    })
    .select(CONVERSATION_SELECT)
    .single()

  if (convError || !conv) {
    return { data: null, error: convError?.message ?? 'Could not create support request.' }
  }

  const conversation = mapConversation(conv as Record<string, unknown>)

  const { error: msgError } = await supabase.from('support_messages').insert({
    conversation_id: conversation.id,
    sender_user_id: input.profile.id,
    sender_type: 'agency_user',
    body: message,
  })
  if (msgError) {
    return { data: null, error: msgError.message }
  }

  await recordActivity({
    action: 'support_request_created',
    entityType: 'support',
    entityId: conversation.id,
    recordReference: subject,
    newValue: { category: input.category, status: 'waiting_on_alza', priority: conversation.priority },
  })

  void notifySupportEventBestEffort({
    event: 'request_created',
    conversationId: conversation.id,
  })

  const refreshed = await fetchSupportConversation(conversation.id)
  return { data: refreshed.data ?? conversation, error: refreshed.error }
}

export async function replyToSupportConversation(input: {
  conversationId: string
  body: string
  profile: AppUserProfile
  asAlza: boolean
}): Promise<{ data: SupportMessage | null; error: string | null }> {
  const body = input.body.trim()
  if (!body) return { data: null, error: 'Reply cannot be empty.' }

  if (input.asAlza) {
    if (!canAccessAlzaSupportInbox(input.profile.roles)) {
      return { data: null, error: 'ALZA Support access required.' }
    }
  } else if (!canAccessSupportCenter(input.profile.roles)) {
    return { data: null, error: 'You do not have access to Support Center.' }
  }

  const existing = await fetchSupportConversation(input.conversationId)
  if (existing.error || !existing.data) {
    return { data: null, error: existing.error ?? 'Conversation not found.' }
  }

  const senderType: SupportSenderType = input.asAlza ? 'alza_support' : 'agency_user'
  const nextStatus: SupportStatus = input.asAlza ? 'waiting_on_customer' : 'waiting_on_alza'

  const { data: msg, error: msgError } = await supabase
    .from('support_messages')
    .insert({
      conversation_id: input.conversationId,
      sender_user_id: input.profile.id,
      sender_type: senderType,
      body,
    })
    .select(MESSAGE_SELECT)
    .single()

  if (msgError || !msg) {
    return { data: null, error: msgError?.message ?? 'Could not send reply.' }
  }

  // Status advances via support_message_after_insert trigger (no client UPDATE grant).

  await recordActivity({
    action: input.asAlza ? 'support_reply_sent_alza' : 'support_reply_sent',
    entityType: 'support',
    entityId: input.conversationId,
    recordReference: existing.data.subject,
    newValue: { status: nextStatus },
  })

  void notifySupportEventBestEffort({
    event: input.asAlza ? 'alza_replied' : 'customer_replied',
    conversationId: input.conversationId,
  })

  const mapped = mapMessage(msg as Record<string, unknown>)
  return {
    data: {
      ...mapped,
      senderName: mapped.senderName || input.profile.fullName.trim() || null,
      senderRole: mapped.senderRole || input.profile.role || null,
    },
    error: null,
  }
}

export async function resolveSupportConversation(input: {
  conversationId: string
  profile: AppUserProfile
  asAlza?: boolean
}): Promise<{ error: string | null }> {
  const asAlza = Boolean(input.asAlza)
  if (asAlza && !canAccessAlzaSupportInbox(input.profile.roles)) {
    return { error: 'ALZA Support access required.' }
  }
  if (!asAlza && !canAccessSupportCenter(input.profile.roles)) {
    return { error: 'You do not have access to Support Center.' }
  }
  const existing = await fetchSupportConversation(input.conversationId)
  if (!existing.data) return { error: existing.error ?? 'Conversation not found.' }

  const { error } = await supabase.rpc('support_resolve_conversation', {
    p_conversation_id: input.conversationId,
  })
  if (error) return { error: error.message }

  await recordActivity({
    action: asAlza ? 'support_request_resolved_alza' : 'support_request_resolved',
    entityType: 'support',
    entityId: input.conversationId,
    recordReference: existing.data.subject,
    newValue: { status: 'resolved' },
  })

  void notifySupportEventBestEffort({
    event: 'ticket_resolved',
    conversationId: input.conversationId,
  })

  return { error: null }
}

export async function reopenSupportConversation(input: {
  conversationId: string
  profile: AppUserProfile
  asAlza?: boolean
}): Promise<{ error: string | null }> {
  const asAlza = Boolean(input.asAlza)
  if (asAlza && !canAccessAlzaSupportInbox(input.profile.roles)) {
    return { error: 'ALZA Support access required.' }
  }
  if (!asAlza && !canAccessSupportCenter(input.profile.roles)) {
    return { error: 'You do not have access to Support Center.' }
  }

  const existing = await fetchSupportConversation(input.conversationId)
  if (!existing.data) return { error: existing.error ?? 'Conversation not found.' }

  const { error } = await supabase.rpc('support_reopen_conversation', {
    p_conversation_id: input.conversationId,
  })
  if (error) return { error: error.message }

  await recordActivity({
    action: 'support_request_reopened',
    entityType: 'support',
    entityId: input.conversationId,
    recordReference: existing.data.subject,
    newValue: { status: 'waiting_on_alza', reopened: true },
  })

  void notifySupportEventBestEffort({
    event: 'ticket_reopened',
    conversationId: input.conversationId,
  })

  return { error: null }
}

export async function assignSupportConversation(input: {
  conversationId: string
  assigneeUserId: string
  profile: AppUserProfile
}): Promise<{ error: string | null }> {
  if (!canAccessAlzaSupportInbox(input.profile.roles)) {
    return { error: 'Only ALZA Support can assign conversations.' }
  }
  const { error } = await supabase.rpc('support_assign_conversation', {
    p_conversation_id: input.conversationId,
    p_assignee_user_id: input.assigneeUserId,
  })
  if (error) {
    return {
      error:
        error.message.includes('function') || error.message.includes('does not exist')
          ? 'Assignment is not available until the support assignment migration is applied.'
          : error.message,
    }
  }
  await recordActivity({
    action: 'support_request_assigned',
    entityType: 'support',
    entityId: input.conversationId,
    newValue: { assigned_to_user_id: input.assigneeUserId },
  })
  return { error: null }
}

export async function unassignSupportConversation(input: {
  conversationId: string
  profile: AppUserProfile
}): Promise<{ error: string | null }> {
  if (!canAccessAlzaSupportInbox(input.profile.roles)) {
    return { error: 'Only ALZA Support can unassign conversations.' }
  }
  const { error } = await supabase.rpc('support_unassign_conversation', {
    p_conversation_id: input.conversationId,
  })
  if (error) {
    return {
      error:
        error.message.includes('function') || error.message.includes('does not exist')
          ? 'Assignment is not available until the support assignment migration is applied.'
          : error.message,
    }
  }
  await recordActivity({
    action: 'support_request_unassigned',
    entityType: 'support',
    entityId: input.conversationId,
  })
  return { error: null }
}

export async function fetchAlzaSupportAgents(): Promise<{
  data: Array<{ id: string; fullName: string }>
  error: string | null
}> {
  const byId = new Map<string, string>()

  const primary = await supabase
    .from('users')
    .select('id, full_name, role, archived_at, status')
    .is('archived_at', null)
    .eq('status', 'active')
    .eq('role', 'alza_support')
    .order('full_name')

  if (primary.error) return { data: [], error: primary.error.message }
  for (const row of primary.data ?? []) {
    byId.set(String(row.id), String(row.full_name ?? 'ALZA Support').trim() || 'ALZA Support')
  }

  // Also include agents granted via user_roles (primary role may differ).
  const roleRows = await supabase.from('user_roles').select('user_id').eq('role', 'alza_support')
  if (!roleRows.error && (roleRows.data?.length ?? 0) > 0) {
    const ids = [...new Set((roleRows.data ?? []).map((r) => String(r.user_id)).filter(Boolean))]
    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length) {
      const extras = await supabase
        .from('users')
        .select('id, full_name, archived_at, status')
        .in('id', missing)
        .is('archived_at', null)
        .eq('status', 'active')
      for (const row of extras.data ?? []) {
        byId.set(String(row.id), String(row.full_name ?? 'ALZA Support').trim() || 'ALZA Support')
      }
    }
  }

  return {
    data: [...byId.entries()]
      .map(([id, fullName]) => ({ id, fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    error: null,
  }
}

export type SupportNotifyEvent =
  | 'request_created'
  | 'customer_replied'
  | 'alza_replied'
  | 'ticket_resolved'
  | 'ticket_reopened'

/** Best-effort email notify — never blocks support message success. */
export async function notifySupportEventBestEffort(input: {
  event: SupportNotifyEvent
  conversationId: string
}): Promise<{ delivered: boolean; skipped: boolean; message: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('notify-support-event', {
      body: {
        event: input.event,
        conversationId: input.conversationId,
      },
    })
    if (error) {
      return {
        delivered: false,
        skipped: true,
        message: error.message || 'Support email notify skipped',
      }
    }
    const payload = data as { ok?: boolean; skipped?: boolean; message?: string } | null
    return {
      delivered: Boolean(payload?.ok && !payload?.skipped),
      skipped: Boolean(payload?.skipped),
      message: payload?.message || 'ok',
    }
  } catch (err) {
    return {
      delivered: false,
      skipped: true,
      message: err instanceof Error ? err.message : 'Support email notify failed safely',
    }
  }
}

export async function setSupportWaitingStatus(input: {
  conversationId: string
  status: 'waiting_on_customer' | 'waiting_on_alza'
  profile: AppUserProfile
}): Promise<{ error: string | null }> {
  if (!canAccessAlzaSupportInbox(input.profile.roles)) {
    return { error: 'Only ALZA Support can change waiting status.' }
  }
  const { error } = await supabase.rpc('support_alza_set_waiting_status', {
    p_conversation_id: input.conversationId,
    p_status: input.status,
  })
  return { error: error?.message ?? null }
}

/** Lightweight rows for in-app notification derivation. */
export async function fetchSupportNotificationSeeds(params: {
  role: RoleInput
  profileId: string | null
}): Promise<{
  waitingOnAlza: SupportConversation[]
  waitingOnCustomer: SupportConversation[]
  recentlyResolved: SupportConversation[]
  error: string | null
}> {
  const roles = toAppRoles(params.role)
  const empty = {
    waitingOnAlza: [] as SupportConversation[],
    waitingOnCustomer: [] as SupportConversation[],
    recentlyResolved: [] as SupportConversation[],
    error: null as string | null,
  }
  if (!roles.length) return empty

  const agencyOk = canAccessSupportCenter(roles)
  const isAlza = isAlzaSupportRole(roles)
  if (!isAlza && !agencyOk) return empty

  const { data, error } = await supabase
    .from('support_conversations')
    .select(CONVERSATION_SELECT)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) return { ...empty, error: error.message }
  const rows = await hydrateConversationAgencyNames(
    (data ?? []).map((r) => mapConversation(r as Record<string, unknown>)),
  )

  // Agency Support Center takes precedence so Owner/CSR/Producer never inherit
  // ALZA Inbox notification targets, even if alza_support is present in roles.
  if (agencyOk) {
    return {
      waitingOnAlza: [],
      waitingOnCustomer: rows.filter((r) => r.status === 'waiting_on_customer'),
      recentlyResolved: rows.filter((r) => r.status === 'resolved').slice(0, 20),
      error: null,
    }
  }

  return {
    waitingOnAlza: rows.filter((r) => r.status === 'waiting_on_alza'),
    waitingOnCustomer: [],
    recentlyResolved: [],
    error: null,
  }
}

/** Local self-checks (no DB). */
export function runSupportPresentationSelfChecks(): { name: string; passed: boolean; detail: string }[] {
  return [
    {
      name: 'status waiting_on_alza label',
      passed: supportStatusLabel('waiting_on_alza') === 'Waiting on ALZA',
      detail: supportStatusLabel('waiting_on_alza'),
    },
    {
      name: 'status waiting_on_customer label',
      passed: supportStatusLabel('waiting_on_customer') === 'Waiting on You',
      detail: supportStatusLabel('waiting_on_customer'),
    },
    {
      name: 'category reconciliation label',
      passed: supportCategoryLabel('reconciliation') === 'Reconciliation',
      detail: supportCategoryLabel('reconciliation'),
    },
    {
      name: 'agency owner deep link is Support Center',
      passed: supportNotificationDeepLink('owner', 'c1') === '/support?c=c1',
      detail: supportNotificationDeepLink('owner', 'c1'),
    },
    {
      name: 'alza support deep link is inbox',
      passed: supportNotificationDeepLink('alza_support', 'c1') === '/admin/support-inbox?c=c1',
      detail: supportNotificationDeepLink('alza_support', 'c1'),
    },
    {
      name: 'agency sender uses name and role',
      passed: supportAgencySenderLabel('2AG-B Owner', 'owner') === '2AG-B Owner · Owner',
      detail: supportAgencySenderLabel('2AG-B Owner', 'owner'),
    },
    {
      name: 'agency sender falls back to Agency User',
      passed: supportAgencySenderLabel('', '') === 'Agency User',
      detail: supportAgencySenderLabel('', ''),
    },
    {
      name: 'messages newest created_at first',
      passed: (() => {
        const sorted = sortSupportMessagesNewestFirst([
          {
            id: 'a',
            conversationId: 'c',
            senderUserId: null,
            senderName: null,
            senderRole: null,
            senderType: 'agency_user',
            body: 'old',
            createdAt: '2026-09-01T10:00:00.000Z',
          },
          {
            id: 'b',
            conversationId: 'c',
            senderUserId: null,
            senderName: null,
            senderRole: null,
            senderType: 'alza_support',
            body: 'new',
            createdAt: '2026-09-01T11:00:00.000Z',
          },
        ])
        return sorted[0]?.id === 'b' && sorted[1]?.id === 'a'
      })(),
      detail: 'created_at desc',
    },
    {
      name: 'equal created_at ties break on id desc',
      passed: (() => {
        const stamp = '2026-09-01T11:00:00.000Z'
        const sorted = sortSupportMessagesNewestFirst([
          {
            id: '11111111-1111-4111-8111-111111111111',
            conversationId: 'c',
            senderUserId: null,
            senderName: null,
            senderRole: null,
            senderType: 'agency_user',
            body: 'a',
            createdAt: stamp,
          },
          {
            id: '99999999-9999-4999-8999-999999999999',
            conversationId: 'c',
            senderUserId: null,
            senderName: null,
            senderRole: null,
            senderType: 'agency_user',
            body: 'b',
            createdAt: stamp,
          },
        ])
        return sorted[0]?.id === '99999999-9999-4999-8999-999999999999'
      })(),
      detail: 'id desc tie-break',
    },
    {
      name: 'opener snapshot preferred over live profile',
      passed: (() => {
        const resolved = resolveSupportOpenerIdentity({
          openedByName: '2AG-B Owner',
          openedByEmail: 'owner.b@example.invalid',
          liveName: 'Renamed Later',
          liveEmail: 'new@example.invalid',
        })
        return resolved.name === '2AG-B Owner' && resolved.email === 'owner.b@example.invalid'
      })(),
      detail: 'immutable snapshot wins',
    },
    {
      name: 'opener live profile used only when snapshot missing',
      passed: (() => {
        const resolved = resolveSupportOpenerIdentity({
          openedByName: null,
          openedByEmail: null,
          liveName: '2AG-B Owner',
          liveEmail: 'owner.b@example.invalid',
        })
        return resolved.name === '2AG-B Owner' && resolved.email === 'owner.b@example.invalid'
      })(),
      detail: 'historical live fallback',
    },
    {
      name: 'contact email does not fall back to agency email',
      passed: (() => {
        const resolved = resolveSupportOpenerIdentity({
          openedByName: '2AG-B Owner',
          openedByEmail: null,
          liveName: null,
          liveEmail: null,
        })
        return resolved.name === '2AG-B Owner' && resolved.email === null
      })(),
      detail: 'missing opener email stays empty',
    },
    {
      name: 'merge reply puts incoming first',
      passed: (() => {
        const older = {
          id: 'old',
          conversationId: 'c',
          senderUserId: null,
          senderName: null,
          senderRole: null,
          senderType: 'agency_user' as const,
          body: 'old',
          createdAt: '2026-09-01T10:00:00.000Z',
        }
        const newer = {
          ...older,
          id: 'new',
          body: 'new',
          createdAt: '2026-09-01T12:00:00.000Z',
        }
        return mergeSupportReply([older], newer)[0]?.id === 'new'
      })(),
      detail: 'prepend newest',
    },
  ]
}