import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './auth'
import { useAgency } from './agencyContext'
import { supabase } from './supabase'
import { isPurePlatformSupport, rolesOf } from './permissions'
import {
  applyWorkspaceSubscriptionAccess,
  type RestrictedReason,
  type SubscriptionAccessRefreshResult,
  type SubscriptionGateState,
} from './subscriptionAccess'

type SubscriptionAccessValue = {
  applies: boolean
  state: SubscriptionGateState
  reason: RestrictedReason
  checking: boolean
  refresh: () => Promise<SubscriptionAccessRefreshResult>
  agencyName: string | null
}

const SubscriptionAccessContext = createContext<SubscriptionAccessValue | null>(null)

const BYPASS: SubscriptionAccessValue = {
  applies: false,
  state: 'ACTIVE',
  reason: 'none',
  checking: false,
  refresh: async () => ({ state: 'ACTIVE', reason: 'none' }),
  agencyName: null,
}

export function SubscriptionAccessProvider({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth()
  const { agency, agencyProfileId } = useAgency()
  const [state, setState] = useState<SubscriptionGateState>('LOADING')
  const [reason, setReason] = useState<RestrictedReason>('none')
  const [checking, setChecking] = useState(false)

  const platformSupport = profile ? isPurePlatformSupport(rolesOf(profile)) : false
  const applies =
    status === 'authenticated' &&
    Boolean(profile) &&
    !platformSupport &&
    Boolean(profile?.agencyProfileId || agencyProfileId)

  const refresh = useCallback(async (): Promise<SubscriptionAccessRefreshResult> => {
    if (!applies) {
      return { state: 'ACTIVE', reason: 'none' }
    }
    setChecking(true)
    const { data, error } = await supabase.rpc('get_my_workspace_subscription_access')
    const failed = Boolean(error || !data || typeof data !== 'object')
    const applied = applyWorkspaceSubscriptionAccess(
      failed ? null : (data as { access_state?: string; reason?: string; period_end_date?: string | null }),
      failed,
    )
    setChecking(false)
    setState(applied.state)
    setReason(applied.reason)
    return applied
  }, [applies])

  useEffect(() => {
    if (status === 'loading') {
      setState('LOADING')
      return
    }
    if (!applies) {
      setState('ACTIVE')
      setReason('none')
      return
    }
    setState('LOADING')
    void refresh()
  }, [status, applies, refresh])

  useEffect(() => {
    if (!applies) return
    function onFocus() {
      void refresh()
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [applies, refresh])

  const value = useMemo(
    () => ({
      applies,
      state: applies ? state : 'ACTIVE',
      reason: applies ? reason : 'none',
      checking,
      refresh,
      agencyName: agency?.agencyName ?? null,
    }),
    [applies, state, reason, checking, refresh, agency?.agencyName],
  )

  return (
    <SubscriptionAccessContext.Provider value={value}>{children}</SubscriptionAccessContext.Provider>
  )
}

export function useSubscriptionAccess(): SubscriptionAccessValue {
  const ctx = useContext(SubscriptionAccessContext)
  if (!ctx) return BYPASS
  return ctx
}
