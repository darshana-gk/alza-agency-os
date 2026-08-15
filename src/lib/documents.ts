import { supabase } from './supabase'
import { recordActivity } from './activity'
import { canManageRecoveries, canManageTransactions, rejectUnlessRole } from './permissions'

export const DOCUMENT_TYPES = [
  'invoice',
  'mga_statement',
  'carrier_statement',
  'commission_statement',
  'payment_confirmation',
  'endorsement',
  'audit_document',
  'other',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const documentTypeLabels: Record<DocumentType, string> = {
  invoice: 'Invoice',
  mga_statement: 'MGA Statement',
  carrier_statement: 'Carrier Statement',
  commission_statement: 'Commission Statement',
  payment_confirmation: 'Payment Confirmation',
  endorsement: 'Endorsement',
  audit_document: 'Audit Document',
  other: 'Other Supporting Document',
}

export interface SupportingDocument {
  id: string
  entityType: 'transaction' | 'recovery'
  entityId: string
  transactionId: string | null
  recoveryId: string | null
  documentType: string
  originalFilename: string
  storagePath: string
  contentType: string
  byteSize: number | null
  notes: string
  uploadedBy: string | null
  uploadedByName: string | null
  uploadedAt: string
  deletedAt: string | null
}

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function mapDoc(row: Record<string, unknown>): SupportingDocument {
  const uploader = firstEmbed(
    row.uploader as { full_name?: string | null } | { full_name?: string | null }[] | null,
  )
  const uploadedBy = (row.uploaded_by as string | null) ?? null
  const nameFromJoin = uploader?.full_name?.trim() || null
  return {
    id: String(row.id),
    entityType: row.entity_type === 'recovery' ? 'recovery' : 'transaction',
    entityId: String(row.entity_id),
    transactionId: (row.transaction_id as string | null) ?? null,
    recoveryId: (row.recovery_id as string | null) ?? null,
    documentType: String(row.document_type ?? 'other'),
    originalFilename: String(row.original_filename ?? ''),
    storagePath: String(row.storage_path ?? ''),
    contentType: String(row.content_type ?? ''),
    byteSize: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    notes: String(row.notes ?? ''),
    uploadedBy,
    uploadedByName: nameFromJoin,
    uploadedAt: String(row.uploaded_at ?? ''),
    deletedAt: (row.deleted_at as string | null) ?? null,
  }
}

const DOC_SELECT_WITH_UPLOADER = `
  id, entity_type, entity_id, transaction_id, recovery_id, document_type,
  original_filename, storage_path, content_type, byte_size, notes,
  uploaded_by, uploaded_at, deleted_at,
  uploader:users!supporting_documents_uploaded_by_fkey(full_name)
`

const DOC_SELECT_BASIC = `
  id, entity_type, entity_id, transaction_id, recovery_id, document_type,
  original_filename, storage_path, content_type, byte_size, notes,
  uploaded_by, uploaded_at, deleted_at
`

async function currentUserId(): Promise<string | null> {
  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return null
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function fetchSupportingDocuments(params: {
  transactionId?: string
  recoveryId?: string
  includeDeleted?: boolean
}): Promise<{ data: SupportingDocument[]; error: string | null }> {
  /**
   * Documents belong to the transaction/recovery entity — not the uploader.
   * Query by transaction_id / recovery_id first (authoritative), then merge any
   * legacy rows that only set entity_id. Avoid nested PostgREST `and(...)`
   * filters that have returned empty sets for some clients.
   */
  const run = async (select: string, column: string, id: string) => {
    let query = supabase
      .from('supporting_documents')
      .select(select)
      .eq(column, id)
      .order('uploaded_at', { ascending: false })
    if (!params.includeDeleted) query = query.is('deleted_at', null)
    return query
  }

  const mergeRows = (batches: Array<Record<string, unknown>[]>) => {
    const byId = new Map<string, Record<string, unknown>>()
    for (const batch of batches) {
      for (const row of batch) {
        const id = String(row.id ?? '')
        if (id) byId.set(id, row)
      }
    }
    return [...byId.values()].sort((a, b) =>
      String(b.uploaded_at ?? '').localeCompare(String(a.uploaded_at ?? '')),
    )
  }

  const loadForEntity = async (select: string) => {
    const batches: Array<Record<string, unknown>[]> = []
    if (params.transactionId) {
      const byTxn = await run(select, 'transaction_id', params.transactionId)
      if (byTxn.error) return { data: [] as Record<string, unknown>[], error: byTxn.error.message }
      batches.push((byTxn.data ?? []) as unknown as Record<string, unknown>[])

      const byEntity = await run(select, 'entity_id', params.transactionId)
      if (!byEntity.error && byEntity.data) {
        batches.push(
          ((byEntity.data ?? []) as unknown as Record<string, unknown>[]).filter(
            (row) => String(row.entity_type ?? '') === 'transaction',
          ),
        )
      }
    }
    if (params.recoveryId) {
      const byRec = await run(select, 'recovery_id', params.recoveryId)
      if (byRec.error) return { data: [] as Record<string, unknown>[], error: byRec.error.message }
      batches.push((byRec.data ?? []) as unknown as Record<string, unknown>[])

      const byEntity = await run(select, 'entity_id', params.recoveryId)
      if (!byEntity.error && byEntity.data) {
        batches.push(
          ((byEntity.data ?? []) as unknown as Record<string, unknown>[]).filter(
            (row) => String(row.entity_type ?? '') === 'recovery',
          ),
        )
      }
    }
    if (!params.transactionId && !params.recoveryId) {
      return { data: [] as Record<string, unknown>[], error: 'transactionId or recoveryId required' }
    }
    return { data: mergeRows(batches), error: null as string | null }
  }

  const first = await loadForEntity(DOC_SELECT_WITH_UPLOADER)
  if (first.error) {
    const second = await loadForEntity(DOC_SELECT_BASIC)
    if (second.error) return { data: [], error: second.error }
    return { data: second.data.map((row) => mapDoc(row)), error: null }
  }
  return { data: first.data.map((row) => mapDoc(row)), error: null }
}

export async function uploadSupportingDocument(input: {
  entityType: 'transaction' | 'recovery'
  entityId: string
  transactionId?: string | null
  recoveryId?: string | null
  documentType: string
  file: File
  notes?: string
}): Promise<{ data: SupportingDocument | null; error: string | null }> {
  const authz = await rejectUnlessRole(canManageTransactions)
  if (!authz.ok) return { data: null, error: authz.message }

  const uploaderId = await currentUserId()
  const safeName = input.file.name.replace(/[^\w.\-()+ ]+/g, '_')
  const path = `${input.entityType}/${input.entityId}/${crypto.randomUUID()}_${safeName}`
  const contentType = input.file.type?.trim() || 'application/octet-stream'

  const { error: uploadError } = await supabase.storage
    .from('supporting-documents')
    .upload(path, input.file, {
      contentType,
      upsert: false,
    })

  if (uploadError) {
    return {
      data: null,
      error: `Storage upload failed: ${uploadError.message}`,
    }
  }

  const payload = {
    entity_type: input.entityType,
    entity_id: input.entityId,
    transaction_id:
      input.entityType === 'transaction'
        ? input.transactionId || input.entityId
        : input.transactionId || null,
    recovery_id: input.entityType === 'recovery' ? input.recoveryId || input.entityId : null,
    document_type: input.documentType,
    original_filename: input.file.name,
    storage_path: path,
    content_type: contentType,
    byte_size: input.file.size,
    notes: input.notes?.trim() || null,
    uploaded_by: uploaderId,
  }

  const { data, error } = await supabase
    .from('supporting_documents')
    .insert(payload)
    .select(DOC_SELECT_BASIC)
    .single()

  if (error) {
    await supabase.storage.from('supporting-documents').remove([path])
    return { data: null, error: `Document record failed: ${error.message}` }
  }

  const mapped = mapDoc(data as Record<string, unknown>)
  // Resolve uploader display name for immediate UI refresh.
  if (!mapped.uploadedByName && uploaderId) {
    const { data: userRow } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', uploaderId)
      .maybeSingle()
    mapped.uploadedByName = userRow?.full_name?.trim() || null
  }
  await recordActivity({
    action: 'document_upload',
    entityType: 'document',
    entityId: mapped.id,
    recordReference: mapped.originalFilename,
    transactionId: mapped.transactionId,
    newValue: {
      documentType: mapped.documentType,
      filename: mapped.originalFilename,
      entityType: mapped.entityType,
      entityId: mapped.entityId,
    },
  })

  return { data: mapped, error: null }
}

export async function createSignedDocumentUrl(
  storagePath: string,
  expiresIn = 120,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage
    .from('supporting-documents')
    .createSignedUrl(storagePath, expiresIn)
  if (error) return { url: null, error: error.message }
  return { url: data.signedUrl, error: null }
}

export async function softDeleteSupportingDocument(input: {
  documentId: string
  reason?: string
}): Promise<{ error: string | null }> {
  // Soft-delete requires admin financial authority for evidence control.
  const authz = await rejectUnlessRole(canManageRecoveries)
  if (!authz.ok) return { error: authz.message }

  const actorId = await currentUserId()
  const { data: existing, error: fetchError } = await supabase
    .from('supporting_documents')
    .select('*')
    .eq('id', input.documentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError) return { error: fetchError.message }
  if (!existing) return { error: 'Document not found or already deleted.' }

  const { error } = await supabase
    .from('supporting_documents')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: actorId,
      delete_reason: input.reason?.trim() || null,
    })
    .eq('id', input.documentId)
    .is('deleted_at', null)

  if (error) return { error: error.message }

  await recordActivity({
    action: 'document_delete',
    entityType: 'document',
    entityId: input.documentId,
    recordReference: String(existing.original_filename ?? ''),
    transactionId: (existing.transaction_id as string | null) ?? null,
    oldValue: {
      filename: existing.original_filename,
      documentType: existing.document_type,
      storagePath: existing.storage_path,
    },
    newValue: { deleted: true, reason: input.reason?.trim() || null },
  })

  return { error: null }
}
