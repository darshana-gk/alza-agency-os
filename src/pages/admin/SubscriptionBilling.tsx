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
  shouldShowSubscribe,
  type BillingSubscription,
} from '../../lib/billing'
import {
  BILLING_INTERVALS,
  BILLING_PRODUCTS,
  BILLING_SUPPORT_CONTACT_PATH,
  billingUserBands,
  formatUsdWhole,
  isBillingCheckoutBandKey,
  quoteBillingSelection,
  recommendUserBand,
  type BillingInterval,
  type BillingProductKey,
  type BillingUserBandKey,
} from '../../lib/billingCatalog'
import { legacyPlanDisplayNote } from '../../lib/billingEntitlements'
import { formatDate } from '../../lib/commission'

function choiceClass(selected: boolean, disabled = false) {
  return `rounded-xl border px-4 py-4 text-left transition-colors ${
    disabled ? 'cursor-not-allowed opacity-60' : ''
  } ${
    selected
      ? 'border-alza-blue-500 bg-alza-blue-50 ring-2 ring-alza-blue-500/20'
      : 'border-slate-200 bg-white hover:border-slate-300'
  }`
}

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
  const showSubscribe = shouldShowSubscribe(status) && !processing
  const showCancel = canCancelSubscription(status) && !showSubscribe
  const bands = billingUserBands(product)

  async function handleSubscribe() {
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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Subscription &amp; Billing</h1>
        <p className="mt-1 text-sm text-slate-500">
          ALZA Flow commission operations platform subscription for your agency.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-alza-blue-900 via-alza-blue-800 to-alza-teal-800 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">SaaS subscription</p>
          <h2 className="mt-1 text-2xl font-bold tracking-wide">ALZA FLOW</h2>
          <p className="mt-1 text-sm text-white/75">by ALZA Business Solutions LLP</p>
        </div>

        <div className="space-y-6 px-6 py-6">
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

              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {formatBillingStatusLabel(status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Current plan</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {showSubscribe && !processing ? 'No active plan' : planLabel.title}
                    {planLabel.subtitle && (
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {planLabel.subtitle}
                      </span>
                    )}
                    {legacyNote && (
                      <span className="mt-1 block text-xs font-medium text-amber-800">{legacyNote}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Agency users
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {userCount} active
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Recommended tier: {billingUserBands('alza_flow').find((b) => b.key === recommendedBand)?.label}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Billing frequency
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {showSubscribe ? '—' : planLabel.intervalLabel}
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

              {showSubscribe && (
                <div className="space-y-5 border-t border-slate-100 pt-5">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Choose product</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {BILLING_PRODUCTS.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          disabled={busy || processing}
                          onClick={() => setProduct(p.key)}
                          className={choiceClass(product === p.key)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                            {p.comingSoon && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-500/20">
                                Coming Soon
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{p.startsAtLabel}</p>
                          {!p.purchasable && (
                            <p className="mt-2 text-xs font-medium text-slate-500">Not purchasable yet</p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {product === 'alza_flow' && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Billing frequency</h3>
                      <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                        {BILLING_INTERVALS.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setInterval(opt.key)}
                            className={`rounded-lg px-4 py-2 text-sm font-medium ${
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
                  )}

                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">User band</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {bands.map((band) => {
                        const selected = userBand === band.key
                        const bandQuote = quoteBillingSelection({
                          product,
                          userBand: band.key,
                          interval: product === 'alza_flow_pay' ? interval : interval,
                        })
                        return (
                          <button
                            key={band.key}
                            type="button"
                            disabled={busy || processing}
                            onClick={() => setUserBand(band.key)}
                            className={choiceClass(selected)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">{band.label}</p>
                              {band.key === recommendedBand && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-600/20">
                                  Recommended
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                              {bandQuote.displayPrice}
                            </p>
                            {product === 'alza_flow' &&
                              interval === 'annual' &&
                              bandQuote.annualSavings != null &&
                              !band.contactAlza && (
                                <p className="mt-1 text-xs text-alza-teal-800">
                                  12-month value {formatUsdWhole(bandQuote.annualListValue ?? 0)} · Save{' '}
                                  {formatUsdWhole(bandQuote.annualSavings)} · 2 months free
                                </p>
                              )}
                            {band.contactAlza && (
                              <p className="mt-2 text-xs font-medium text-slate-600">Contact ALZA</p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">
                      {quote.productName} · {quote.bandLabel}
                      {quote.intervalLabel ? ` · ${quote.intervalLabel}` : ''}
                    </p>
                    <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                      {quote.summaryLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Status is mirrored from Razorpay webhooks. Browser checkout is not authoritative. ALZA Flow
                Pay is Coming Soon and not purchasable. Amounts are never sent from the browser — Razorpay
                Plan IDs stay server-side.
              </p>

              <div className="flex flex-wrap gap-3">
                {showSubscribe && product === 'alza_flow' && quote.checkoutEligible && (
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
                {showSubscribe && (quote.contactAlza || product === 'alza_flow_pay') && (
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
