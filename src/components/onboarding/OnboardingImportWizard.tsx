import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import {
  listWorkbookSheets,
  parseOnboardingDelimitedText,
  parseOnboardingSpreadsheet,
  type WorkbookSheetInfo,
} from '../../lib/onboardingIntake'
import {
  ONBOARDING_ENTITY_LABELS,
  ONBOARDING_FILE_ACCEPT,
  applyOnboardingMappingChange,
  buildOnboardingPreview,
  buildOnboardingResultLogCsv,
  canImportOnboardingEntity,
  executeOnboardingImport,
  formatOnboardingStatus,
  requiredFieldsMapped,
  resolveUploadFileControlAction,
  buildOnboardingMappingSelectModel,
  runOnboardingParseToMappingStep,
  suggestOnboardingMapping,
  type OnboardingEntity,
  type OnboardingImportResult,
  type OnboardingMapping,
  type OnboardingPreviewResult,
} from '../../lib/onboardingImport'
import { roleInputFromProfile } from '../../lib/permissions'
import { useAuth } from '../../lib/auth'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const ENTITIES: OnboardingEntity[] = [
  'carriers',
  'mgas',
  'producers',
  'csrs',
  'clients',
  'policies',
]

export function OnboardingImportWizard(props: {
  open: boolean
  onClose: () => void
}) {
  const { profile } = useAuth()
  const role = roleInputFromProfile(profile)
  const allowedEntities = useMemo(
    () => ENTITIES.filter((e) => canImportOnboardingEntity(role, e)),
    [role],
  )

  const [step, setStep] = useState(1)
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file')
  const [pasteText, setPasteText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sheets, setSheets] = useState<WorkbookSheetInfo[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [entity, setEntity] = useState<OnboardingEntity>(allowedEntities[0] ?? 'carriers')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<OnboardingMapping>({})
  const [preview, setPreview] = useState<OnboardingPreviewResult | null>(null)
  const [result, setResult] = useState<OnboardingImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Single shared file input — Upload file button and drop zone both open this picker. */
  const fileInputRef = useRef<HTMLInputElement>(null)

  const prevOpenRef = useRef(false)

  useEffect(() => {
    const justOpened = props.open && !prevOpenRef.current
    prevOpenRef.current = props.open
    if (!justOpened) return
    setStep(1)
    setInputMode('file')
    setPasteText('')
    setFile(null)
    setSheets([])
    setSheetIndex(0)
    setEntity(allowedEntities[0] ?? 'carriers')
    setHeaders([])
    setRows([])
    setMapping({})
    setPreview(null)
    setResult(null)
    setError(null)
    setDragOver(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [props.open])

  useEffect(() => {
    if (!props.open || allowedEntities.length === 0) return
    setEntity((current) => (allowedEntities.includes(current) ? current : allowedEntities[0]))
  }, [props.open, allowedEntities])

  function changeEntity(next: OnboardingEntity) {
    setEntity(next)
    setPreview(null)
    setResult(null)
    setError(null)
    if (headers.length > 0) {
      setMapping(suggestOnboardingMapping(next, headers))
    } else {
      setMapping({})
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function onUploadFileControlClick() {
    const action = resolveUploadFileControlAction(inputMode)
    setInputMode(action.nextMode)
    if (action.openFilePicker) openFilePicker()
  }

  async function handleFile(next: File | null) {
    setError(null)
    setFile(next)
    setSheets([])
    setHeaders([])
    setRows([])
    setMapping({})
    setPreview(null)
    setInputMode('file')
    if (!next) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    try {
      const list = await listWorkbookSheets(next)
      setSheets(list)
      setSheetIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read file.')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function applyParsed(parsed: { headers: string[]; rows: Record<string, unknown>[] }) {
    const next = runOnboardingParseToMappingStep(entity, parsed)
    setHeaders(next.headers)
    setRows(next.rows)
    setMapping(next.mapping)
    setStep(next.step)
  }

  async function loadSheet() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const lower = file.name.toLowerCase()
      const isDelimited = lower.endsWith('.csv') || lower.endsWith('.txt')
      const sheetName = sheets[sheetIndex]?.name
      const parsed = await parseOnboardingSpreadsheet(file, {
        sheetIndex,
        sheetName: isDelimited ? null : sheetName,
      })
      applyParsed(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to parse spreadsheet.')
    } finally {
      setBusy(false)
    }
  }

  async function loadPaste() {
    setBusy(true)
    setError(null)
    try {
      const parsed = parseOnboardingDelimitedText(pasteText, 'paste')
      setFile(null)
      setSheets([])
      applyParsed(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to parse pasted table.')
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    const req = requiredFieldsMapped(entity, mapping)
    if (!req.ok) {
      setError(`Map required fields: ${req.missing.join(', ')}.`)
      return
    }
    setBusy(true)
    setError(null)
    const out = await buildOnboardingPreview({ entity, rows, mapping })
    setBusy(false)
    if (out.error) {
      setError(out.error)
      return
    }
    setPreview(out.data)
    setStep(4)
  }

  async function runImport() {
    if (!preview) return
    setBusy(true)
    setError(null)
    const out = await executeOnboardingImport({ entity: preview.entity, preview })
    setBusy(false)
    if (out.error) {
      setError(out.error)
      return
    }
    setResult(out.data)
    setStep(5)
  }

  function downloadResultLog() {
    if (!preview || !result) return
    const csv = buildOnboardingResultLogCsv(preview, result)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `onboarding_${entity}_result_log.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!props.open) return null

  const mappingSelects = buildOnboardingMappingSelectModel(entity, mapping, headers)
  const canContinueFile = Boolean(file) && allowedEntities.length > 0
  const canContinuePaste = pasteText.trim().length > 0 && allowedEntities.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Onboarding Import</h2>
            <p className="text-sm text-slate-500">
              Upload CSV/TXT/XLSX or paste a table. Map columns, preview, then insert ready rows only.
            </p>
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

          <div className="mb-4 rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-3 py-2 text-sm text-alza-blue-900">
            Importing: <span className="font-semibold">{ONBOARDING_ENTITY_LABELS[entity]}</span>
            {preview ? ` · Preview built for ${ONBOARDING_ENTITY_LABELS[preview.entity]}` : ''}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">What are you importing?</span>
                <select
                  className={selectClass}
                  value={entity}
                  onChange={(e) => changeEntity(e.target.value as OnboardingEntity)}
                >
                  {allowedEntities.map((e) => (
                    <option key={e} value={e}>
                      {ONBOARDING_ENTITY_LABELS[e]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onUploadFileControlClick}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    inputMode === 'file' ? 'bg-alza-blue-700 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('paste')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    inputMode === 'paste' ? 'bg-alza-blue-700 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  Paste table
                </button>
              </div>

              {/* One hidden input for both Upload file and the drop zone — never nest a second input. */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ONBOARDING_FILE_ACCEPT}
                className="hidden"
                data-onboarding-file-input="true"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />

              {inputMode === 'file' ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={openFilePicker}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openFilePicker()
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const dropped = e.dataTransfer.files?.[0] ?? null
                    void handleFile(dropped)
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center ${
                    dragOver
                      ? 'border-alza-blue-500 bg-alza-blue-50'
                      : 'border-slate-300 bg-slate-50 hover:border-alza-blue-400'
                  }`}
                >
                  <Upload className="mb-2 h-8 w-8 text-slate-400" />
                  <p className="text-sm font-medium text-slate-800">
                    Drop a CSV, TXT, XLSX, or XLS file, or click to browse
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    {file ? (
                      <>
                        Selected:{' '}
                        <span className="font-semibold text-slate-900">{file.name}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">No file selected</span>
                    )}
                  </p>
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Paste comma-, tab-, or semicolon-delimited data with a header row
                  </span>
                  <textarea
                    className="min-h-[180px] w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={'Business Name,Email\nAcme LLC,ops@acme.example'}
                  />
                </label>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                File: <span className="font-medium">{file?.name}</span>. Choose the sheet that contains{' '}
                {ONBOARDING_ENTITY_LABELS[entity].toLowerCase()}.
              </p>
              <select
                className={selectClass}
                value={sheetIndex}
                onChange={(e) => setSheetIndex(Number(e.target.value))}
              >
                {sheets.map((s) => (
                  <option key={s.index} value={s.index}>
                    {s.name}
                    {s.rowCount >= 0 ? ` (${s.rowCount} rows)` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                {rows.length} data rows found. Spreadsheet columns detected:{' '}
                {headers.length ? headers.map((h) => `"${h}"`).join(', ') : '(none)'}. Review column
                mappings. Required fields must be mapped.
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">ALZA field</th>
                      <th className="px-3 py-2">Spreadsheet column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingSelects.map((row) => (
                      <tr key={row.fieldKey} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          {row.label}
                          {row.required ? <span className="text-rose-600"> *</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className={selectClass}
                            data-onboarding-field={row.fieldKey}
                            value={row.value}
                            onChange={(e) =>
                              setMapping((m) =>
                                applyOnboardingMappingChange(
                                  m,
                                  row.fieldKey,
                                  e.target.value || undefined,
                                ),
                              )
                            }
                          >
                            <option value="">— Not mapped —</option>
                            {row.options.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 4 && preview && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-800">
                Preview for {ONBOARDING_ENTITY_LABELS[preview.entity]}
              </p>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: 'Total', value: preview.total },
                  { label: 'Ready', value: preview.ready },
                  { label: 'Skipped duplicate', value: preview.skippedDuplicate },
                  { label: 'Possible duplicate', value: preview.possibleDuplicate },
                  { label: 'Missing required', value: preview.missingRequired },
                  { label: 'Invalid', value: preview.invalid },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left font-semibold text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Details</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((r) => (
                      <tr key={r.rowIndex} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">{r.rowIndex}</td>
                        <td className="px-3 py-1.5">{formatOnboardingStatus(r.status)}</td>
                        <td className="px-3 py-1.5">
                          {Object.entries(r.display)
                            .map(([k, v]) => `${k}: ${v || '—'}`)
                            .join(' · ')}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">{r.reasons.join(' ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 200 && (
                <p className="text-xs text-slate-500">Showing first 200 of {preview.rows.length} rows.</p>
              )}
              <p className="text-sm text-slate-600">
                Only <span className="font-medium">Ready</span> rows will be inserted. Existing ALZA data wins —
                duplicates are skipped. Nothing is overwritten.
              </p>
            </div>
          )}

          {step === 5 && result && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Import finished for {ONBOARDING_ENTITY_LABELS[preview?.entity ?? entity]}.
              </p>
              <ul className="list-inside list-disc text-sm text-slate-700">
                <li>Inserted: {result.imported}</li>
                <li>Skipped duplicate: {result.skippedDuplicate}</li>
                <li>Skipped validation: {result.skippedValidation}</li>
                <li>Failed: {result.failed}</li>
              </ul>
              {result.errors.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {result.errors.slice(0, 20).map((e) => (
                    <p key={e}>{e}</p>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={downloadResultLog}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download CSV result log
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            disabled={busy || step === 1 || step === 5}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Back
          </button>
          <div className="flex gap-2">
            {step === 1 && inputMode === 'file' && (
              <button
                type="button"
                disabled={!canContinueFile || busy}
                onClick={() => {
                  const lower = file?.name.toLowerCase() ?? ''
                  const multiSheet =
                    sheets.length > 1 && !lower.endsWith('.csv') && !lower.endsWith('.txt')
                  if (multiSheet) setStep(2)
                  else void loadSheet()
                }}
                className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
              >
                Continue
              </button>
            )}
            {step === 1 && inputMode === 'paste' && (
              <button
                type="button"
                disabled={!canContinuePaste || busy}
                onClick={() => void loadPaste()}
                className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
              >
                Parse paste
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadSheet()}
                className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
              >
                Read sheet
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPreview()}
                className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
              >
                Preview & validate
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                disabled={busy || !preview || preview.ready === 0}
                onClick={() => void runImport()}
                className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-40"
              >
                {busy ? 'Importing…' : `Import ${preview?.ready ?? 0} ready rows`}
              </button>
            )}
            {step === 5 && (
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

