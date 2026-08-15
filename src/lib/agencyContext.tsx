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

interface AgencyContextValue {
  agency: AgencyProfile | null
  loading: boolean
  refreshAgency: () => Promise<void>
}

const AgencyContext = createContext<AgencyContextValue | null>(null)

export function AgencyProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const [agency, setAgency] = useState<AgencyProfile | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshAgency = useCallback(async () => {
    if (status !== 'authenticated') {
      setAgency(null)
      return
    }
    setLoading(true)
    const result = await fetchAgencyProfile()
    setAgency(result.data)
    setLoading(false)
  }, [status])

  useEffect(() => {
    void refreshAgency()
  }, [refreshAgency])

  const value = useMemo(
    () => ({ agency, loading, refreshAgency }),
    [agency, loading, refreshAgency],
  )

  return <AgencyContext.Provider value={value}>{children}</AgencyContext.Provider>
}

export function useAgency() {
  const ctx = useContext(AgencyContext)
  if (!ctx) {
    return { agency: null, loading: false, refreshAgency: async () => undefined }
  }
  return ctx
}
