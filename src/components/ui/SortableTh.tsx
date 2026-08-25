import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { KeyboardEvent, ReactNode, ThHTMLAttributes } from 'react'
import type { SortDirection } from '../../lib/tableSort'

interface SortableThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'children'> {
  children: ReactNode
  active?: boolean
  direction?: SortDirection
  onSort: () => void
  align?: 'left' | 'right'
  label?: string
}

const headerClass =
  'relative px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500'

export function SortableTh({
  children,
  active = false,
  direction = 'asc',
  onSort,
  align = 'left',
  className = '',
  label,
  ...props
}: SortableThProps) {
  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
  const sortLabel = label ?? (typeof children === 'string' ? children : 'column')

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSort()
    }
  }

  function handleSort(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault()
    event.stopPropagation()
    onSort()
  }

  return (
    <th
      {...props}
      aria-sort={ariaSort}
      className={`${headerClass} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        onClick={handleSort}
        onKeyDown={handleKeyDown}
        aria-label={`Sort by ${sortLabel}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-alza-blue-500/40"
      />
      <span
        className={`relative z-0 inline-flex w-full items-center gap-1.5 ${
          align === 'right' ? 'justify-end' : 'justify-start'
        }`}
      >
        <span>{children}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
        )}
      </span>
    </th>
  )
}
