import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { isUf } from '@/lib/uf'

export interface MunicipalityOption { ibgeCode: number; name: string }

// Cities of a state (IBGE). The list never changes in a session: cached for good.
export function useMunicipalities(uf: string | null | undefined) {
  return useQuery<MunicipalityOption[]>({
    queryKey: ['municipalities', uf],
    queryFn: () => api.get('/municipalities', { params: { uf } }).then((r) => r.data),
    enabled: isUf(uf),
    staleTime: Infinity,
  })
}
