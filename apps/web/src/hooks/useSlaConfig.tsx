import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface SlaConfigValue {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

const DEFAULT_SLA_CONFIG: SlaConfigValue = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

const SlaConfigContext = createContext<SlaConfigValue>(DEFAULT_SLA_CONFIG)

export function SlaConfigProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<SlaConfigValue>({
    queryKey: ['sla-config'],
    queryFn: () => api.get('/sla/config').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <SlaConfigContext.Provider value={data ?? DEFAULT_SLA_CONFIG}>
      {children}
    </SlaConfigContext.Provider>
  )
}

export function useSlaConfig(): SlaConfigValue {
  return useContext(SlaConfigContext)
}
