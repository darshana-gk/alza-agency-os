import { supabase } from './supabase'
import { isAdminDirectoryRole, rejectUnlessRole } from './permissions'

export type BillingSubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'paused'
  | 'incomplete'

/** Internal plan keys only — never send Razorpay Plan IDs from the browser. */
export type BillingPlanKey = 'essential' | 'professional'

export interface BillingPlanOption {
  key: BillingPlanKey
  name: string
  displayPrice: string
  description: string
}

/** Display catalog for the Subscription page (marketing amounts). Plan IDs stay server-side. */
export const BILLING_PLAN_OPTIONS: BillingPlanOption[] = [
  {
    key: 'essential',
    name: 'ALZA FLOW Essential',
    displayPrice: '$299/month',
    description: 'Core commission operations for growing agencies.',
  },
  {
    key: 'professional',
    name: 'ALZA FLOW Professional',
    displayPrice: '$499/month',
    description: 'Full commission operations & reconciliation for established agencies.',
  },
]

export interface BillingSubscription {
  id: string
  agencyProfileId: string
  razorpayCustomerId: string | null
  razorpaySubscriptionId: string | null
  razorpayPlanId: string | null
  planKey: BillingPlanKey | string | null
  status: BillingSubscriptionStatus | string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  chargeAt: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  trialEnd: string | null
  updatedAt: string | null
}

function mapBilling(row: Record<string, unknown>): BillingSubscription {
  return {
    id: String(row.id ?? ''),
    agencyProfileId: String(row.agency_profile_id ?? ''),
    razorpayCustomerId: (row.razorpay_customer_id as string | null) ?? null,
    razorpaySubscriptionId: (row.razorpay_subscription_id as string | null) ?? null,
    razorpayPlanId: (row.razorpay_plan_id as string | null) ?? null,
    planKey: (row.plan_key as string | null) ?? null,
    status: String(row.status ?? 'incomplete'),
    currentPeriodStart: (row.current_period_start as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    chargeAt: (row.charge_at as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: (row.canceled_at as string | null) ?? null,
    trialEnd: (row.trial_end as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  }
}

export function formatBillingStatusLabel(status: string | null | undefined): string {
  const v = (status ?? '').trim().toLowerCase()
  if (!v) return 'Unknown'
  return v
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function isBillingPlanKey(value: string | null | undefined): value is BillingPlanKey {
  return value === 'essential' || value === 'professional'
}

export function planDisplayName(planKey: string | null | undefined): string {
  if (planKey === 'essential') return 'ALZA FLOW Essential'
  if (planKey === 'professional') return 'ALZA FLOW Professional'
  return 'ALZA FLOW'
}

export async function fetchBillingSubscription(): Promise<{
  data: BillingSubscription | null
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { data: null, error: authz.message }

  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select(
      `
      id,
      agency_profile_id,
      razorpay_customer_id,
      razorpay_subscription_id,
      razorpay_plan_id,
      plan_key,
      status,
      current_period_start,
      current_period_end,
      charge_at,
      cancel_at_period_end,
      canceled_at,
      trial_end,
      updated_at
    `,
    )
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: null }
  return { data: mapBilling(data as Record<string, unknown>), error: null }
}

export interface RazorpayCheckoutBootstrap {
  subscriptionId: string
  keyId: string
  plan: BillingPlanKey
  agencyName: string
}

export async function createRazorpaySubscription(plan: BillingPlanKey): Promise<{
  data: RazorpayCheckoutBootstrap | null
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { data: null, error: authz.message }
  if (!isBillingPlanKey(plan)) return { data: null, error: 'Invalid plan selection.' }

  const { data, error } = await supabase.functions.invoke('create-razorpay-subscription', {
    body: { plan },
  })
  if (error) {
    return { data: null, error: error.message || 'Unable to call create-razorpay-subscription.' }
  }

  const payload = data as {
    ok?: boolean
    subscriptionId?: string
    keyId?: string
    plan?: string
    agencyName?: string
    message?: string
  } | null

  if (!payload?.ok || !payload.subscriptionId || !payload.keyId) {
    return {
      data: null,
      error: payload?.message || 'create-razorpay-subscription did not return checkout data.',
    }
  }

  return {
    data: {
      subscriptionId: payload.subscriptionId,
      keyId: payload.keyId,
      plan: isBillingPlanKey(payload.plan) ? payload.plan : plan,
      agencyName: payload.agencyName || 'ALZA Flow Workspace',
    },
    error: null,
  }
}

export async function cancelRazorpaySubscription(): Promise<{ error: string | null }> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { error: authz.message }

  const { data, error } = await supabase.functions.invoke('cancel-razorpay-subscription', {
    body: {},
  })
  if (error) {
    return { error: error.message || 'Unable to call cancel-razorpay-subscription.' }
  }
  const payload = data as { ok?: boolean; message?: string } | null
  if (!payload?.ok) {
    return { error: payload?.message || 'Cancellation failed.' }
  }
  return { error: null }
}

/** Show plan selection when there is no usable active/pending subscription. */
export function shouldShowSubscribe(status: string | null | undefined): boolean {
  const v = (status ?? '').trim().toLowerCase()
  // `created` means a Razorpay subscription already exists (awaiting Checkout / webhook).
  return (
    !v ||
    v === 'incomplete' ||
    v === 'cancelled' ||
    v === 'canceled' ||
    v === 'completed' ||
    v === 'halted'
  )
}

export function canCancelSubscription(status: string | null | undefined): boolean {
  const v = (status ?? '').trim().toLowerCase()
  return v === 'authenticated' || v === 'active' || v === 'pending' || v === 'paused' || v === 'created'
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

export async function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return
  if (window.Razorpay) return
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-alza-razorpay]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay Checkout.')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.alzaRazorpay = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Razorpay Checkout.'))
    document.body.appendChild(script)
  })
}

export async function openRazorpaySubscriptionCheckout(input: {
  keyId: string
  subscriptionId: string
  agencyName: string
  planName: string
  onDismiss?: () => void
}): Promise<{ dismissed: boolean; error: string | null }> {
  try {
    await loadRazorpayCheckoutScript()
  } catch (err) {
    return {
      dismissed: false,
      error: err instanceof Error ? err.message : 'Unable to load Razorpay Checkout.',
    }
  }

  if (!window.Razorpay) {
    return { dismissed: false, error: 'Razorpay Checkout is unavailable in this browser.' }
  }

  return await new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: input.keyId,
      subscription_id: input.subscriptionId,
      name: 'ALZA FLOW',
      description: input.planName,
      notes: {
        alza_product: 'alza_flow',
      },
      theme: { color: '#0B5FFF' },
      handler: () => {
        // Browser callback is not authoritative — webhook mirrors status.
        resolve({ dismissed: false, error: null })
      },
      modal: {
        ondismiss: () => {
          input.onDismiss?.()
          resolve({ dismissed: true, error: null })
        },
      },
    })
    rzp.open()
  })
}
