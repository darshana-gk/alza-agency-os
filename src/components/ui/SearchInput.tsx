import type { FormEvent, InputHTMLAttributes } from 'react'

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onSearch'> & {
  /** Native search event (including clear “x” on type=search). */
  onSearch?: (event: FormEvent<HTMLInputElement>) => void
}

/**
 * Typed search field wrapper. Prefer this over raw `<input type="search" onSearch={...} />`
 * so `onSearch` is a first-class prop with a concrete event type (avoids TS2322 / TS7006).
 */
export function SearchInput({ onSearch, className, ...rest }: SearchInputProps) {
  return (
    <input
      type="search"
      className={className}
      onSearch={onSearch}
      {...rest}
    />
  )
}
