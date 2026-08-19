import type { ReactNode } from 'react'

export function MissingTransactionRow(props: { children: ReactNode }) {
  return (
    <tr className="border-t border-amber-100 bg-amber-50/60">
      {props.children}
    </tr>
  )
}
