import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import type { TableExportFormat } from '../../lib/tableExport'

export function ExportMenu(props: {
  disabled?: boolean
  exporting?: boolean
  emptyMessage?: string
  /** Shown under the control (e.g. Activity cap notice). */
  hint?: string | null
  rowCount: number
  onExport: (format: TableExportFormat) => void | Promise<void>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const empty = props.rowCount <= 0
  const disabled = Boolean(props.disabled || props.exporting || empty)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function choose(format: TableExportFormat) {
    setLocalError(null)
    setOpen(false)
    if (empty) {
      setLocalError(props.emptyMessage ?? 'No records to export')
      return
    }
    try {
      await props.onExport(format)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  return (
    <div ref={rootRef} className={`relative inline-flex flex-col items-stretch gap-1 ${props.className ?? ''}`}>
      <button
        type="button"
        disabled={disabled && !empty}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={empty ? props.emptyMessage ?? 'No records to export' : undefined}
        onClick={() => {
          setLocalError(null)
          if (empty) {
            setLocalError(props.emptyMessage ?? 'No records to export')
            return
          }
          setOpen((v) => !v)
        }}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="h-4 w-4 text-slate-500" />
        {props.exporting ? 'Exporting…' : 'Export'}
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && !empty && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => void choose('xlsx')}
          >
            Excel (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => void choose('csv')}
          >
            CSV (.csv)
          </button>
        </div>
      )}

      {props.hint && <p className="text-xs text-slate-500">{props.hint}</p>}
      {localError && <p className="text-xs text-rose-600">{localError}</p>}
    </div>
  )
}
