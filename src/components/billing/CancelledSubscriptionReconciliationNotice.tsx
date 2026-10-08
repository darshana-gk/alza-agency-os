import { useEffect, useState } from 'react'
import {
  CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE,
  fetchCancelledSubscriptionReconciliation,
} from '@/lib/billing'

const CANCELLED_PAYMENT_NOTICE_POLL_MS = 10_000

/**
 * Watches the caller's unresolved payment conflict, including after a newer checkout
 * replaces the cancelled subscription. A later poll does not add another alert.
 */
export function useCancelledPaymentReconciliationNotice(enabled: boolean): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setVisible(false)
      return
    }

    let stopped = false
    async function watchCancelledPaymentNotice() {
      const notice = await fetchCancelledSubscriptionReconciliation()
      if (stopped || notice.error) return
      if (notice.visible) setVisible(true)
    }

    void watchCancelledPaymentNotice()
    const timer = window.setInterval(() => {
      void watchCancelledPaymentNotice()
    }, CANCELLED_PAYMENT_NOTICE_POLL_MS)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [enabled])

  return visible
}

export function CancelledSubscriptionReconciliationNotice({
  visible,
  className = '',
}: {
  visible: boolean
  className?: string
}) {
  if (!visible) return null
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 ${className}`.trim()}
    >
      {CANCELLED_SUBSCRIPTION_RECONCILIATION_MESSAGE}
    </div>
  )
}
