import { useMemo, useState } from 'react'
import type { ColumnMapping, ColumnMappingRecord, ReconciliationFieldKey } from '../../lib/reconciliation'
import { RECONCILIATION_STANDARD_FIELDS } from '../../lib/reconciliation'

const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export function ColumnMapper(props: {
  headers: string[]
  previewRows: Record<string, unknown>[]
  mapping: ColumnMapping
  savedMappings: ColumnMappingRecord[]
  canDeleteMappings: boolean
  onChange: (mapping: ColumnMapping) => void
  onLoadSaved: (saved: ColumnMappingRecord) => void
  onSave: (name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usedHeaders = useMemo(() => new Set(Object.values(props.mapping).filter(Boolean)), [props.mapping])

  function setField(key: ReconciliationFieldKey, header: string) {
    props.onChange({ ...props.mapping, [key]: header || undefined })
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      await props.onSave(saveName.trim())
      setSaveName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save mapping.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Load saved mapping</span>
          <select
            className={selectClass}
            defaultValue=""
            onChange={(e) => {
              const saved = props.savedMappings.find((m) => m.id === e.target.value)
              if (saved) props.onLoadSaved(saved)
            }}
          >
            <option value="">Select a saved mapping…</option>
            {props.savedMappings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.carrier || m.mga ? ` · ${m.carrier || m.mga}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Save current mapping as</span>
          <input
            className={inputClass}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g. Carrier XYZ Monthly"
          />
        </label>
        <button
          type="button"
          disabled={saving || !saveName.trim()}
          onClick={() => void handleSave()}
          className="h-10 rounded-lg bg-alza-blue-700 px-4 text-sm font-medium text-white hover:bg-alza-blue-800 disabled:opacity-50"
        >
          Save mapping
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {props.canDeleteMappings && props.savedMappings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {props.savedMappings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => void props.onDelete(m.id)}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-700"
            >
              Delete “{m.name}”{m.carrier || m.mga ? ` (${m.carrier || m.mga})` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">ALZA field</th>
              <th className="px-3 py-2">Statement column</th>
            </tr>
          </thead>
          <tbody>
            {RECONCILIATION_STANDARD_FIELDS.map((field) => (
              <tr key={field.key} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {field.label}
                  {field.required && <span className="ml-1 text-rose-600">*</span>}
                </td>
                <td className="px-3 py-2">
                  <select
                    className={selectClass}
                    value={props.mapping[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                  >
                    <option value="">— Not mapped —</option>
                    {props.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                        {usedHeaders.has(h) && props.mapping[field.key] !== h ? ' (used)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Preview (first 5 rows)</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {props.headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-2 text-left font-semibold text-slate-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.previewRows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {props.headers.map((h) => (
                    <td key={h} className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                      {String(row[h] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
