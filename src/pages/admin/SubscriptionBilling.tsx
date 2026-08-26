import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
  BILLING_INTERVALS,
  BILLING_PRODUCTS,
  BILLING_SUPPORT_CONTACT_PATH,
  BILLING_UPGRADE_CONTACT_PATH,
  allowsNewCheckout,
  billingCatalogPrimaryAction,
  billingUserBands,
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
import { formatBuildFingerprint, getBuildInfo } from '../../lib/buildInfo'
import { formatDate } from '../../lib/commission'

const fieldLabelClass = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500'
const selectClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60'

export function SubscriptionBillingPage() {
  const { profile } = useAuth()
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
    setInfo('Processing subscription… Status will update after Razorpay confirms via webhook.')
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
            setInfo('Subscription confirmed. Status below is mirrored from Razorpay.')
          } else if (ticks >= 12) {
            setInfo(
              'Still waiting for webhook confirmation. Use Refresh status in a moment — browser checkout is not authoritative.',
            )
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
  const buildInfo = getBuildInfo()
  const buildFingerprint = formatBuildFingerprint(buildInfo)
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
      setInfo('Checkout was closed. No authoritative status change until Razorpay confirms.')
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
    setInfo('Cancellation requested. Status will refresh from Razorpay / webhook.')
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Subscription &amp; Billing</h1>
        <p className="mt-1 text-sm text-slate-500">
          ALZA Flow commission operations platform subscription for your agency.
        </p>
        <p
          className="mt-2 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900"
          data-billing-ui-version={buildInfo.billingCatalogUiVersion}
          data-build-ref={buildInfo.commitRef}
          data-build-sha={buildInfo.commitSha}
        >
          {buildFingerprint}
          {buildInfo.isVercelPreview ? ' · Preview' : ''}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-alza-blue-900 via-alza-blue-800 to-alza-teal-800 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">SaaS subscription</p>
          <h2 className="mt-1 text-2xl font-bold tracking-wide">ALZA FLOW</h2>
          <p className="mt-1 text-sm text-white/75">by ALZA Business Solutions LLP</p>
        </div>

        <div className="space-y-5 px-6 py-6">
          {info && (
            <div className="rounded-lg border border-alza-blue-100 bg-alza-blue-50 px-3 py-2 text-sm text-alza-blue-900">
              {info}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
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
                  Processing subscription… waiting for Razorpay webhook confirmation.
                </div>
              )}

              {legacyActive ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Legacy Plan
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{planLabel.title}</p>
                  <p className="mt-1 text-sm text-amber-900">
                    Historical compatibility only — new ALZA Flow checkout is not started while this plan
                    remains active. Review pricing below, then contact ALZA to upgrade.
                  </p>
                  {legacyNote && <p className="mt-2 text-xs font-medium text-amber-800">{legacyNote}</p>}
                </div>
              ) : null}

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {formatBillingStatusLabel(status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Current plan</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {!hasActivePlan ? 'No active plan' : planLabel.title}
                    {planLabel.subtitle && (
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {planLabel.subtitle}
                      </span>
                    )}
                    {!legacyActive && legacyNote ? (
                      <span className="mt-1 block text-xs font-medium text-amber-800">{legacyNote}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Agency users
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {userCount} active
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Recommended: {recommendedLabel}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Billing frequency
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {!hasActivePlan ? '—' : planLabel.intervalLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Next charge / period end
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {billing?.currentPeriodEnd
                      ? formatDate(billing.currentPeriodEnd.slice(0, 10))
                      : billing?.chargeAt
                        ? formatDate(billing.chargeAt.slice(0, 10))
                        : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Subscription ID
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                    {billing?.razorpaySubscriptionId ?? '—'}
                  </dd>
                </div>
              </dl>

              {showCatalog && (
                <div className="space-y-4 border-t border-slate-100 pt-5">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">ALZA Flow pricing</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Select product, billing frequency, and user band. Online checkout is only available
                      when no blocking subscription is active.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block sm:col-span-1">
                      <span className={fieldLabelClass}>Product</span>
                      <select
                        className={selectClass}
                        value={product}
                        disabled={busy || processing}
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

                    <div className="block sm:col-span-1">
                      <span className={fieldLabelClass}>Billing</span>
                      <div className="inline-flex h-10 w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5">
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

                    <label className="block sm:col-span-1">
                      <span className={fieldLabelClass}>User band</span>
                      <select
                        className={selectClass}
                        value={userBand}
                        disabled={busy || processing}
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
                  </div>

                  <p className="text-xs text-slate-500">
                    {userCount} active users · recommended band{' '}
                    <span className="font-medium text-slate-700">{recommendedLabel}</span>
                    {userBand !== recommendedBand && (
                      <>
                        {' '}
                        · viewing{' '}
                        <span className="font-medium text-slate-700">{quote.bandLabel}</span>
                      </>
                    )}
                  </p>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {quote.productName}
                          {selectedProduct?.comingSoon ? (
                            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                              Coming Soon
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {quote.bandLabel}
                          {quote.intervalLabel ? ` · ${quote.intervalLabel}` : ''}
                        </p>
                      </div>
                      <p className="text-2xl font-bold tabular-nums text-slate-900">
                        {quote.displayPrice}
                      </p>
                    </div>

                    {product === 'alza_flow' &&
                      interval === 'annual' &&
                      quote.annualSavings != null &&
                      !quote.contactAlza && (
                        <p className="mt-3 text-sm text-alza-teal-800">
                          12-month value {formatUsdWhole(quote.annualListValue ?? 0)} · Save{' '}
                          {formatUsdWhole(quote.annualSavings)} · 2 months free
                        </p>
                      )}

                    <ul className="mt-3 list-inside list-disc text-xs text-slate-600">
                      {quote.summaryLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>

                    {product === 'alza_flow_pay' && (
                      <p className="mt-3 text-xs font-medium text-slate-600">
                        ALZA Flow Pay is Coming Soon and not purchasable.
                      </p>
                    )}
                    {legacyActive && (
                      <p className="mt-3 text-xs font-medium text-amber-900">
                        Legacy subscription is active — online checkout for a second plan is disabled.
                        Use Upgrade / Contact ALZA.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Status is mirrored from Razorpay webhooks. Browser checkout is not authoritative. ALZA Flow
                Pay is Coming Soon and not purchasable. Amounts are never sent from the browser — Razorpay
                Plan IDs stay server-side.
              </p>

              <div className="flex flex-wrap gap-3">
                {primaryAction === 'subscribe' && allowCheckout && (
                  <button
                    type="button"
                    disabled={busy || processing}
                    onClick={() => void handleSubscribe()}
                    className="inline-flex items-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                  >
                    <CreditCard className="h-4 w-4" />
                    {busy ? 'Opening Checkout…' : `Subscribe — ${quote.displayPrice}`}
                  </button>
                )}
                {primaryAction === 'upgrade_contact' && (
                  <Link
                    to={BILLING_UPGRADE_CONTACT_PATH}
                    className="inline-flex items-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
                  >
                    Upgrade / Contact ALZA
                  </Link>
                )}
                {primaryAction === 'contact_alza' && (
                  <Link
                    to={BILLING_SUPPORT_CONTACT_PATH}
                    className="inline-flex items-center gap-2 rounded-lg border border-alza-blue-200 bg-alza-blue-50 px-4 py-2.5 text-sm font-medium text-alza-blue-900 hover:bg-alza-blue-100"
                  >
                    Contact ALZA
                  </Link>
                )}
                {showCancel && (
                  <button
                    type="button"
                    disabled={busy || processing}
                    onClick={() => void handleCancel()}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel subscription
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || loading}
                  onClick={() => void load()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh status
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
