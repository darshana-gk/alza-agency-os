import {
  fetchCommissionTransactions,
  formatCurrency,
  isCorrectionRequired,
  isReadyForPayout,
  type CommissionTransaction,
} from './commission'
import {
  isAdminDirectoryRole,
  isProducerBookScoped,
  isProducerRole,
  producerKeysMatch,
  csrAssignmentMatches,
  resolveProducerBookName,
  toAppRoles,
  type RoleInput,
} from './permissions'
import { supabase } from './supabase'

export type NotificationCategory =
  | 'transactions'
  | 'policies'
  | 'financials'
  | 'recoveries'

export type NotificationKind =
  | 'awaiting_receipt'
  | 'needs_review'
  | 'correction_required'
  | 'approved_not_ready'
  | 'ready_for_payout'
  | 'commission_paid'
  | 'draft_batch'
  | 'open_recovery'
  | 'policy_expiring'
  | 'renewal_due'

export type ReviewQueueFilter = 'all' | 'assigned' | 'submitted' | 'returned' | 'approved'

export interface OperationalNotification {
  id: string
  kind: NotificationKind
  category: NotificationCategory
  title: string
  context: string
  dateLabel: string | null
  href: string
  actionLabel: string
  sortDate: string
  amount?: number
  read: boolean
  readAt: string | null
  reviewerUserId?: string | null
  reviewQueue?: 'assigned' | 'submitted' | 'returned' | 'approved' | null
}

export interface AttentionSummaryItem {
  label: string
  count: number
  href: string
  hint?: string
}

export interface NotificationsResult {
  items: OperationalNotification[]
  attention: AttentionSummaryItem[]
  badgeCount: number
  producerLimitation: string | null
  error: string | null
}

interface PolicyAlertRow {
  id: string
  policy_number: string | null
  expiration_date: string | null
  producer: string | null
  status: string | null
  client_id: string | null
  clients: { business_name: string | null } | { business_name: string | null }[] | null
}

interface BatchRow {
  id: string
  batch_number: string | null
  producer: string | null
  status: string | null
  created_at: string | null
  payment_date: string | null
  net_payment: number | string | null
}

