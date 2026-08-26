import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CreditCard, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { canManageBilling, rolesOf } from '../../lib/permissions'
import {
  canCancelSubscription,
  cancelRazorpaySubscription,
  createRazorpaySubscription,
  fetchAgencyActiveUserCount,
  fetchBillingSubscription,
  formatBillingPlan,
  formatBillingStatusLabel,
  openRazorpaySubscriptionCheckout,
  type BillingSubscription,
} from '../../lib/billing'
import {
  ALZA_FLOW_INCLUDED_FEATURES,
  BILLING_INTERVALS,
  BILLING_PRODUCTS,
  BILLING_SUPPORT_CONTACT_PATH,
  BILLING_UPGRADE_CONTACT_PATH,
  allowsNewCheckout,
  billingCatalogPrimaryAction,
  billingUserBands,
  equivalentMonthlyFromAnnual,
  formatUsdMoney,
  formatUsdWhole,
  isBillingCheckoutBandKey,
  isBillingProductKey,
  isBillingUserBandKey,
  isLegacyActiveSubscription,
  quoteBillingSelection,
  recommendUserBand,
  shouldShowBillingCatalog,
  type BillingInterval,
  type BillingProductKey,
  type BillingUserBandKey,
} from '../../lib/billingCatalog'
import { legacyPlanDisplayNote } from '../../lib/billingEntitlements'
import { formatDate } from '../../lib/commission'
import { agencyAllowsOpsAccess } from '../../lib/agencyLifecycle'

const fieldLabelClass = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500'
const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60'

/** Temporary Preview QA fingerprint — visible only on the quote-first panel. */
export const BILLING_QUOTE_FIRST_QA_MARKER = 'QUOTE-FIRST BILLING QA · ffefc3c'

