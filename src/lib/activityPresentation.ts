import type { ActivityHistoryRow } from './activity'
import { formatCurrency, formatProducerPaymentMethodLabel, formatTypeLabel } from './commission'

function formatMoneyMaybe(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return formatCurrency(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return formatCurrency(Number(value))
  }
  return null
}

function formatDateMaybe(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const FIELD_LABELS: Record<string, string> = {
  amount: 'Amount',
  premiumAmount: 'Amount',
  amountReceived: 'Amount Received',
  agencyCommissionAmount: 'Agency Commission',
  producerCommissionAmount: 'Producer Commission',
  producer: 'Producer',
  producerSplitPercentage: 'Producer Split',
  type: 'Type',
  transactionType: 'Type',
  description: 'Description',
  notes: 'Notes',
  remarks: 'Remarks',
  csr: 'CSR',
  transactionEffectiveDate: 'Transaction Effective Date',
  transactionExpirationDate: 'Transaction Expiration Date',
  transactionDate: 'Transaction Date',
  reason: 'Reason',
  reviewReturnReason: 'Reason',
  documentType: 'Document Type',
  filename: 'File',
  paymentDate: 'Payment Date',
  paymentMethod: 'Payment Method',
  paymentReference: 'Payment Reference',
  netPayment: 'Net Amount Paid',
  grossCommission: 'Gross Producer Commission',
  recoveryApplied: 'Recovery / Chargeback Applied',
  batchNumber: 'Payment Batch',
}

const SKIP_KEYS = new Set([
  'entityId',
  'entityType',
  'storagePath',
  'voided',
  'deleted',
  'resubmit',
  'transactionIds',
  'clientId',
  'policyId',
  'reviewerUserId',
  'id',
])

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  )
}

export function humanActivityValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') {
    // Avoid null/false noise in summaries unless the field is meaningful.
    if (value === false) return null
    return 'Yes'
  }
  if (Array.isArray(value)) return null
  if (isPlainObject(value)) return null
  if (typeof value === 'string' && looksLikeUuid(value)) return null

  if (key === 'paymentMethod') {
    return formatProducerPaymentMethodLabel(String(value))
  }
  if (key.toLowerCase().includes('split') && typeof value === 'number') {
    return `${Number(value).toFixed(2)}%`
  }
  if (key.toLowerCase().includes('type') && typeof value === 'string') {
    return formatTypeLabel(value)
  }
  if (
    key.toLowerCase().includes('date') ||
    key.toLowerCase().includes('effective') ||
    key.toLowerCase().includes('expiration')
  ) {
    return formatDateMaybe(value) ?? String(value)
  }
  const money = formatMoneyMaybe(value)
  if (
    money &&
    (key.toLowerCase().includes('amount') ||
      key.toLowerCase().includes('premium') ||
      key.toLowerCase().includes('commission') ||
      key.toLowerCase().includes('fee') ||
      key.toLowerCase().includes('payment') ||
      key.toLowerCase().includes('recovery') ||
      key.toLowerCase().includes('gross') ||
      key.toLowerCase().includes('net'))
  ) {
    return money
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return null
}

export function meaningfulFieldChanges(row: ActivityHistoryRow): string[] {
  const lines: string[] = []
  const oldObj = isPlainObject(row.oldValue) ? row.oldValue : {}
  const newObj = isPlainObject(row.newValue) ? row.newValue : {}
  const keys = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])]

  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue
    const label = FIELD_LABELS[key] ?? null
    if (!label) continue
    const before = humanActivityValue(key, oldObj[key])
    const after = humanActivityValue(key, newObj[key])
    if (before === null && after === null) continue
    if (before === after) continue
    if (before === null && after) lines.push(`${label}: ${after}`)
    else if (before && after === null) lines.push(`${label}: ${before} → —`)
    else if (before && after) lines.push(`${label}: ${before} → ${after}`)
  }
  return lines
}

