/** Shared browse-table sorting. Sort raw values, not formatted labels. */

export type SortDirection = 'asc' | 'desc'
export type SortValueType = 'string' | 'number' | 'date'
export type SortValue = string | number | boolean | null | undefined

export interface TableSortState<K extends string = string> {
  key: K
  direction: SortDirection
}

/** First click on a new column is ASC; same column toggles ASC ↔ DESC. */
export function nextTableSort<K extends string>(
  current: TableSortState<K>,
  key: K,
): TableSortState<K> {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: 'asc' }
}

function directionMultiplier(direction: SortDirection) {
  return direction === 'asc' ? 1 : -1
}

export function compareString(a: string | null | undefined, b: string | null | undefined) {
  const av = (a ?? '').trim()
  const bv = (b ?? '').trim()
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareNumber(a: number | null | undefined, b: number | null | undefined) {
  const aMissing = a == null || !Number.isFinite(a)
  const bMissing = b == null || !Number.isFinite(b)
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  return a - b
}

/** ASC: nulls first. DESC: nulls last. */
export function compareIsoDate(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: SortDirection,
) {
  const av = a && String(a).trim() ? Date.parse(String(a)) : Number.NaN
  const bv = b && String(b).trim() ? Date.parse(String(b)) : Number.NaN
  const aMissing = !Number.isFinite(av)
  const bMissing = !Number.isFinite(bv)
  if (aMissing && bMissing) return 0
  if (aMissing) return direction === 'asc' ? -1 : 1
  if (bMissing) return direction === 'asc' ? 1 : -1
  return (av - bv) * directionMultiplier(direction)
}

export function compareSortValues(
  a: SortValue,
  b: SortValue,
  direction: SortDirection,
  type: SortValueType = 'string',
) {
  if (type === 'date') return compareIsoDate(a == null ? '' : String(a), b == null ? '' : String(b), direction)
  const base =
    type === 'number'
      ? compareNumber(typeof a === 'number' ? a : Number(a), typeof b === 'number' ? b : Number(b))
      : compareString(a == null ? '' : String(a), b == null ? '' : String(b))
  return base * directionMultiplier(direction)
}

export function sortRows<T, K extends string>(
  rows: T[],
  state: TableSortState<K>,
  accessors: Record<K, (row: T) => SortValue>,
  types?: Partial<Record<K, SortValueType>>,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const accessor = accessors[state.key]
  if (!accessor) return [...rows]
  const type = types?.[state.key] ?? 'string'
  return [...rows].sort((a, b) => {
    const result = compareSortValues(accessor(a), accessor(b), state.direction, type)
    if (result !== 0) return result
    return tieBreak ? tieBreak(a, b) : 0
  })
}

export const DIRECTORY_NAME_SORT: TableSortState<'name'> = { key: 'name', direction: 'asc' }
export const CREATED_AT_DESC: TableSortState<'createdAt'> = { key: 'createdAt', direction: 'desc' }
