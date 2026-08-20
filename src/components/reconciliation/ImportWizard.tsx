import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { ColumnMapper } from './ColumnMapper'
import { supabase } from '../../lib/supabase'
import {
  applyColumnMapping,
  deleteColumnMapping,
  fetchColumnMappings,
  formatSignedCurrency,
  hashUtf8Sha256,
  importReconciliationStatement,
  normalizePastedStatementText,
  parseDelimitedStatementText,
  parseStatementFile,
  pastedStatementFileName,
  saveColumnMapping,
  suggestColumnMapping,
  type ColumnMapping,
  type ColumnMappingRecord,
  type ParsedStatementFile,
} from '../../lib/reconciliation'

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClass =
  'min-h-[220px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

type Party = { id: string; name: string }

export function ImportWizard(props: {
  open: boolean
  canDeleteMappings: boolean
  onClose: () => void
  onImported: (statementId: string) => void
}) {
  const [step, setStep] = useState(1)
  const [carriers, setCarriers] = useState<Party[]>([])
  const [mgas, setMgas] = useState<Party[]>([])
  const [carrierId, setCarrierId] = useState('')
  const [mgaId, setMgaId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [statementDate, setStatementDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file')
  const [pasteText, setPasteText] = useState('')
  const [parsed, setParsed] = useState<ParsedStatementFile | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [savedMappings, setSavedMappings] = useState<ColumnMappingRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detectMissing, setDetectMissing] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setStep(1)
    setFile(null)
    setParsed(null)
    setMapping({})
    setError(null)
    setDetectMissing(false)
    setInputMode('file')
    setPasteText('')
    void (async () => {
      const [c, m] = await Promise.all([
        supabase.from('carriers').select('id, carrier_name').is('archived_at', null).order('carrier_name'),
        supabase.from('mgas').select('id, mga_name').is('archived_at', null).order('mga_name'),
      ])
      setCarriers((c.data ?? []).map((r) => ({ id: String(r.id), name: String(r.carrier_name ?? '') })))
      setMgas((m.data ?? []).map((r) => ({ id: String(r.id), name: String(r.mga_name ?? '') })))
    })()
  }, [props.open])

  useEffect(() => {
    if (!props.open) return
    void (async () => {
      const result = await fetchColumnMappings({
        carrierId: carrierId || null,
        mgaId: mgaId || null,
      })
      const all = await fetchColumnMappings()
      setSavedMappings(result.data.length ? result.data : all.data)
    })()
  }, [props.open, carrierId, mgaId])

  const carrierName = carriers.find((c) => c.id === carrierId)?.name ?? null
  const mgaName = mgas.find((m) => m.id === mgaId)?.name ?? null
  const mappedRows = useMemo(
    () => (parsed ? applyColumnMapping(parsed.rows, mapping) : []),
    [parsed, mapping],
  )

  function applyParsed(result: ParsedStatementFile) {
    setParsed(result)
    setMapping(suggestColumnMapping(result.headers))
  }

  async function handleFile(next: File | null) {
    setError(null)
    setFile(next)
    setParsed(null)
    if (!next) return
    try {
      applyParsed(await parseStatementFile(next))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse file.')
    }
  }

  function switchMode(mode: 'file' | 'paste') {
    setInputMode(mode)
    setError(null)
    setParsed(null)
    setMapping({})
    if (mode === 'file') setPasteText('')
    else setFile(null)
  }

  async function handleImport() {
    setBusy(true)
    setError(null)
    try {
      let upload = file
      let contentHash: string | undefined
      if (inputMode === 'paste') {
        const normalized = normalizePastedStatementText(pasteText)
        upload = new File([normalized], pastedStatementFileName(), { type: 'text/plain' })
        contentHash = await hashUtf8Sha256(normalized)
      }
      if (!upload) {
        setError(inputMode === 'paste' ? 'Paste statement text before importing.' : 'Upload a file before importing.')
        return
      }
      const result = await importReconciliationStatement({
        file: upload,
        mapping,
        carrier: carrierName,
        mga: mgaName,
        carrierId: carrierId || null,
        mgaId: mgaId || null,
        periodStart,
        periodEnd,
        statementDate: statementDate || periodEnd,
        detectMissing,
        contentHash,
      })
      if (result.error && !result.data) {
        setError(result.error)
        return
      }
      if (result.data) props.onImported(result.data.id)
      if (result.error) setError(result.error)
      else props.onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!props.open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Import commission statement</h2>
            <p className="text-sm text-slate-500">Step {step} of 4 · CSV, XLSX, TXT, or paste</p>
          </div>
          <button type="button" onClick={props.onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 sm:col-span-2">
                Upload the commission statement you received from the carrier or MGA. ALZA Flow will compare it
                with your recorded transactions.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-500">Carrier</span>
                <select className={selectClass} value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
                  <option value="">— None —</option>
                  {carriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-500">MGA</span>
                <select className={selectClass} value={mgaId} onChange={(e) => setMgaId(e.target.value)}>
                  <option value="">— None —</option>
                  {mgas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-500">Period start</span>
                <input type="date" className={inputClass} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-500">Period end</span>
                <input type="date" className={inputClass} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-500">Statement date (optional)</span>
                <input
                  type="date"
                  className={inputClass}
                  value={statementDate}
                  onChange={(e) => setStatementDate(e.target.value)}
                />
              </label>
            </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Upload the commission statement you received from the carrier or MGA. ALZA Flow will compare it
                with your recorded transactions.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => switchMode('file')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    inputMode === 'file'
                      ? 'bg-alza-blue-700 text-white'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('paste')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    inputMode === 'paste'
                      ? 'bg-alza-blue-700 text-white'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Paste text
                </button>
              </div>
              {inputMode === 'file' ? (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center hover:border-alza-blue-400">
                  <p className="text-sm font-medium text-slate-800">Drop a CSV, XLSX, or TXT file, or click to browse</p>
                  <p className="mt-1 text-xs text-slate-500">{file ? file.name : 'No file selected'}</p>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Paste a headered table (comma, tab, or semicolon delimited)
                  </span>
                  <textarea
                    className={textareaClass}
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value)
                      setParsed(null)
                    }}
                    placeholder={'Policy Number,Commission Amount,Type\nBALAN001,937.50,endorsement'}
                  />
                </label>
              )}
            </div>
          )}

          {step === 3 && parsed && (
            <ColumnMapper
              headers={parsed.headers}
              previewRows={parsed.rows}
              mapping={mapping}
              savedMappings={savedMappings}
              canDeleteMappings={props.canDeleteMappings}
              onChange={setMapping}
              onLoadSaved={(saved) => setMapping(saved.mapping)}
              onSave={async (name) => {
                const payload = {
                  name,
                  mapping,
                  carrier: carrierName,
                  mga: mgaName,
                  carrierId: carrierId || null,
                  mgaId: mgaId || null,
                }
                let result = await saveColumnMapping(payload)
                if (result.needsOverwriteConfirm) {
                  const party =
                    result.needsOverwriteConfirm.carrier ||
                    result.needsOverwriteConfirm.mga ||
                    'this carrier/MGA'
                  const ok = window.confirm(
                    `A mapping named “${name}” already exists for ${party}. Update it with the current column mapping?`,
                  )
                  if (!ok) return
                  result = await saveColumnMapping({ ...payload, overwrite: true })
                }
                if (result.error) throw new Error(result.error)
                const refreshed = await fetchColumnMappings()
                setSavedMappings(refreshed.data)
              }}
              onDelete={async (id) => {
                const result = await deleteColumnMapping(id)
                if (result.error) {
                  setError(result.error)
                  return
                }
                setSavedMappings((prev) => prev.filter((m) => m.id !== id))
              }}
            />
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                {mappedRows.length} rows will be staged for {carrierName || mgaName || 'the selected party'}.
              </p>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={detectMissing}
                  onChange={(e) => setDetectMissing(e.target.checked)}
                />
                <span>
                  This file is the complete statement for this carrier/MGA and period. Detect missing
                  commissions for unpaid transactions that are not on the file.
                </span>
              </label>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left font-semibold text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Policy</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Commission</th>
                      <th className="px-3 py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 8).map((row) => (
                      <tr key={row.rowIndex} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">{row.policyNumber || '—'}</td>
                        <td className="px-3 py-1.5">{row.transactionType || '—'}</td>
                        <td className="px-3 py-1.5">{formatSignedCurrency(row.commissionAmount)}</td>
                        <td className="px-3 py-1.5">{row.transactionDate || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                setError(null)
                if (step === 1 && !carrierId && !mgaId) {
                  setError('Select a carrier or MGA.')
                  return
                }
                if (step === 1 && (!periodStart || !periodEnd)) {
                  setError('Set the statement period.')
                  return
                }
                if (step === 2) {
                  if (inputMode === 'file' && !parsed) {
                    setError('Upload a CSV, XLSX, or TXT file.')
                    return
                  }
                  if (inputMode === 'paste') {
                    try {
                      applyParsed(parseDelimitedStatementText(pasteText, 'paste'))
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Unable to parse pasted text.')
                      return
                    }
                  }
                }
                if (step === 3 && (!mapping.policy_number || !mapping.commission_amount)) {
                  setError('Map policy number and commission amount.')
                  return
                }
                setStep((s) => s + 1)
              }}
              className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleImport()}
              className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
            >
              {busy ? 'Importing and matching…' : 'Stage and run matching'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
