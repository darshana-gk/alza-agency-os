import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Download, Eye, FileText, Trash2, Upload } from 'lucide-react'
import {
  DOCUMENT_TYPES,
  createSignedDocumentUrl,
  documentTypeLabels,
  fetchSupportingDocuments,
  softDeleteSupportingDocument,
  uploadSupportingDocument,
  type DocumentType,
  type SupportingDocument,
} from '../../lib/documents'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

function formatUploadedBy(doc: SupportingDocument): string {
  if (doc.uploadedByName?.trim()) return doc.uploadedByName.trim()
  if (doc.uploadedBy) {
    return doc.uploadedBy.length > 8 ? `${doc.uploadedBy.slice(0, 8)}…` : doc.uploadedBy
  }
  return '—'
}

function formatUploadedDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function SupportingDocumentsPanel(props: {
  entityType: 'transaction' | 'recovery'
  entityId: string
  transactionId?: string | null
  recoveryId?: string | null
  canUpload: boolean
  canDelete: boolean
  title?: string
}) {
  const {
    entityType,
    entityId,
    transactionId,
    recoveryId,
    canUpload,
    canDelete,
    title = 'Supporting Documents',
  } = props
  const [docs, setDocs] = useState<SupportingDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<DocumentType>('other')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchSupportingDocuments({
      transactionId: entityType === 'transaction' ? entityId : transactionId ?? undefined,
      recoveryId: entityType === 'recovery' ? entityId : recoveryId ?? undefined,
    })
    if (result.error) setError(result.error)
    setDocs(result.data)
    setLoading(false)
  }, [entityId, entityType, recoveryId, transactionId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setError(null)
    const result = await uploadSupportingDocument({
      entityType,
      entityId,
      transactionId: transactionId ?? (entityType === 'transaction' ? entityId : null),
      recoveryId: recoveryId ?? (entityType === 'recovery' ? entityId : null),
      documentType,
      file,
      notes,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.data) {
      setDocs((prev) => [result.data!, ...prev.filter((d) => d.id !== result.data!.id)])
      setLoading(false)
    }
    setFile(null)
    setNotes('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    // Re-fetch to confirm persistence / signed metadata.
    await load()
  }

  async function openDoc(doc: SupportingDocument, download: boolean) {
    const { url, error: urlError } = await createSignedDocumentUrl(doc.storagePath)
    if (urlError || !url) {
      setError(urlError ?? 'Could not create a signed link.')
      return
    }
    if (download) {
      const a = document.createElement('a')
      a.href = url
      a.download = doc.originalFilename
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.click()
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleDelete(doc: SupportingDocument) {
    if (!canDelete || busy) return
    const reason = window.prompt('Optional delete reason (kept for audit):', '') ?? ''
    setBusy(true)
    const result = await softDeleteSupportingDocument({ documentId: doc.id, reason })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-slate-500" />
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-slate-500">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate-500">No supporting documents yet.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0 space-y-0.5 text-xs text-slate-600">
                <p className="text-sm font-medium text-slate-900">
                  {documentTypeLabels[doc.documentType as DocumentType] ?? doc.documentType}
                </p>
                <p>
                  <span className="text-slate-400">File Name:</span> {doc.originalFilename || '—'}
                </p>
                <p>
                  <span className="text-slate-400">Uploaded By:</span> {formatUploadedBy(doc)}
                </p>
                <p>
                  <span className="text-slate-400">Uploaded Date:</span>{' '}
                  {formatUploadedDate(doc.uploadedAt)}
                </p>
                <p>
                  <span className="text-slate-400">Notes:</span> {doc.notes?.trim() || '—'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void openDoc(doc, false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  title="View"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void openDoc(doc, true)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(doc)}
                    className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                    title="Delete (soft)"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <form onSubmit={handleUpload} className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Document type</span>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                className={selectClassName}
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {documentTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">File</span>
              <input
                ref={fileInputRef}
                required
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-alza-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-alza-blue-800"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClassName}
              placeholder="Context for reviewers"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !file}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {busy ? 'Uploading…' : 'Upload document'}
          </button>
        </form>
      )}
    </div>
  )
}
