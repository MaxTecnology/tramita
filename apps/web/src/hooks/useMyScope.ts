import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MyScope } from '@/components/shared/ScopeFilter'

// Role, departments and the "see colleagues" option of the logged office user. A client (portal)
// has no office profile: screens shared with the portal pass enabled = false for them
export function useMyScope(enabled = true): (MyScope & { id: string }) | undefined {
  const { data } = useQuery<MyScope & { id: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/users/me').then((r) => r.data),
    staleTime: 60_000,
    enabled,
  })
  return data
}
