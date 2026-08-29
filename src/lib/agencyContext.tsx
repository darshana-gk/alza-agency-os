import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchAgencyProfile, type AgencyProfile } from './agency'
import { useAuth } from './auth'
import { canAccessSupportCenter, isAlzaSupportRole } from './permissions'

interface AgencyContextValue {
  agency: AgencyProfile | null
  agencyProfileId: string | null
  loading: boolean
  refreshAgency: () => Promise<void>
}

const AgencyContext = createContext<AgencyContextValue | null>(null)

function isPlatformOnlyAlzaSupport(roles: string[]): boolean {
  return isAlzaSupportRole(roles) && !canAccessSupportCenter(roles)
}

export function AgencyProvider({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth()
  const [agency, setAgency] = useState<AgencyProfile | null>(null)
  const [loading, setLoading] = useState(false)

  const platformOnlySupport = profile ? isPlatformOnlyAlzaSupport(profile.roles) : false
  const membershipAgencyId = platformOnlySupport ? null : profile?.agencyProfileId ?? null

  const refreshAgency = useCallback(async () => {
    if (status !== 'authenticated' || platformOnlySupport) {
      setAgency(null)
      return
    }
    setLoading(true)
    const result = await fetchAgencyProfile()
    setAgency(result.data)
    setLoading(false)
  }, [status, platformOnlySupport])

  useEffect(() => {
    void refreshAgency()
  }, [refreshAgency])

  const value = useMemo(
    () => ({
      agency,
      agencyProfileId: agency?.id ?? membershipAgencyId,
      loading,
      refreshAgency,
    }),
    [agency, membershipAgencyId, loading, refreshAgency],
  )

  return <AgencyContext.Provider value={value}>{children}</AgencyContext.Provider>
}

export function useAgency() {
  const ctx = useContext(AgencyContext)
  if (!ctx) {
    return {
      agency: null,
      agencyProfileId: null,
      loading: false,
      refreshAgency: async () => undefined,
    }
  }
  return ctx
}
