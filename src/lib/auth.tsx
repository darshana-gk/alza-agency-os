import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  primaryAppRole,
  toAppRoles,
  type AppRole,
} from './permissions'

export interface AppUserProfile {
  id: string
  authUserId: string
  fullName: string
  email: string
  /** Primary/legacy role (highest privilege). */
  role: string
  /** Additive roles from user_roles (+ legacy users.role). */
  roles: AppRole[]
  status: string
  archivedAt: string | null
}

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'access_denied'

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  authUser: User | null
  profile: AppUserProfile | null
  accessDeniedReason: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface UserRow {
  id: string
  auth_user_id: string | null
  full_name: string | null
  email: string | null
  role: string | null
  status: string | null
  archived_at: string | null
}

function mapProfile(row: UserRow, roles: AppRole[]): AppUserProfile {
  const normalizedRoles = roles.length
    ? roles
    : toAppRoles(row.role)
  const primary = primaryAppRole(normalizedRoles) ?? (row.role ?? '').trim().toLowerCase()
  return {
    id: row.id,
    authUserId: row.auth_user_id ?? '',
    fullName: row.full_name?.trim() || 'Unknown user',
    email: row.email?.trim() || '',
    role: primary,
    roles: normalizedRoles,
    status: (row.status ?? '').trim().toLowerCase(),
    archivedAt: row.archived_at,
  }
}

async function loadLinkedProfile(authUserId: string): Promise<{
  profile: AppUserProfile | null
  reason: string | null
}> {
  const { data, error } = await supabase
    .from('users')
    .select('id, auth_user_id, full_name, email, role, status, archived_at, invite_status')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  let row = data as (UserRow & { invite_status?: string | null }) | null
  let loadError = error

  if (error && error.message.includes('invite_status')) {
    const fallback = await supabase
      .from('users')
      .select('id, auth_user_id, full_name, email, role, status, archived_at')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    row = fallback.data as UserRow | null
    loadError = fallback.error
  }

  if (loadError) {
    return {
      profile: null,
      reason: `Unable to load ALZA user profile: ${loadError.message}`,
    }
  }

  if (!row) {
    return {
      profile: null,
      reason:
        'Your Supabase login is not linked to an active ALZA Flow user. Contact an owner or administrator.',
    }
  }

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', row.id)

  const roles = toAppRoles([
    ...(roleRows ?? []).map((r) => String(r.role ?? '')),
    String(row.role ?? ''),
  ])

  const profile = mapProfile(row, roles)

  // Mark invite accepted on successful authenticated session (awaited; SECURITY DEFINER RPC).
  if (row.invite_status === 'pending') {
    const { error: acceptError } = await supabase.rpc('mark_current_user_invite_accepted')
    if (acceptError) {
      // Fallback direct update if RPC not yet deployed.
      await supabase
        .from('users')
        .update({ invite_status: 'accepted' })
        .eq('id', profile.id)
        .eq('invite_status', 'pending')
    }
  }

  if (profile.archivedAt) {
    return {
      profile: null,
      reason: 'This ALZA Flow user account has been archived and cannot access the application.',
    }
  }

  if (profile.status !== 'active') {
    return {
      profile: null,
      reason: `This ALZA Flow user account is ${profile.status || 'inactive'} and cannot access the application.`,
    }
  }

  return { profile, reason: null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AppUserProfile | null>(null)
  const [accessDeniedReason, setAccessDeniedReason] = useState<string | null>(null)

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)
    setAuthUser(nextSession?.user ?? null)

    if (!nextSession?.user) {
      setProfile(null)
      setAccessDeniedReason(null)
      setStatus('unauthenticated')
      return
    }

    const { profile: linkedProfile, reason } = await loadLinkedProfile(nextSession.user.id)

    if (!linkedProfile) {
      setProfile(null)
      setAccessDeniedReason(reason)
      setStatus('access_denied')
      return
    }

    setProfile(linkedProfile)
    setAccessDeniedReason(null)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data, error } = await supabase.auth.getSession()
      if (cancelled) return

      if (error) {
        setSession(null)
        setAuthUser(null)
        setProfile(null)
        setAccessDeniedReason(error.message)
        setStatus('unauthenticated')
        return
      }

      await applySession(data.session)
    }

    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Defer Supabase client calls to avoid auth deadlock in the callback.
      setTimeout(() => {
        void applySession(nextSession)
      }, 0)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [applySession])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setAuthUser(null)
    setProfile(null)
    setAccessDeniedReason(null)
    setStatus('unauthenticated')
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!authUser) return
    await applySession(session)
  }, [applySession, authUser, session])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      authUser,
      profile,
      accessDeniedReason,
      signIn,
      signOut,
      refreshProfile,
    }),
    [status, session, authUser, profile, accessDeniedReason, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export function formatRoleLabel(role: string): string {
  if (!role) return 'User'
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'AF'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}
