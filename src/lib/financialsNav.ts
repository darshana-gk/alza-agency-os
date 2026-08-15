import type { Location } from 'react-router-dom'

/** Location state for Financials hops and contextual transaction return. */
export type FinancialsNavState = {
  financialsReturnTo?: string
  /** Where transaction detail should return when closed (X / backdrop / Back). */
  txnReturnTo?: string
  txnReturnLabel?: 'Financials' | 'Policy' | 'Client' | 'Transactions'
}

export type TxnReturnLabel = NonNullable<FinancialsNavState['txnReturnLabel']>

export function financialsReturnFromLocation(
  location: Location,
): string | null {
  const state = location.state as FinancialsNavState | null
  const path = state?.financialsReturnTo?.trim()
  if (!path || !path.startsWith('/financials')) return null
  return path
}

export function financialsLinkState(returnTo: string): FinancialsNavState {
  return {
    financialsReturnTo: returnTo,
    txnReturnTo: returnTo,
    txnReturnLabel: 'Financials',
  }
}

/** Preserve Financials return when hopping Client ↔ Policy. */
export function withFinancialsReturn(
  financialsReturnTo: string | null | undefined,
  existing?: FinancialsNavState | null,
): FinancialsNavState | undefined {
  const path = financialsReturnTo?.trim()
  if (!path || !path.startsWith('/financials')) {
    return existing ?? undefined
  }
  return {
    ...(existing ?? {}),
    financialsReturnTo: path,
  }
}

function isSafeTxnReturnPath(path: string): boolean {
  return (
    path.startsWith('/financials') ||
    path.startsWith('/policies/') ||
    path.startsWith('/clients/') ||
    path === '/transactions' ||
    path.startsWith('/transactions?')
  )
}

/** Resolve contextual return for transaction detail drawer. */
export function txnReturnFromLocation(
  location: Location,
): { path: string; label: TxnReturnLabel } | null {
  const state = location.state as FinancialsNavState | null
  const path = state?.txnReturnTo?.trim()
  const label = state?.txnReturnLabel

  if (path && label && isSafeTxnReturnPath(path)) {
    return { path, label }
  }

  const financials = financialsReturnFromLocation(location)
  if (financials) {
    return { path: financials, label: 'Financials' }
  }

  return null
}

export function transactionLinkState(opts: {
  returnTo: string
  returnLabel: TxnReturnLabel
  financialsReturnTo?: string | null
  existing?: FinancialsNavState | null
}): FinancialsNavState {
  const financials =
    opts.financialsReturnTo?.trim() ||
    opts.existing?.financialsReturnTo?.trim() ||
    undefined

  return {
    ...(opts.existing ?? {}),
    ...(financials && financials.startsWith('/financials')
      ? { financialsReturnTo: financials }
      : {}),
    txnReturnTo: opts.returnTo,
    txnReturnLabel: opts.returnLabel,
  }
}

/** Canonical tab id used in URL + UI. */
export type FinancialsTabId = 'receipts' | 'payments' | 'recoveries'

export function parseFinancialsTab(raw: string | null | undefined): FinancialsTabId {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'payments' || value === 'producer-payments') return 'payments'
  if (value === 'recoveries') return 'recoveries'
  return 'receipts'
}

export const financialsRecordLinkClassName =
  'font-medium text-alza-blue-700 hover:underline hover:text-alza-blue-800 cursor-pointer'