interface RecoveryRow {
  id: string
  amount: number | string | null
  remaining_amount: number | string | null
  status: string | null
  voided_at: string | null
  created_at: string | null
  producer: string | null
  transaction_id: string | null
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null
  const target = new Date(`${isoDate.slice(0, 10)}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function display(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  return v || '—'
}

/** Additive notification kinds across multi-role (CSR+Producer gets CSR + own-producer kinds). */
function roleAllowsKind(role: RoleInput, kind: NotificationKind): boolean {
  const roles = toAppRoles(role)
  if (roles.length === 0) return false
  if (roles.includes('owner') || roles.includes('admin')) return true

  const allowed = new Set<NotificationKind>()
  if (roles.includes('csr')) {
    ;[
      'awaiting_receipt',
      'correction_required',
      'approved_not_ready',
      'policy_expiring',
      'renewal_due',
    ].forEach((k) => allowed.add(k as NotificationKind))
  }
  if (roles.includes('viewer')) {
    ;['awaiting_receipt', 'approved_not_ready', 'policy_expiring', 'renewal_due'].forEach((k) =>
      allowed.add(k as NotificationKind),
    )
  }
  if (roles.includes('producer')) {
    ;['ready_for_payout', 'commission_paid', 'policy_expiring', 'renewal_due'].forEach((k) =>
      allowed.add(k as NotificationKind),
    )
  }
  return allowed.has(kind)
}

function isOpenRecovery(row: RecoveryRow, usesRemaining: boolean): boolean {
  const status = String(row.status ?? '').toLowerCase()
  if (row.voided_at) return false
  if (status === 'voided' || status === 'applied') return false
  if (usesRemaining) {
    const remaining = Number(row.remaining_amount ?? 0)
    return remaining > 0 || status === 'open' || status === 'pending'
  }
  return status === 'open' || status === 'pending' || status === ''
}

function txContext(tx: CommissionTransaction): string {
  return `${display(tx.clientName)} · ${display(tx.policyNumber)} · ${display(tx.transactionNumber)}`
}

function withReadState(
  item: Omit<OperationalNotification, 'read' | 'readAt'>,
  readMap: Map<string, string | null>,
): OperationalNotification {
  const readAt = readMap.get(item.id) ?? null
  return {
    ...item,
    read: Boolean(readAt),
    readAt,
  }
}

async function loadReadMap(userId: string | null | undefined): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (!userId) return map
  const { data, error } = await supabase
    .from('notification_read_state')
    .select('notification_key, read_at')
    .eq('user_id', userId)
  if (error || !data) return map
  for (const row of data) {
    map.set(String(row.notification_key), (row.read_at as string | null) ?? null)
  }
  return map
}

export async function markNotificationReadState(params: {
  userId: string
  notificationKey: string
  read: boolean
}): Promise<{ error: string | null }> {
  const payload = {
    user_id: params.userId,
    notification_key: params.notificationKey,
    read_at: params.read ? new Date().toISOString() : null,
  }
  const { error } = await supabase.from('notification_read_state').upsert(payload, {
    onConflict: 'user_id,notification_key',
  })
  return { error: error?.message ?? null }
}

export async function markAllNotificationsRead(params: {
  userId: string
  notificationKeys: string[]
}): Promise<{ error: string | null }> {
  const keys = [...new Set(params.notificationKeys.filter(Boolean))]
  if (keys.length === 0) return { error: null }
  const now = new Date().toISOString()
  const rows = keys.map((notification_key) => ({
    user_id: params.userId,
    notification_key,
    read_at: now,
  }))
  const { error } = await supabase.from('notification_read_state').upsert(rows, {
    onConflict: 'user_id,notification_key',
  })
  return { error: error?.message ?? null }
}

/**
 * Build live operational notifications from current application data.
 * Read/unread comes from notification_read_state (per user).
 */
export async function fetchOperationalNotifications(params: {
  role: RoleInput
  fullName: string | null | undefined
  email?: string | null
  profileId?: string | null
  linkedProducerName?: string | null
}): Promise<NotificationsResult> {
  const roleInput = params.role
  const roles = toAppRoles(roleInput)
  const producerLocked = isProducerBookScoped(roleInput)
  const hasProducerIdentity = isProducerRole(roleInput)
  const today = todayIso()
  const in90 = addDaysIso(90)
  const profileId = (params.profileId ?? '').trim() || null

  const [txRes, batchesRes, recoveriesRes, policiesRes, readMap] = await Promise.all([
    fetchCommissionTransactions(),
    isAdminDirectoryRole(roleInput)
      ? supabase
          .from('producer_payment_batches')
          .select('id, batch_number, producer, status, created_at, payment_date, net_payment')
          .eq('status', 'draft')
          .is('voided_at', null)
          .order('created_at', { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as BatchRow[], error: null }),
    isAdminDirectoryRole(roleInput)
      ? supabase
          .from('producer_commission_recoveries')
          .select(
            'id, amount, remaining_amount, status, voided_at, created_at, producer, transaction_id',
          )
          .is('voided_at', null)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] as RecoveryRow[], error: null }),
    supabase
      .from('policies')
      .select(
        `
        id, policy_number, expiration_date, producer, status, client_id,
        clients ( business_name )
      `,
      )
      .is('archived_at', null)
      .or(
        `and(expiration_date.gte.${today},expiration_date.lte.${in90}),status.eq.renewal_due`,
      )
      .limit(200),
    loadReadMap(profileId),
  ])

  if (txRes.error) {
    return {
      items: [],
      attention: [],
      badgeCount: 0,
      producerLimitation: null,
      error: txRes.error.message,
    }
  }

  let transactions = txRes.data
  let policies = (policiesRes.data ?? []) as unknown as PolicyAlertRow[]
  let producerLimitation: string | null = null
  let ownProducerName: string | null = null

  if (hasProducerIdentity) {
    const known = [
      ...new Set([
        ...transactions.map((tx) => tx.producer).filter((p) => p && p !== '—'),
        ...policies.map((p) => String(p.producer ?? '').trim()).filter(Boolean),
      ]),
    ]
    const scope = resolveProducerBookName(roleInput, params.fullName, known, {
      linkedProducerName: params.linkedProducerName,
    })
    ownProducerName = scope.lockedName
    if (producerLocked) {
      producerLimitation = scope.limitation
      if (!scope.lockedName) {
        transactions = []
        policies = []
      } else {
        transactions = transactions.filter((tx) => producerKeysMatch(tx.producer, scope.lockedName))
        policies = policies.filter((p) => producerKeysMatch(String(p.producer ?? ''), scope.lockedName))
      }
    }
  }

  const items: OperationalNotification[] = []

  for (const tx of transactions) {
    if (!tx.agencyCommissionConfirmed && roleAllowsKind(roleInput, 'awaiting_receipt')) {
      items.push(
        withReadState(
          {
            id: `awaiting_receipt:${tx.id}`,
            kind: 'awaiting_receipt',
            category: 'transactions',
            title: 'Commission awaiting receipt',
            context: txContext(tx),
            dateLabel: tx.transactionDate || null,
            href: `/transactions/${tx.id}`,
            actionLabel: 'Open Transaction',
            sortDate: tx.transactionDate || tx.id,
            reviewQueue: null,
          },
          readMap,
        ),
      )
    }

    if (
      tx.agencyCommissionConfirmed &&
      tx.reviewStatus === 'matched' &&
      roleAllowsKind(roleInput, 'needs_review') &&
      profileId &&
      tx.reviewerUserId === profileId
    ) {
      items.push(
        withReadState(
          {
            id: `needs_review:${tx.id}`,
            kind: 'needs_review',
            category: 'transactions',
            title: `Transaction ${display(tx.transactionNumber)} submitted for your review`,
            context: [
              `Client: ${display(tx.clientName)}`,
              `Policy #: ${display(tx.policyNumber)}`,
              `Transaction #: ${display(tx.transactionNumber)}`,
              `Type: ${display(tx.type)}`,
              `Amount: ${formatCurrency(tx.premiumAmount || tx.amount)}`,
              `Agency commission: ${formatCurrency(tx.agencyCommissionAmount)}`,
              `Producer: ${display(tx.producer)}`,
              `Producer commission: ${formatCurrency(tx.producerCommissionAmount)}`,
              `CSR: ${display(tx.csr)}`,
            ].join(' · '),
            dateLabel: today,
            href: `/transactions/${tx.id}`,
            actionLabel: 'Open Transaction',
            sortDate: today,
            amount: tx.agencyCommissionAmount,
            reviewerUserId: tx.reviewerUserId,
            reviewQueue: 'assigned',
          },
          readMap,
        ),
      )
    }

    if (
      isCorrectionRequired(tx) &&
      roleAllowsKind(roleInput, 'correction_required') &&
      // Pure CSR / CSR+Producer: only corrections assigned to this CSR (ID preferred).
      (!roles.includes('csr') ||
        roles.includes('owner') ||
        roles.includes('admin') ||
        csrAssignmentMatches({
          csrUserId: tx.csrUserId,
          csrName: tx.csr,
          profileId: params.profileId,
          profileFullName: params.fullName,
          profileEmail: params.email,
        }))
    ) {
      items.push(
        withReadState(
          {
            id: `correction_required:${tx.id}`,
            kind: 'correction_required',
            category: 'transactions',
            title: `Transaction ${display(tx.transactionNumber)} returned for correction`,
            context: [
              `Returned by: ${display(tx.reviewReturnedByName)}`,
              `Reason: ${display(tx.reviewReturnReason)}`,
              txContext(tx),
            ].join(' · '),
            dateLabel: (tx.reviewReturnedAt || today).slice(0, 10),
            href: `/transactions/${tx.id}`,
            actionLabel: 'Open Transaction',
            sortDate: tx.reviewReturnedAt || today,
            reviewerUserId: tx.reviewerUserId,
            reviewQueue: 'returned',
          },
          readMap,
        ),
      )
    }

    if (
      tx.agencyCommissionConfirmed &&
      tx.reviewStatus === 'approved' &&
      tx.producerPaymentStatus === 'not_ready' &&
      !tx.paymentBatchId &&
      !tx.paidDate &&
      roleAllowsKind(roleInput, 'approved_not_ready')
    ) {
      items.push(
        withReadState(
          {
            id: `approved_not_ready:${tx.id}`,
            kind: 'approved_not_ready',
            category: 'transactions',
            title: 'Approved transaction not ready',
            context: txContext(tx),
            dateLabel: tx.transactionDate || null,
            href: `/transactions/${tx.id}`,
            actionLabel: 'Open Transaction',
            sortDate: tx.transactionDate || tx.id,
            reviewQueue: 'approved',
          },
          readMap,
        ),
      )
    }

    // Own-book match for producer commission context (Owner+Producer / CSR+Producer keep
    // agency-wide lists; this flag only personalizes own-producer notification copy/items).
    const isOwnProducerTx = Boolean(
      hasProducerIdentity &&
        ownProducerName &&
        producerKeysMatch(tx.producer, ownProducerName),
    )

    // Producer-only transaction lists are already book-scoped above. Owner/Admin/CSR
    // (including +Producer) must see agency-wide ready payouts.
    if (isReadyForPayout(tx) && roleAllowsKind(roleInput, 'ready_for_payout')) {
      items.push(
        withReadState(
          {
            id: `ready_for_payout:${tx.id}`,
            kind: 'ready_for_payout',
            category: 'financials',
            title: isOwnProducerTx
              ? 'Your commission is ready'
              : 'Producer commission ready for payout',
            context: `${display(tx.producer)} · ${formatCurrency(tx.producerCommissionAmount)} · ${display(tx.transactionNumber)}`,
            dateLabel: tx.transactionDate || null,
            href: producerLocked ? `/transactions/${tx.id}` : '/financials?tab=payments',
            actionLabel: producerLocked ? 'Open Transaction' : 'Open Financials',
            sortDate: tx.transactionDate || tx.id,
            amount: tx.producerCommissionAmount,
            reviewQueue: null,
          },
          readMap,
        ),
      )
    }

    if (
      hasProducerIdentity &&
      isOwnProducerTx &&
      (tx.producerPaymentStatus === 'paid' || Boolean(tx.paidDate)) &&
      roleAllowsKind(roleInput, 'commission_paid')
    ) {
      const paidIso = (tx.paidDate || tx.transactionDate || '').slice(0, 10)
      const age = daysUntil(paidIso)
      if (age !== null && age >= -30 && age <= 0) {
        items.push(
          withReadState(
            {
              id: `commission_paid:${tx.id}`,
              kind: 'commission_paid',
              category: 'financials',
              title: 'Commission paid',
              context: `${display(tx.transactionNumber)} · ${formatCurrency(tx.paidAmount ?? tx.producerCommissionAmount)}`,
              dateLabel: paidIso || null,
              href: `/transactions/${tx.id}`,
              actionLabel: 'Open Transaction',
              sortDate: paidIso || tx.id,
              amount: tx.paidAmount ?? tx.producerCommissionAmount,
              reviewQueue: null,
            },
            readMap,
          ),
        )
      }
    }
  }

  const batches = (batchesRes.data ?? []) as BatchRow[]
  for (const batch of batches) {
    if (!roleAllowsKind(roleInput, 'draft_batch')) continue
    items.push(
      withReadState(
        {
          id: `draft_batch:${batch.id}`,
          kind: 'draft_batch',
          category: 'financials',
          title: `Draft payment batch ${display(batch.batch_number)}`,
          context: `${display(batch.producer)} · ${formatCurrency(Number(batch.net_payment ?? 0))}`,
          dateLabel: (batch.created_at || '').slice(0, 10) || null,
          href: '/financials?tab=payments',
          actionLabel: 'Open Financials',
          sortDate: batch.created_at || batch.id,
          amount: Number(batch.net_payment ?? 0),
          reviewQueue: null,
        },
        readMap,
      ),
    )
  }

  const recoveries = (recoveriesRes.data ?? []) as RecoveryRow[]
  const usesRemaining = recoveries.some((r) => r.remaining_amount !== null && r.remaining_amount !== undefined)
  for (const row of recoveries) {
    if (!isOpenRecovery(row, usesRemaining)) continue
    if (!roleAllowsKind(roleInput, 'open_recovery')) continue
    const amount = usesRemaining ? Number(row.remaining_amount ?? 0) : Number(row.amount ?? 0)
    items.push(
      withReadState(
        {
          id: `open_recovery:${row.id}`,
          kind: 'open_recovery',
          category: 'recoveries',
          title: 'Open producer recovery',
          context: `${display(row.producer)} · ${formatCurrency(amount)}`,
          dateLabel: (row.created_at || '').slice(0, 10) || null,
          href: row.transaction_id
            ? `/transactions/${row.transaction_id}`
            : '/financials?tab=recoveries',
          actionLabel: row.transaction_id ? 'Open Transaction' : 'Open Financials',
          sortDate: row.created_at || row.id,
          amount,
          reviewQueue: null,
        },
        readMap,
      ),
    )
  }

  for (const policy of policies) {
    const expiration = policy.expiration_date
    const days = daysUntil(expiration)
    const client = firstEmbed(policy.clients)
    const status = String(policy.status ?? '').toLowerCase()
    if (status === 'renewal_due' && roleAllowsKind(roleInput, 'renewal_due')) {
      items.push(
        withReadState(
          {
            id: `renewal_due:${policy.id}`,
            kind: 'renewal_due',
            category: 'policies',
            title: `Renewal due · ${display(policy.policy_number)}`,
            context: `${display(client?.business_name)} · Producer ${display(policy.producer)}`,
            dateLabel: expiration,
            href: `/policies/${policy.id}`,
            actionLabel: 'Open Policy',
            sortDate: expiration || policy.id,
            reviewQueue: null,
          },
          readMap,
        ),
      )
    } else if (days !== null && days >= 0 && days <= 90 && roleAllowsKind(roleInput, 'policy_expiring')) {
      items.push(
        withReadState(
          {
            id: `policy_expiring:${policy.id}`,
            kind: 'policy_expiring',
            category: 'policies',
            title: `Policy expiring in ${days} day${days === 1 ? '' : 's'}`,
            context: `${display(policy.policy_number)} · ${display(client?.business_name)}`,
            dateLabel: expiration,
            href: `/policies/${policy.id}`,
            actionLabel: 'Open Policy',
            sortDate: expiration || policy.id,
            reviewQueue: null,
          },
          readMap,
        ),
      )
    }
  }

  items.sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)))

  const attention = buildAttentionSummary(items, {
    draftBatchCount: items.filter((i) => i.kind === 'draft_batch').length,
    openRecoveryCount: items.filter((i) => i.kind === 'open_recovery').length,
    openRecoveryAmount: items
      .filter((i) => i.kind === 'open_recovery')
      .reduce((sum, i) => sum + (i.amount ?? 0), 0),
    includeFinancials: isAdminDirectoryRole(roleInput),
  })

  const badgeCount = items.filter((i) => !i.read).length

  return {
    items,
    attention,
    badgeCount,
    producerLimitation,
    error: policiesRes.error?.message ?? batchesRes.error?.message ?? recoveriesRes.error?.message ?? null,
  }
}

