import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PublicMarketingHeader } from '../components/marketing/TalkToAlzaLink'
import {
  parseSalesInquirySource,
  SALES_INQUIRY_HONEYPOT_FIELD,
  SALES_INQUIRY_LIMITS,
  SALES_INQUIRY_USER_BANDS,
  submitSalesInquiry,
  validateSalesInquiryInput,
} from '../lib/salesInquiry'
import { applyPublicDocumentMeta } from '../lib/publicSite'

const RECEIVED_COPY =
  "Thank you for contacting ALZA. We've received your inquiry and our team will get back to you shortly."

export function ContactSalesPage() {
  const [params] = useSearchParams()
  const source = useMemo(() => parseSalesInquirySource(params.get('source')), [params])
  const [fullName, setFullName] = useState('')
  const [workEmail, setWorkEmail] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [userBand, setUserBand] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [received, setReceived] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    applyPublicDocumentMeta('Talk to ALZA · ALZA Flow')
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const checked = validateSalesInquiryInput({
      fullName,
      workEmail,
      agencyName,
      jobTitle,
      userBand,
      phone,
      message,
      consent,
      source,
      companyWebsite: honeypot,
    })
    if (!checked.ok) {
      setError(checked.message)
      return
    }
    setSubmitting(true)
    const result = await submitSalesInquiry({
      fullName,
      workEmail,
      agencyName,
      jobTitle,
      userBand,
      phone,
      message,
      consent,
      source,
      companyWebsite: honeypot,
    })
    setSubmitting(false)
    if (!result.received) {
      setError(result.error || 'Unable to send inquiry.')
      return
    }
    setAcknowledged(result.acknowledged)
    setReceived(true)
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-brand-neutral">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-brand-sky blur-3xl" />
        <div className="absolute right-0 top-24 h-80 w-80 rounded-full bg-brand-teal/20 blur-3xl" />
      </div>
      <PublicMarketingHeader />

      <main className="relative mx-auto w-full max-w-2xl px-4 py-14 sm:px-6 lg:py-20">
        <p className="mkt-eyebrow">Contact</p>
        <h1 className="mkt-display mt-4 text-3xl sm:text-4xl">Talk to ALZA</h1>
        <p className="mt-4 max-w-xl text-base text-slate-600">
          Tell us a little about your agency and we'll get back to you.
        </p>

        {received ? (
          <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)]">
            <p className="text-xl font-semibold text-brand-navy">Inquiry received.</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{RECEIVED_COPY}</p>
            {acknowledged ? (
              <p className="mt-4 text-sm text-slate-500">We've also sent a confirmation to your work email.</p>
            ) : null}
          </div>
        ) : (
          <form className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.35)] sm:p-8" onSubmit={handleSubmit} noValidate>
            <div className="mkt-hp" aria-hidden="true">
              <input
                id={SALES_INQUIRY_HONEYPOT_FIELD}
                name={SALES_INQUIRY_HONEYPOT_FIELD}
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <div className="grid gap-5">
              <Field label="Full Name" htmlFor="fullName" required>
                <input
                  id="fullName"
                  name="fullName"
                  autoComplete="name"
                  required
                  maxLength={SALES_INQUIRY_LIMITS.fullName}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Work Email" htmlFor="workEmail" required>
                <input
                  id="workEmail"
                  name="workEmail"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={SALES_INQUIRY_LIMITS.workEmail}
                  value={workEmail}
                  onChange={(e) => setWorkEmail(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Company Name" htmlFor="companyName" required>
                <input
                  id="companyName"
                  name="agencyName"
                  autoComplete="organization"
                  required
                  maxLength={SALES_INQUIRY_LIMITS.agencyName}
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Job Title / Designation" htmlFor="jobTitle" required>
                <input
                  id="jobTitle"
                  name="jobTitle"
                  autoComplete="organization-title"
                  required
                  maxLength={SALES_INQUIRY_LIMITS.jobTitle}
                  placeholder="e.g. Agency Owner, Operations Manager"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Number of Users" htmlFor="userBand" required>
                <select
                  id="userBand"
                  name="userBand"
                  required
                  value={userBand}
                  onChange={(e) => setUserBand(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a range</option>
                  {SALES_INQUIRY_USER_BANDS.map((band) => (
                    <option key={band} value={band}>
                      {band === '500+' ? '500+' : band.replace('-', '–')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={SALES_INQUIRY_LIMITS.phone}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Message / What can we help with?" htmlFor="message" required>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  required
                  minLength={SALES_INQUIRY_LIMITS.messageMin}
                  maxLength={SALES_INQUIRY_LIMITS.message}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className={`${inputClass} min-h-[8rem] resize-y`}
                />
              </Field>
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-teal"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>I agree to be contacted by ALZA regarding my inquiry.</span>
              </label>
            </div>

            {error ? <p className="mt-5 text-sm text-red-700">{error}</p> : null}

            <button
              type="submit"
              disabled={submitting}
              className="mkt-btn mkt-btn-primary mt-8 inline-flex h-12 w-full items-center justify-center text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Send Inquiry'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

const inputClass =
  'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-brand-teal/25 focus:border-brand-teal focus:ring-2'

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
        {label}
        {required ? <span className="text-brand-teal"> *</span> : <span className="ml-1 text-xs font-normal text-slate-400">Optional</span>}
      </label>
      {children}
    </div>
  )
}