export function formatActivityActionLabel(action: string): string {
  switch (action) {
    case 'transaction_create':
      return 'Transaction created'
    case 'transaction_edit':
      return 'Transaction edited'
    case 'transaction_receipt_confirm':
      return 'Commission receipt confirmed'
    case 'transaction_submit':
      return 'Submitted for Review'
    case 'transaction_return':
      return 'Returned for Correction'
    case 'transaction_approve':
      return 'Approved'
    case 'transaction_mark_ready':
      return 'Marked Ready for Payout'
    case 'transaction_void':
      return 'Transaction voided'
    case 'transaction_archive':
      return 'Transaction archived'
    case 'payment_batch_create':
      return 'Payment batch created'
    case 'producer_payout_confirm':
      return 'Producer payment confirmed'
    case 'document_upload':
      return 'Document uploaded'
    case 'document_delete':
      return 'Document removed'
    case 'recovery_create':
      return 'Recovery recorded'
    case 'recovery_direct_payment':
      return 'Direct recovery payment'
    case 'recovery_void':
      return 'Recovery voided'
    case 'reconciliation_import':
      return 'Statement imported'
    case 'reconciliation_mapping_saved':
      return 'Column mapping saved'
    case 'reconciliation_matching_started':
      return 'Matching started'
    case 'reconciliation_matching_completed':
      return 'Matching completed'
    case 'reconciliation_manual_match':
      return 'Manual match'
    case 'reconciliation_manual_unmatch':
      return 'Match removed'
    case 'reconciliation_exception_resolved':
      return 'Needs Review item resolved'
    case 'reconciliation_receipts_confirmed':
      return 'Reconciliation receipts confirmed'
    case 'reconciliation_receipts_failed':
      return 'Reconciliation receipt confirmation failed'
    case 'reconciliation_completed':
      return 'Statement completed'
    case 'reconciliation_cancelled':
      return 'Statement cancelled'
    default:
      return action.replace(/_/g, ' ')
  }
}

export function formatActivityEntityLabel(entityType: string): string {
  switch (entityType) {
    case 'payment_batch':
      return 'Payment batch'
    case 'transaction':
      return 'Transaction'
    case 'recovery':
      return 'Recovery'
    case 'document':
      return 'Document'
    case 'client':
      return 'Client'
    case 'policy':
      return 'Policy'
    case 'producer':
      return 'Producer'
    case 'user':
      return 'User'
    case 'agency':
      return 'Agency'
    case 'reconciliation':
      return 'Reconciliation'
    default:
      return entityType.replace(/_/g, ' ') || '—'
  }
}