function buildAttentionSummary(
  items: OperationalNotification[],
  extras: {
    draftBatchCount: number
    openRecoveryCount: number
    openRecoveryAmount: number
    includeFinancials: boolean
  },
): AttentionSummaryItem[] {
  const countKind = (kind: NotificationKind) => items.filter((i) => i.kind === kind).length

  const rows: AttentionSummaryItem[] = [
    {
      label: 'Agency commission awaiting receipt',
      count: countKind('awaiting_receipt'),
      href: '/transactions?confirmed=no',
    },
    {
      label: 'Assigned for your review',
      count: countKind('needs_review'),
      href: '/notifications?queue=assigned',
    },
    {
      label: 'Returned for correction',
      count: countKind('correction_required'),
      href: '/transactions?correction=yes',
    },
    {
      label: 'Approved but not Ready',
      count: countKind('approved_not_ready'),
      href: '/transactions?review=approved&payment=not_ready',
    },
    {
      label: 'Ready for producer payout',
      count: countKind('ready_for_payout'),
      href: '/financials?tab=payments',
    },
  ]

  if (extras.includeFinancials) {
    rows.push(
      {
        label: 'Draft payment batches',
        count: extras.draftBatchCount,
        href: '/financials?tab=payments&status=draft',
      },
      {
        label: 'Open recoveries',
        count: extras.openRecoveryCount,
        href: '/financials?tab=recoveries',
        hint:
          extras.openRecoveryAmount > 0
            ? formatCurrency(extras.openRecoveryAmount)
            : undefined,
      },
    )
  }

  rows.push(
    {
      label: 'Policies expiring (90 days)',
      count: countKind('policy_expiring'),
      href: '/policies',
    },
    {
      label: 'Renewals due',
      count: countKind('renewal_due'),
      href: '/policies',
    },
  )

  return rows.filter((row) => row.count > 0)
}

export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null
  if (count > 99) return '99+'
  return String(count)
}

export function notificationCategoryLabel(category: NotificationCategory): string {
  switch (category) {
    case 'transactions':
      return 'Transactions'
    case 'policies':
      return 'Policies'
    case 'financials':
      return 'Financials'
    case 'recoveries':
      return 'Recoveries'
    default:
      return category
  }
}

export function matchesReviewQueueFilter(
  item: OperationalNotification,
  filter: ReviewQueueFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'assigned') return item.kind === 'needs_review' || item.reviewQueue === 'assigned'
  if (filter === 'submitted') return item.kind === 'needs_review'
  if (filter === 'returned') return item.kind === 'correction_required'
  if (filter === 'approved') return item.kind === 'approved_not_ready'
  return true
}
