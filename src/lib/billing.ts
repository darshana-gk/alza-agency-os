import { supabase } from './supabase'
import { isAdminDirectoryRole, rejectUnlessRole } from './permissions'
import {
  canCancelSubscription,
  formatStoredPlanLabel,
  isLegacyBillingPlanKey,
  shouldShowSubscribe,
  type BillingCheckoutBandKey,
  type BillingInterval,
  type BillingProductKey,
} from './billingCatalog'

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

export interface BillingSubscription {
  id: string
  agencyProfileId: string
  razorpayCustomerId: string | null
  razorpaySubscriptionId: string | null
  razorpayPlanId: string | null
  planKey: string | null
  productKey: string | null
  userBandKey: string | null
  billingInterval: string | null
  includedUsers: number | null
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
    productKey: (row.product_key as string | null) ?? null,
    userBandKey: (row.user_band_key as string | null) ?? null,
    billingInterval: (row.billing_interval as string | null) ?? null,
    includedUsers:
      row.included_users == null || row.included_users === ''
        ? null
        : Number(row.included_users),
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

export function formatBillingPlan(billing: BillingSubscription | null): {
  title: string
  subtitle: string | null
  intervalLabel: string
  legacy: boolean
} {
  if (!billing) {
    return { title: 'No active plan', subtitle: null, intervalLabel: '—', legacy: false }
  }
  return formatStoredPlanLabel({
    planKey: billing.planKey,
    productKey: billing.productKey,
    userBandKey: billing.userBandKey,
    billingInterval: billing.billingInterval,
  })
}

export { shouldShowSubscribe, canCancelSubscription, isLegacyBillingPlanKey }

export async function fetchBillingSubscription(): Promise<{
  data: BillingSubscription | null
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { data: null, error: authz.message }

  const fullSelect = `
      id,
      agency_profile_id,
      razorpay_customer_id,
      razorpay_subscription_id,
      razorpay_plan_id,
      plan_key,
      product_key,
      user_band_key,
      billing_interval,
      included_users,
      status,
      current_period_start,
      current_period_end,
      charge_at,
      cancel_at_period_end,
      canceled_at,
      trial_end,
      updated_at
    `

  let data: Record<string, unknown> | null = null
  let error: { message: string } | null = null

  const full = await supabase.from('billing_subscriptions').select(fullSelect).limit(1).maybeSingle()
  data = (full.data as Record<string, unknown> | null) ?? null
  error = full.error

  // Additive columns may not exist until migration is applied — fall back.
  if (error && /product_key|user_band_key|billing_interval|included_users/i.test(error.message)) {
    const fallback = await supabase
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
    data = fallback.data
      ? {
          ...(fallback.data as Record<string, unknown>),
          product_key: null,
          user_band_key: null,
          billing_interval: null,
          included_users: null,
        }
      : null
    error = fallback.error
  }

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: null }
  return { data: mapBilling(data), error: null }
}

export async function fetchAgencyActiveUserCount(): Promise<{
  count: number
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { count: 0, error: authz.message }

  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null)
    .neq('role', 'alza_support')

  // Prefer same-agency users when membership RPC is available.
  const agencyRpc = await supabase.rpc('current_user_agency_profile_id')
  if (!agencyRpc.error && agencyRpc.data) {
    const scoped = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
      .neq('role', 'alza_support')
      .eq('agency_profile_id', String(agencyRpc.data))
    if (!scoped.error) return { count: scoped.count ?? 0, error: null }
  }

  if (error) return { count: 0, error: error.message }
  return { count: count ?? 0, error: null }
}

export interface RazorpayCheckoutBootstrap {
  subscriptionId: string
  keyId: string
  planKey: string
  agencyName: string
  activationPending?: boolean
  message?: string
}

export async function createRazorpaySubscription(input: {
  product: BillingProductKey
  userBand: BillingCheckoutBandKey
  interval: BillingInterval
}): Promise<{
  data: RazorpayCheckoutBootstrap | null
  error: string | null
}> {
  const authz = await rejectUnlessRole(isAdminDirectoryRole)
  if (!authz.ok) return { data: null, error: authz.message }

  // Browser sends logical selection only — never amounts or Razorpay plan IDs.
  const { data, error } = await supabase.functions.invoke('create-razorpay-subscription', {
    body: {
      product: input.product,
      userBand: input.userBand,
      interval: input.interval,
    },
  })
  if (error) {
    return { data: null, error: error.message || 'Unable to call create-razorpay-subscription.' }
  }

  const payload = data as {
    ok?: boolean
    subscriptionId?: string
    keyId?: string
    planKey?: string
    agencyName?: string
    message?: string
    code?: string
  } | null

  if (!payload?.ok) {
    return {
      data: null,
      error:
        payload?.message ||
        'Online subscription activation is being finalized. Contact ALZA.',
    }
  }

  if (!payload.subscriptionId || !payload.keyId) {
    return {
      data: null,
      error: 'Online subscription activation is being finalized. Contact ALZA.',
    }
  }

  return {
    data: {
      subscriptionId: payload.subscriptionId,
      keyId: payload.keyId,
      planKey: payload.planKey || '',
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