export function SubscriptionBillingPage() {
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const canManage = canManageBilling(rolesOf(profile))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [billing, setBilling] = useState<BillingSubscription | null>(null)
  const [userCount, setUserCount] = useState(0)
  const [product, setProduct] = useState<BillingProductKey>('alza_flow')
  const [userBand, setUserBand] = useState<BillingUserBandKey>('users_1_3')
  const [interval, setInterval] = useState<BillingInterval>('monthly')
  const pollRef = useRef<number | null>(null)
  const recommendedInitialized = useRef(false)
  const queryInitialized = useRef(false)

  useEffect(() => {
    if (queryInitialized.current) return
    queryInitialized.current = true
    const p = searchParams.get('product')
    const b = searchParams.get('userBand')
    const i = searchParams.get('interval')
    if (isBillingProductKey(p)) setProduct(p)
    if (isBillingUserBandKey(b)) setUserBand(b)
    if (i === 'monthly' || i === 'annual') setInterval(i)
  }, [searchParams])

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [sub, users] = await Promise.all([fetchBillingSubscription(), fetchAgencyActiveUserCount()])
    if (sub.error) setError(sub.error)
    if (users.error && !sub.error) setError(users.error)
    setBilling(sub.data)
    setUserCount(users.count)
    if (!recommendedInitialized.current) {
      setUserBand(recommendUserBand(users.count))
      recommendedInitialized.current = true
    }
    setLoading(false)
    return sub.data
  }, [canManage])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current)
    }
  }, [])

  function startProcessingPoll() {
    setProcessing(true)
    setInfo('Processing subscription… confirmation usually arrives within a minute.')
    if (pollRef.current != null) window.clearInterval(pollRef.current)
    let ticks = 0
    pollRef.current = window.setInterval(() => {
      ticks += 1
      void (async () => {
        const result = await fetchBillingSubscription()
        if (result.data) setBilling(result.data)
        const status = (result.data?.status ?? '').toLowerCase()
        if (
          status === 'authenticated' ||
          status === 'active' ||
          status === 'pending' ||
          status === 'halted' ||
          status === 'cancelled' ||
          ticks >= 12
        ) {
          if (pollRef.current != null) window.clearInterval(pollRef.current)
          pollRef.current = null
          setProcessing(false)
          if (status === 'authenticated' || status === 'active') {
            setInfo('Subscription confirmed.')
          } else if (ticks >= 12) {
            setInfo('Still confirming. Use Refresh in a moment.')
          }
        }
      })()
    }, 2500)
  }

  const recommendedBand = useMemo(() => recommendUserBand(userCount), [userCount])
  const quote = quoteBillingSelection({ product, userBand, interval })
  const planLabel = formatBillingPlan(billing)
  const legacyNote = legacyPlanDisplayNote(billing?.planKey)
  const status = billing?.status ?? 'incomplete'
  const legacyActive = isLegacyActiveSubscription(billing?.planKey, status)
  const allowCheckout = allowsNewCheckout(status, billing?.planKey) && !processing
  const hasActivePlan = !allowCheckout && Boolean(billing?.planKey || billing?.razorpaySubscriptionId)
  const showCatalog = shouldShowBillingCatalog()
  const showCancel = canCancelSubscription(status)
  const bands = billingUserBands(product)
  const recommendedLabel =
    billingUserBands('alza_flow').find((b) => b.key === recommendedBand)?.label ?? recommendedBand
  const selectedProduct = BILLING_PRODUCTS.find((p) => p.key === product)
  const statusNorm = status.trim().toLowerCase()
  const isEndedSubscription =
    statusNorm === 'cancelled' ||
    statusNorm === 'canceled' ||
    statusNorm === 'completed' ||
    statusNorm === 'halted'
  const planFieldLabel =
    isEndedSubscription && (billing?.planKey || planLabel.title !== 'No active plan')
      ? 'Previous plan'
      : 'Current plan'
  const primaryAction = billingCatalogPrimaryAction({
    status,
    planKey: billing?.planKey,
    product,
    checkoutEligible: quote.checkoutEligible,
    contactAlza: quote.contactAlza,
  })

  async function handleSubscribe() {
    if (!allowCheckout) {
      setError(
        legacyActive
          ? 'Your Legacy Plan is still active. Contact ALZA to upgrade — a second online subscription will not be started.'
          : 'An active subscription already exists. Cancel it before starting a new online checkout.',
      )
      return
    }
    if (product !== 'alza_flow' || !isBillingCheckoutBandKey(userBand) || !quote.checkoutEligible) {
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    const created = await createRazorpaySubscription({
      product: 'alza_flow',
      userBand,
      interval,
    })
    if (created.error || !created.data) {
      setBusy(false)
      setError(created.error ?? 'Online subscription activation is being finalized. Contact ALZA.')
      return
    }

    const checkout = await openRazorpaySubscriptionCheckout({
      keyId: created.data.keyId,
      subscriptionId: created.data.subscriptionId,
      agencyName: created.data.agencyName,
      planName: `${quote.productName} · ${quote.bandLabel} · ${quote.intervalLabel}`,
    })
    setBusy(false)

    if (checkout.error) {
      setError(checkout.error)
      void load()
      return
    }
    if (checkout.dismissed) {
      setInfo('Checkout was closed. No status change until payment confirms.')
      void load()
      return
    }

    startProcessingPoll()
    void load()
  }

  async function handleCancel() {
    const confirmed = window.confirm(
      'Cancel this ALZA FLOW subscription immediately? This cannot be undone from the app. You can subscribe again later.',
    )
    if (!confirmed) return

    setBusy(true)
    setError(null)
    setInfo(null)
    const result = await cancelRazorpaySubscription()
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setInfo('Cancellation requested. Status will refresh shortly.')
    void load()
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Access denied</h1>
        <p className="mt-2 text-sm text-slate-600">
          Only Owners and Admins can manage ALZA FLOW subscription billing.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-billing-layout="quote-first">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Subscription &amp; Billing</h1>
        <p className="mt-1 text-sm text-slate-500">Choose your ALZA Flow plan for this agency.</p>
      </div>

      {info && (
        <div className="rounded-lg border border-alza-blue-100 bg-alza-blue-50 px-3 py-2 text-sm text-alza-blue-900">
          {info}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && !billing ? (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading subscription…
        </p>
      ) : (
        <>
          {processing && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing subscription… confirmation usually arrives within a minute.
            </div>
          )}

          {profile && !agencyAllowsOpsAccess(profile.agencyLifecycle) ? (
            <div className="rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-3 py-2 text-xs text-alza-blue-900">
              <span className="font-semibold">Workspace: {profile.agencyLifecycle}</span>
              {' — '}
              Operational screens stay locked until activation. Complete subscription below when available.
            </div>
          ) : null}

          {showCatalog && (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,16.5rem)_minmax(0,1fr)]">
              <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Configure plan</h3>
                  <p className="mt-1 text-xs text-slate-500">Product, team size, and billing frequency.</p>
                </div>

                <label className="block">
                  <span className={fieldLabelClass}>Product</span>
                  <select
                    className={selectClass}
                    value={product}
                    disabled={busy || processing}
                    aria-label="Product"
                    data-testid="billing-product-select"
                    onChange={(e) => {
                      const next = e.target.value
                      if (isBillingProductKey(next)) setProduct(next)
                    }}
                  >
                    {BILLING_PRODUCTS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                        {p.comingSoon ? ' — Coming Soon' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className={fieldLabelClass}>Team Size</span>
                  <select
                    className={selectClass}
                    value={userBand}
                    disabled={busy || processing}
                    aria-label="Team Size"
                    data-testid="billing-user-band-select"
                    onChange={(e) => {
                      const next = e.target.value
                      if (isBillingUserBandKey(next)) setUserBand(next)
                    }}
                  >
                    {bands.map((band) => (
                      <option key={band.key} value={band.key}>
                        {band.label}
                        {band.key === recommendedBand ? ' (Recommended)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="block">
                  <span className={fieldLabelClass}>Monthly / Annual</span>
                  <div
                    className="inline-flex h-10 w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                    role="group"
                    aria-label="Billing frequency"
                  >
                    {BILLING_INTERVALS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={busy || processing || product === 'alza_flow_pay'}
                        onClick={() => setInterval(opt.key)}
                        className={`flex-1 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          interval === opt.key
                            ? 'bg-white text-alza-blue-800 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  {userCount} active users · recommended{' '}
                  <span className="font-medium text-slate-700">{recommendedLabel}</span>
                </p>
              </aside>

              <section
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md"
                data-testid="billing-price-result"
                data-billing-quote="quote-first"
              >
                <div
                  className="border-b border-amber-300/40 bg-amber-400 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-amber-950"
                  data-billing-qa-marker="quote-first"
                >
                  {BILLING_QUOTE_FIRST_QA_MARKER}
                </div>

                <div className="bg-gradient-to-br from-alza-blue-900 via-alza-blue-800 to-alza-teal-800 px-6 py-5 text-white sm:px-8 sm:py-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                    {quote.productName}
                    {userBand === recommendedBand && product === 'alza_flow' ? (
                      <span className="text-alza-teal-200"> — Recommended</span>
                    ) : null}
                    {selectedProduct?.comingSoon ? (
                      <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide">
                        Coming Soon
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-2 text-base text-white/85">
                    {quote.bandLabel}
                    {quote.intervalLabel ? ` · ${quote.intervalLabel}` : ''}
                  </p>
                  <p className="mt-5 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                    {quote.displayPrice}
                  </p>
                  {product === 'alza_flow' &&
                    interval === 'annual' &&
                    quote.amount != null &&
                    !quote.contactAlza && (
                      <p className="mt-2 text-sm text-white/75">
                        Equivalent to {formatUsdMoney(equivalentMonthlyFromAnnual(quote.amount))}
                        /month
                      </p>
                    )}
                </div>

                <div className="space-y-5 px-6 py-6 sm:px-8 sm:py-7">
                  {product === 'alza_flow' &&
                    interval === 'annual' &&
                    quote.annualSavings != null &&
                    quote.annualListValue != null &&
                    !quote.contactAlza && (
                      <div className="rounded-xl border border-alza-teal-200 bg-gradient-to-r from-alza-teal-50 to-white px-4 py-3.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-alza-teal-900">
                          Annual advantage
                        </p>
                        <p className="mt-1 text-base font-semibold text-alza-teal-950">
                          Save {formatUsdWhole(quote.annualSavings)} · 2 months included
                        </p>
                        <p className="mt-0.5 text-sm text-alza-teal-800/90">
                          {formatUsdWhole(quote.annualListValue)}/year when paid monthly
                        </p>
                      </div>
                    )}

                  {product === 'alza_flow' && !quote.contactAlza && (
                    <ul className="space-y-2.5 text-[15px] text-slate-700">
                      {ALZA_FLOW_INCLUDED_FEATURES.map((line) => (
                        <li key={line} className="flex gap-2.5">
                          <span className="mt-0.5 font-semibold text-alza-teal-700" aria-hidden>
                            ✓
                          </span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {quote.contactAlza && (
                    <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                      {quote.summaryLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}

                  {product === 'alza_flow_pay' && (
                    <p className="text-sm font-medium text-slate-600">
                      ALZA Flow Pay is Coming Soon and not purchasable.
                    </p>
                  )}
                  {legacyActive && (
                    <p className="text-sm font-medium text-amber-900">
                      A legacy plan is still active. Use Upgrade / Contact ALZA — a second online
                      subscription will not be started.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
                    {primaryAction === 'subscribe' && allowCheckout && (
                      <button
                        type="button"
                        disabled={busy || processing}
                        onClick={() => void handleSubscribe()}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl gradient-alza px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 sm:flex-none sm:min-w-[14rem]"
                      >
                        <CreditCard className="h-4 w-4" />
                        {busy
                          ? 'Opening Checkout…'
                          : `Subscribe — ${quote.displayPrice.replace(' / ', '/')}`}
                      </button>
                    )}
                    {primaryAction === 'upgrade_contact' && (
                      <Link
                        to={BILLING_UPGRADE_CONTACT_PATH}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl gradient-alza px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 sm:flex-none"
                      >
                        Upgrade / Contact ALZA
                      </Link>
                    )}
                    {primaryAction === 'contact_alza' && (
                      <Link
                        to={BILLING_SUPPORT_CONTACT_PATH}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-alza-blue-200 bg-alza-blue-50 px-5 py-3 text-sm font-semibold text-alza-blue-900 hover:bg-alza-blue-100 sm:flex-none"
                      >
                        Contact ALZA
                      </Link>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <p>
              <span className="font-medium text-slate-700">{formatBillingStatusLabel(status)}</span>
              {' · '}
              {planFieldLabel}:{' '}
              {!hasActivePlan && !isEndedSubscription ? 'No active plan' : planLabel.title}
              {planLabel.subtitle ? ` (${planLabel.subtitle})` : ''}
              {isEndedSubscription && billing?.canceledAt
                ? ` · Cancelled ${formatDate(billing.canceledAt.slice(0, 10))}`
                : ''}
              {legacyNote ? ` · ${legacyNote}` : ''}
              {' · '}
              {userCount} active users
            </p>
            <div className="flex flex-wrap gap-2">
              {showCancel && (
                <button
                  type="button"
                  disabled={busy || processing}
                  onClick={() => void handleCancel()}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void load()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
