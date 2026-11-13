import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MyScope } from '@/components/shared/ScopeFilter'

// Role, departments and the "see colleagues" option of the logged office user
export function useMyScope(): (MyScope & { id: string }) | undefined {
  const { data } = useQuery<MyScope & { id: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me').then((r) => r.data),
    staleTime: 60_000,
  })
  return data
}
