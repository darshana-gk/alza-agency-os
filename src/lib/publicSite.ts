/** Public marketing/contact paths. Does not replace billing catalog or checkout. */

export const PUBLIC_LANDING_PATH = '/'
export const PUBLIC_LOGIN_PATH = '/login'
export const PUBLIC_PRICING_PATH = '/pricing'
export const PUBLIC_SIGNUP_PATH = '/signup'
export const PUBLIC_CONTACT_SALES_PATH = '/contact-sales'

/** Hero/final Get Started enters the existing public pricing → signup journey. */
export const PUBLIC_GET_STARTED_PATH = PUBLIC_PRICING_PATH

export const PUBLIC_CONTACT_EMAIL = 'support@alzabusiness.com'

/** Authenticated/support mailto remains for in-app and login support only. */
export const PUBLIC_DEMO_MAILTO =
  'mailto:support@alzabusiness.com?subject=ALZA%20Flow%20demo%20request'

export const PUBLIC_PRICING_INQUIRY_MAILTO =
  'mailto:support@alzabusiness.com?subject=ALZA%20Flow%20pricing%20inquiry'

export const PUBLIC_PAGE_TITLE =
  'ALZA Flow | Commission Operations & Reconciliation for Insurance Agencies'

export const PUBLIC_PAGE_DESCRIPTION =
  'ALZA Flow helps insurance agencies reconcile carrier and MGA commission statements, identify missing or incorrect commissions, manage producer commissions, and understand commission revenue without replacing their AMS.'

export function applyPublicDocumentMeta(title = PUBLIC_PAGE_TITLE, description = PUBLIC_PAGE_DESCRIPTION) {
  document.title = title
  const meta = document.querySelector('meta[name="description"]')
  if (meta) meta.setAttribute('content', description)
}

export function contactSalesPath(source: 'landing_contact' | 'pricing_contact' = 'landing_contact') {
  return `${PUBLIC_CONTACT_SALES_PATH}?source=${source}`
}