/** Single Details / Changes summary for the main Activity History table. */
export function formatActivityDetailsSummary(row: ActivityHistoryRow): string {
  const ref = row.recordReference?.trim() || ''
  const newObj = isPlainObject(row.newValue) ? row.newValue : {}
  const oldObj = isPlainObject(row.oldValue) ? row.oldValue : {}

  switch (row.action) {
    case 'transaction_create':
      return ref ? `Transaction created — ${ref}` : 'Transaction created'

    case 'transaction_receipt_confirm': {
      const amount =
        humanActivityValue('amountReceived', newObj.amountReceived) ||
        humanActivityValue('amount', newObj.amount ?? newObj.agencyCommissionAmount)
      return amount ? `Agency commission received: ${amount}` : 'Agency commission received'
    }

    case 'transaction_submit':
      return newObj.resubmit || oldObj.reviewReturnReason
        ? 'Resubmitted for Review'
        : 'Submitted for Review'

    case 'transaction_return': {
      const reason =
        humanActivityValue('reason', newObj.reason ?? newObj.reviewReturnReason) ||
        humanActivityValue('reason', oldObj.reason)
      return reason ? `Returned for Correction — ${reason}` : 'Returned for Correction'
    }

    case 'transaction_approve':
      return 'Approved'

    case 'transaction_mark_ready': {
      const amount =
        humanActivityValue(
          'producerCommissionAmount',
          newObj.producerCommissionAmount ?? newObj.amount ?? newObj.producerCommission,
        ) || humanActivityValue('amount', newObj.amount)
      return amount
        ? `Producer commission marked Ready for Payout — ${amount}`
        : 'Producer commission marked Ready for Payout'
    }

    case 'recovery_create': {
      const amount =
        humanActivityValue('amount', newObj.amount) ||
        humanActivityValue('amount', newObj.recoveryAmount)
      const producer = humanActivityValue('producer', newObj.producer)
      if (amount && producer) return `Recovery recorded — ${amount} for ${producer}`
      if (amount) return `Recovery recorded — ${amount}`
      if (ref) return `Recovery recorded — ${ref}`
      return 'Recovery recorded'
    }

    case 'payment_batch_create': {
      const batch = ref || humanActivityValue('batchNumber', newObj.batchNumber) || 'Payment batch'
      const gross = humanActivityValue('grossCommission', newObj.grossCommission)
      const recovery = humanActivityValue('recoveryApplied', newObj.recoveryApplied)
      const net = humanActivityValue('netPayment', newObj.netPayment)
      const parts = [
        gross ? `Gross ${gross}` : null,
        recovery ? `Recovery ${recovery}` : null,
        net ? `Net ${net}` : null,
      ].filter(Boolean)
      return parts.length
        ? `Payment batch ${batch} created — ${parts.join(' · ')}`
        : `Payment batch ${batch} created`
    }

    case 'producer_payout_confirm': {
      const net = humanActivityValue('netPayment', newObj.netPayment)
      const method = humanActivityValue('paymentMethod', newObj.paymentMethod)
      const date = humanActivityValue('paymentDate', newObj.paymentDate)
      const parts = [net, method, date].filter(Boolean)
      return parts.length
        ? `Producer payment confirmed — ${parts.join(' · ')}`
        : 'Producer payment confirmed'
    }

    case 'document_upload': {
      const filename =
        humanActivityValue('filename', newObj.filename) ||
        humanActivityValue('filename', newObj.originalFilename) ||
        ref
      return filename ? `Document uploaded — ${filename}` : 'Document uploaded'
    }

    case 'document_delete': {
      const filename =
        humanActivityValue('filename', oldObj.filename) ||
        humanActivityValue('filename', newObj.filename) ||
        ref
      return filename ? `Document removed — ${filename}` : 'Document removed'
    }

    case 'transaction_edit': {
      const changes = meaningfulFieldChanges(row)
      if (changes.length === 0) return 'Transaction updated'
      return changes.join(' · ')
    }

    case 'transaction_void': {
      const reason = humanActivityValue('reason', newObj.reason ?? newObj.voidReason)
      return reason ? `Transaction voided — ${reason}` : 'Transaction voided'
    }

    case 'transaction_archive':
      return ref ? `Transaction archived — ${ref}` : 'Transaction archived'

    case 'recovery_direct_payment': {
      const amount = humanActivityValue('amount', newObj.amount)
      return amount ? `Direct recovery payment recorded — ${amount}` : 'Direct recovery payment recorded'
    }

    case 'recovery_void':
      return 'Recovery voided'

    default: {
      const changes = meaningfulFieldChanges(row)
      if (changes.length > 0) return changes.join(' · ')
      if (ref) return ref
      return formatActivityActionLabel(row.action)
    }
  }
}

/** Drawer timeline headline (includes actor). */
export function activityDrawerHeadline(row: ActivityHistoryRow): string {
  const who = row.actorName?.trim() || 'Someone'
  const newObj = isPlainObject(row.newValue) ? row.newValue : {}
  const oldObj = isPlainObject(row.oldValue) ? row.oldValue : {}
  switch (row.action) {
    case 'transaction_create':
      return `Transaction created by ${who}`
    case 'transaction_edit':
      return `Transaction corrected by ${who}`
    case 'transaction_receipt_confirm':
      return `Commission receipt confirmed by ${who}`
    case 'transaction_submit':
      return newObj.resubmit || oldObj.reviewReturnReason
        ? `Resubmitted for review by ${who}`
        : `Submitted for review by ${who}`
    case 'transaction_approve':
      return `Approved by ${who}`
    case 'transaction_return':
      return `Returned for correction by ${who}`
    case 'transaction_mark_ready':
      return `Marked ready for payout by ${who}`
    case 'payment_batch_create':
      return `Added to payment batch by ${who}`
    case 'producer_payout_confirm':
      return `Producer payment recorded by ${who}`
    case 'transaction_void':
      return `Transaction voided by ${who}`
    case 'transaction_archive':
      return `Transaction archived by ${who}`
    case 'document_upload':
      return `Supporting document uploaded by ${who}`
    case 'document_delete':
      return `Supporting document removed by ${who}`
    case 'recovery_create':
      return `Recovery / chargeback recorded by ${who}`
    case 'recovery_direct_payment':
      return `Direct recovery payment recorded by ${who}`
    case 'recovery_void':
      return `Recovery voided by ${who}`
    default:
      return `${row.action.replace(/_/g, ' ')} · ${who}`
  }
}

