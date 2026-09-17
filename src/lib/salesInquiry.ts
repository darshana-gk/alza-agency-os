import { supabase } from './supabase'

export const SALES_INQUIRY_USER_BANDS = ['51-100', '101-250', '251-500', '500+'] as const
export type SalesInquiryUserBand = (typeof SALES_INQUIRY_USER_BANDS)[number]

export const SALES_INQUIRY_SOURCES = ['pricing_contact', 'landing_contact', 'header_contact'] as const
export type SalesInquirySource = (typeof SALES_INQUIRY_SOURCES)[number]

export const SALES_INQUIRY_LIMITS = {
  fullName: 120,
  workEmail: 254,
  agencyName: 160,
  phone: 40,
  message: 2000,
} as const

export const SALES_INQUIRY_HONEYPOT_FIELD = 'company_website'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SalesInquiryInput = {
  fullName: string
  workEmail: string
  agencyName: string
  userBand: string
  phone?: string
  message?: string
  consent: boolean
  source?: string
  companyWebsite?: string
  turnstileToken?: string
}

export type SalesInquiryValidation =
  | { ok: true; value: NormalizedSalesInquiry }
  | { ok: false; code: string; message: string }

export type NormalizedSalesInquiry = {
  fullName: string
  workEmail: string
  agencyName: string
  userBand: SalesInquiryUserBand
  phone: string | null
  message: string | null
  consent: true
  source: SalesInquirySource
}

export function parseSalesInquirySource(value: unknown): SalesInquirySource {
  const raw = String(value ?? '').trim()
  if (raw === 'pricing_contact' || raw === 'pricing') return 'pricing_contact'
  if (raw === 'header_contact' || raw === 'header') return 'header_contact'
  return 'landing_contact'
}

export function isSalesInquiryUserBand(value: string): value is SalesInquiryUserBand {
  return (SALES_INQUIRY_USER_BANDS as readonly string[]).includes(value)
}

export function validateSalesInquiryInput(input: SalesInquiryInput): SalesInquiryValidation {
  const honeypot = String(input.companyWebsite ?? '').trim()
  if (honeypot) {
    return { ok: false, code: 'rejected', message: 'Unable to send inquiry.' }
  }

  const fullName = String(input.fullName ?? '').trim().replace(/\s+/g, ' ')
  const workEmail = String(input.workEmail ?? '').trim().toLowerCase()
  const agencyName = String(input.agencyName ?? '').trim().replace(/\s+/g, ' ')
  const userBand = String(input.userBand ?? '').trim()
  const phone = String(input.phone ?? '').trim()
  const message = String(input.message ?? '').trim()

  if (!fullName) return { ok: false, code: 'full_name_required', message: 'Enter your full name.' }
  if (fullName.length > SALES_INQUIRY_LIMITS.fullName) {
    return { ok: false, code: 'full_name_too_long', message: 'Full name is too long.' }
  }
  if (!workEmail) return { ok: false, code: 'email_required', message: 'Enter your work email.' }
  if (workEmail.length > SALES_INQUIRY_LIMITS.workEmail || !EMAIL_RE.test(workEmail)) {
    return { ok: false, code: 'email_invalid', message: 'Enter a valid work email.' }
  }
  if (!agencyName) return { ok: false, code: 'agency_required', message: 'Enter your agency name.' }
  if (agencyName.length > SALES_INQUIRY_LIMITS.agencyName) {
    return { ok: false, code: 'agency_too_long', message: 'Agency name is too long.' }
  }
  if (!isSalesInquiryUserBand(userBand)) {
    return { ok: false, code: 'user_band_required', message: 'Select the number of users.' }
  }
  if (phone.length > SALES_INQUIRY_LIMITS.phone) {
    return { ok: false, code: 'phone_too_long', message: 'Phone number is too long.' }
  }
  if (message.length > SALES_INQUIRY_LIMITS.message) {
    return { ok: false, code: 'message_too_long', message: 'Message is too long.' }
  }
  if (!input.consent) {
    return { ok: false, code: 'consent_required', message: 'Please confirm we may contact you about this inquiry.' }
  }

  return {
    ok: true,
    value: {
      fullName,
      workEmail,
      agencyName,
      userBand,
      phone: phone || null,
      message: message || null,
      consent: true,
      source: parseSalesInquirySource(input.source),
    },
  }
}

export function escapePlainText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function firstNameFromFullName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? ''
  return first || 'there'
}

export type SalesInquirySubmitResult = {
  received: boolean
  notified: boolean
  acknowledged: boolean
  error: string | null
  code: string | null
}

export async function submitSalesInquiry(input: SalesInquiryInput): Promise<SalesInquirySubmitResult> {
  const checked = validateSalesInquiryInput(input)
  if (!checked.ok) {
    return { received: false, notified: false, acknowledged: false, error: checked.message, code: checked.code }
  }

  const { data, error } = await supabase.functions.invoke('submit-sales-inquiry', {
    body: {
      fullName: checked.value.fullName,
      workEmail: checked.value.workEmail,
      agencyName: checked.value.agencyName,
      userBand: checked.value.userBand,
      phone: checked.value.phone,
      message: checked.value.message,
      consent: true,
      source: checked.value.source,
      companyWebsite: input.companyWebsite ?? '',
      turnstileToken: input.turnstileToken ?? '',
    },
  })

  const payload = (data ?? {}) as Record<string, unknown>
  if (error) {
    const message =
      typeof payload.message === 'string' && payload.message
        ? payload.message
        : error.message || 'Unable to send inquiry.'
    return {
      received: false,
      notified: false,
      acknowledged: false,
      error: message,
      code: typeof payload.code === 'string' ? payload.code : 'invoke_failed',
    }
  }

  if (payload.ok === false) {
    return {
      received: false,
      notified: false,
      acknowledged: false,
      error: String(payload.message ?? 'Unable to send inquiry.'),
      code: String(payload.code ?? 'inquiry_failed'),
    }
  }

  return {
    received: payload.received === true,
    notified: payload.notified === true,
    acknowledged: payload.acknowledged === true,
    error: null,
    code: null,
  }
}
