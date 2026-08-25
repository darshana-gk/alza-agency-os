/** Newest created_at first, then identifier DESC. Operational list default. */

function createdAtTime(value: string | null | undefined): number {
  const raw = String(value ?? '').trim()
  if (!raw) return Number.NaN
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function mapCreatedAtValue(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (value == null) return ''
  return String(value)
}

export function compareNewestCreatedThenCode(
  aCreatedAt: string | null | undefined,
  bCreatedAt: string | null | undefined,
  aCode: string | null | undefined,
  bCode: string | null | undefined,
) {
  const aTime = createdAtTime(aCreatedAt)
  const bTime = createdAtTime(bCreatedAt)
  const aMissing = !Number.isFinite(aTime)
  const bMissing = !Number.isFinite(bTime)
  if (aMissing !== bMissing) {
    // Valid created_at always ranks above missing/invalid on this DESC comparator.
    return aMissing ? 1 : -1
  }
  if (!aMissing && aTime !== bTime) {
    return bTime - aTime
  }
  return String(bCode ?? '').localeCompare(String(aCode ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

export function sortNewestCreatedThenCode<T>(
  rows: T[],
  createdAt: (row: T) => string | null | undefined,
  code: (row: T) => string | null | undefined,
): T[] {
  return [...rows].sort((a, b) =>
    compareNewestCreatedThenCode(createdAt(a), createdAt(b), code(a), code(b)),
  )
}