/** Drawer timeline supporting detail lines. */
export function activityDrawerDetailLines(row: ActivityHistoryRow): string[] {
  const newObj = isPlainObject(row.newValue) ? row.newValue : {}
  const oldObj = isPlainObject(row.oldValue) ? row.oldValue : {}

  if (row.action === 'transaction_create') {
    const lines: string[] = []
    for (const key of Object.keys(newObj)) {
      if (SKIP_KEYS.has(key)) continue
      const label = FIELD_LABELS[key]
      if (!label) continue
      const after = humanActivityValue(key, newObj[key])
      if (after) lines.push(`${label}: ${after}`)
    }
    return lines
  }

  if (row.action === 'transaction_return') {
    const reason = humanActivityValue('reason', newObj.reason ?? newObj.reviewReturnReason)
    return reason ? [`Reason: ${reason}`] : []
  }

  if (row.action === 'transaction_edit') {
    return meaningfulFieldChanges(row)
  }

  if (row.action === 'producer_payout_confirm') {
    const lines: string[] = []
    const paymentDate = humanActivityValue('paymentDate', newObj.paymentDate)
    const paymentMethod = humanActivityValue('paymentMethod', newObj.paymentMethod)
    const paymentReference = humanActivityValue('paymentReference', newObj.paymentReference)
    const notes = humanActivityValue('notes', newObj.notes)
    const gross = humanActivityValue('grossCommission', newObj.grossCommission)
    const recovery = humanActivityValue('recoveryApplied', newObj.recoveryApplied)
    const net = humanActivityValue('netPayment', newObj.netPayment)
    if (paymentDate) lines.push(`Payment Date: ${paymentDate}`)
    if (paymentMethod) lines.push(`Payment Method: ${paymentMethod}`)
    if (paymentReference) lines.push(`Payment Reference: ${paymentReference}`)
    if (notes) lines.push(`Notes: ${notes}`)
    if (gross) lines.push(`Gross Producer Commission: ${gross}`)
    if (recovery) lines.push(`Recovery / Chargeback Applied: ${recovery}`)
    if (net) lines.push(`Net Amount Paid: ${net}`)
    return lines
  }

  if (row.action === 'payment_batch_create') {
    const lines: string[] = []
    const gross = humanActivityValue('grossCommission', newObj.grossCommission)
    const recovery = humanActivityValue('recoveryApplied', newObj.recoveryApplied)
    const net = humanActivityValue('netPayment', newObj.netPayment)
    const producer = humanActivityValue('producer', newObj.producer)
    if (producer) lines.push(`Producer: ${producer}`)
    if (gross) lines.push(`Gross: ${gross}`)
    if (recovery) lines.push(`Recovery: ${recovery}`)
    if (net) lines.push(`Net: ${net}`)
    return lines
  }

  if (row.action === 'document_upload') {
    const filename =
      humanActivityValue('filename', newObj.filename) ||
      humanActivityValue('filename', newObj.originalFilename)
    const docType = humanActivityValue('documentType', newObj.documentType)
    const lines: string[] = []
    if (docType) lines.push(`Document Type: ${docType}`)
    if (filename) lines.push(`File: ${filename}`)
    return lines
  }

  if (row.action === 'transaction_receipt_confirm') {
    const amount =
      humanActivityValue('amountReceived', newObj.amountReceived) ||
      humanActivityValue('amount', newObj.amount)
    return amount ? [`Amount Received: ${amount}`] : []
  }

  if (row.action === 'transaction_mark_ready') {
    const amount = humanActivityValue(
      'producerCommissionAmount',
      newObj.producerCommissionAmount ?? newObj.amount,
    )
    return amount ? [`Producer Commission: ${amount}`] : []
  }

  if (row.action === 'recovery_create') {
    const amount = humanActivityValue('amount', newObj.amount)
    const producer = humanActivityValue('producer', newObj.producer)
    const lines: string[] = []
    if (amount) lines.push(`Amount: ${amount}`)
    if (producer) lines.push(`Producer: ${producer}`)
    return lines
  }

  // Avoid unused-var lint for oldObj in default path
  void oldObj
  return meaningfulFieldChanges(row)
}

