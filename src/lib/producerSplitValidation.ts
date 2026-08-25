/** Shared Producer Split % rules for create/edit. Does not rewrite stored historical values. */

export const PRODUCER_SPLIT_REQUIRED_MESSAGE =
  'Producer Commission Split % is required and must be between 0 and 100. Enter 0 if no producer commission applies.'

/**
 * Validate a form/string split value.
 * Blank and whitespace are invalid. 0 is valid. Range is 0–100 inclusive.
 * Does not coerce blank to 0.
 */
export function validateProducerSplitPercentage(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100) return PRODUCER_SPLIT_REQUIRED_MESSAGE
    return null
  }
  if (value == null) return PRODUCER_SPLIT_REQUIRED_MESSAGE
  const raw = String(value).trim()
  if (raw === '') return PRODUCER_SPLIT_REQUIRED_MESSAGE
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return PRODUCER_SPLIT_REQUIRED_MESSAGE
  }
  return null
}

export function parseProducerSplitPercentage(
  value: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const error = validateProducerSplitPercentage(value)
  if (error) return { ok: false, error }
  return { ok: true, value: Number(value.trim()) }
}
