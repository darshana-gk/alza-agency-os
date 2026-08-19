import { useCallback, useEffect, useRef, useState } from 'react'
import { CreditCard, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { canManageBilling, rolesOf } from '../../lib/permissions'
import {
  BILLING_PLAN_OPTIONS,
  canCancelSubscription,
  cancelRazorpaySubscription,
  createRazorpaySubscription,
  fetchBillingSubscription,
  formatBillingStatusLabel,
  openRazorpaySubscriptionCheckout,
  planDisplayName,
  shouldShowSubscribe,
  type BillingPlanKey,
  type BillingSubscription,
} from '../../lib/billing'
import { formatDate } from '../../lib/commission'

export function SubscriptionBillingPage() {
  const { profile } = useAuth()
  const canManage = canManageBilling(rolesOf(profile))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [billing, setBilling] = useState<BillingSubscription | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<BillingPlanKey>('professional')
  const pollRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const result = await fetchBillingSubscription()
    if (result.error) setError(result.error)
    setBilling(result.data)
    setLoading(false)
    return result.data
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

  async function handleSubscribe() {
    setBusy(true)
    setError(null)
    setInfo(null)
    const created = await createRazorpaySubscription(selectedPlan)
    if (created.error || !created.data) {
      setBusy(false)
      setError(created.error ?? 'Unable to create Razorpay subscription.')
      return
    }

    const planName =
      BILLING_PLAN_OPTIONS.find((p) => p.key === created.data!.plan)?.name ??
      planDisplayName(created.data.plan)

    const checkout = await openRazorpaySubscriptionCheckout({
      keyId: created.data.keyId,
      subscriptionId: created.data.subscriptionId,
      agencyName: created.data.agencyName,
      planName,
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

  const status = billing?.status ?? 'incomplete'
  const showSubscribe = shouldShowSubscribe(status) && !processing
  const showCancel = canCancelSubscription(status) && !showSubscribe
  const selectedOption =
    BILLING_PLAN_OPTIONS.find((p) => p.key === selectedPlan) ?? BILLING_PLAN_OPTIONS[1]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-alza-blue-900 via-alza-blue-800 to-alza-teal-800 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">SaaS subscription</p>
          <h2 className="mt-1 text-2xl font-bold tracking-wide">ALZA FLOW</h2>
          <p className="mt-1 text-sm text-white/75">by ALZA Business Solutions LLP</p>
          <p className="mt-3 text-xs text-white/60">
            Commission Operations &amp; Reconciliation for Insurance Agencies
          </p>
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

              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {formatBillingStatusLabel(status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Current plan</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {showSubscribe && !processing
                      ? 'No active plan'
                      : planDisplayName(billing?.planKey)}
                    {billing?.planKey && (
                      <span className="mt-0.5 block text-xs font-normal capitalize text-slate-500">
                        {billing.planKey}
                        {billing.razorpayPlanId ? (
                          <span className="ml-1 font-mono text-[11px]">{billing.razorpayPlanId}</span>
                        ) : null}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Billing frequency
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">Monthly</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Current period / next charge
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {billing?.currentPeriodEnd
                      ? formatDate(billing.currentPeriodEnd.slice(0, 10))
                      : billing?.chargeAt
                        ? formatDate(billing.chargeAt.slice(0, 10))
                        : '—'}
                    {billing?.currentPeriodStart && (
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        Period start {formatDate(billing.currentPeriodStart.slice(0, 10))}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Cancelled at
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    {billing?.canceledAt ? formatDate(billing.canceledAt.slice(0, 10)) : '—'}
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
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">Choose a plan</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {BILLING_PLAN_OPTIONS.map((plan) => {
                      const selected = selectedPlan === plan.key
                      return (
                        <button
                          key={plan.key}
                          type="button"
                          disabled={busy || processing}
                          onClick={() => setSelectedPlan(plan.key)}
                          className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                            selected
                              ? 'border-alza-blue-500 bg-alza-blue-50 ring-2 ring-alza-blue-500/20'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-slate-900">{plan.name}</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                            {plan.displayPrice}
                          </p>
                          <p className="mt-2 text-xs text-slate-600">{plan.description}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Status is mirrored from Razorpay webhooks for display only in this phase. ALZA Flow access is
                not locked by subscription status yet. Browser Checkout completion is not authoritative.
                Upgrades/downgrades are not available in V1. This page is SaaS billing — separate from
                insurance Financials.
              </p>

              <div className="flex flex-wrap gap-3">
                {showSubscribe && (
                  <button
                    type="button"
                    disabled={busy || processing}
                    onClick={() => void handleSubscribe()}
                    className="inline-flex items-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                  >
                    <CreditCard className="h-4 w-4" />
                    {busy ? 'Opening Checkout…' : `Subscribe — ${selectedOption.displayPrice}`}
                  </button>
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
