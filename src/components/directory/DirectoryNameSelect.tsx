import { useEffect, useMemo, useState } from 'react'
import { fetchActiveCsrNames, fetchActiveProducerNames } from '../../lib/directory'

const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

interface DirectoryNameSelectProps {
  kind: 'producer' | 'csr'
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  required?: boolean
  className?: string
  allowEmpty?: boolean
  emptyLabel?: string
}

/**
 * TEXT-valued directory dropdown. Preserves historical values not in the active list.
 */
export function DirectoryNameSelect({
  kind,
  value,
  onChange,
  id,
  disabled,
  required,
  className = selectClassName,
  allowEmpty = true,
  emptyLabel,
}: DirectoryNameSelectProps) {
  const [options, setOptions] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const result =
        kind === 'producer' ? await fetchActiveProducerNames() : await fetchActiveCsrNames()
      if (cancelled) return
      if (result.error) {
        setLoadError(result.error.message)
        setOptions([])
        return
      }
      setLoadError(null)
      setOptions(result.data)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [kind])

  const merged = useMemo(() => {
    const current = value.trim()
    if (current && !options.includes(current)) {
      return [current, ...options]
    }
    return options
  }, [options, value])

  return (
    <div>
      <select
        id={id}
        disabled={disabled}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      >
        {allowEmpty && <option value="">{emptyLabel ?? (kind === 'producer' ? 'Select producer…' : 'Select CSR…')}</option>}
        {merged.map((name) => (
          <option key={name} value={name}>
            {name}
            {value.trim() === name && !options.includes(name) ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
      {loadError && <p className="mt-1 text-xs text-red-600">Directory load: {loadError}</p>}
    </div>
  )
}
