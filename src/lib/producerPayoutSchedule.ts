/**
 * Planning-only producer payout schedule.
 * Never creates batches, marks ready/paid, or moves money.
 */

export type ProducerPayoutSchedule =
  | 'weekly'
  | 'biweekly'
  | 'semi_monthly'
  | 'monthly'
  | 'custom'

export const PRODUCER_PAYOUT_SCHEDULE_OPTIONS: {
  key: ProducerPayoutSchedule
  label: string
  hint: string
}[] = [
  { key: 'weekly', label: 'Weekly', hint: 'Same weekday as the anchor date.' },
  { key: 'biweekly', label: 'Biweekly', hint: 'Every 14 days from the anchor date.' },
  { key: 'semi_monthly', label: 'Semi-monthly', hint: '1st and 15th of each month.' },
  { key: 'monthly', label: 'Monthly', hint: 'Same day of month as the anchor date.' },
  { key: 'custom', label: 'Custom', hint: 'Described in notes. Next date is not calculated.' },
]

export const PAYOUT_SCHEDULE_DB_FIELDS = [
  'producer_payout_schedule',
  'producer_payout_schedule_notes',
  'producer_payout_anchor_date',
] as const

export function isProducerPayoutSchedule(
  value: string | null | undefined,
): value is ProducerPayoutSchedule {
  return (
    value === 'weekly' ||
    value === 'biweekly' ||
    value === 'semi_monthly' ||
    value === 'monthly' ||
    value === 'custom'
  )
}

export function formatPayoutScheduleLabel(value: string | null | undefined): string {
  const match = PRODUCER_PAYOUT_SCHEDULE_OPTIONS.find((item) => item.key === value)
  return match?.label ?? 'Not set'
}

function parseIsoDate(iso: string | null | undefined): Date | null {
  const v = (iso ?? '').trim().slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function utcDateOnOrAfterDayOfMonth(from: Date, dayOfMonth: number): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const dim = daysInUtcMonth(year, month)
  const day = Math.min(Math.max(dayOfMonth, 1), dim)
  const candidate = new Date(Date.UTC(year, month, day))
  if (candidate.getTime() >= from.getTime()) return candidate
  const nextMonth = month === 11 ? 0 : month + 1
  const nextYear = month === 11 ? year + 1 : year
  const nextDim = daysInUtcMonth(nextYear, nextMonth)
  return new Date(Date.UTC(nextYear, nextMonth, Math.min(dayOfMonth, nextDim)))
}

export function nextPlannedPayoutDate(input: {
  schedule: string | null | undefined
  anchorDate?: string | null
  fromDate?: string | null
}): string | null {
  if (!isProducerPayoutSchedule(input.schedule) || input.schedule === 'custom') return null
  const from = parseIsoDate(input.fromDate) ?? parseIsoDate(new Date().toISOString().slice(0, 10))
  if (!from) return null
  const anchor = parseIsoDate(input.anchorDate)

  if (input.schedule === 'semi_monthly') {
    const day = from.getUTCDate()
    if (day <= 1) return toIsoDate(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)))
    if (day <= 15) return toIsoDate(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 15)))
    const nextMonth = from.getUTCMonth() === 11 ? 0 : from.getUTCMonth() + 1
    const nextYear = from.getUTCMonth() === 11 ? from.getUTCFullYear() + 1 : from.getUTCFullYear()
    return toIsoDate(new Date(Date.UTC(nextYear, nextMonth, 1)))
  }

  if (!anchor) return null

  if (input.schedule === 'weekly') {
    const targetDow = anchor.getUTCDay()
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = addUtcDays(from, offset)
      if (candidate.getUTCDay() === targetDow) return toIsoDate(candidate)
    }
    return null
  }

  if (input.schedule === 'biweekly') {
    if (from.getTime() <= anchor.getTime()) return toIsoDate(anchor)
    const diffDays = Math.floor((from.getTime() - anchor.getTime()) / 86400000)
    const remainder = diffDays % 14
    if (remainder === 0) return toIsoDate(from)
    return toIsoDate(addUtcDays(from, 14 - remainder))
  }

  if (input.schedule === 'monthly') {
    return toIsoDate(utcDateOnOrAfterDayOfMonth(from, anchor.getUTCDate()))
  }

  return null
}

export function formatPaymentChannelLabel(
  channel: string | null | undefined,
  status?: string | null,
): string {
  const paid = (status ?? '').toLowerCase() === 'paid'
  if (channel === 'alza_flow_pay') return 'ALZA Flow Pay'
  if (channel === 'outside_alza_flow') return 'Outside ALZA Flow'
  if (paid) return 'Outside ALZA Flow'
  return '—'
}

export function payoutScheduleIsPlanningOnly(): true {
  return true
}
