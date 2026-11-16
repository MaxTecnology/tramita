import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

const EMPTY: ReadonlySet<string> = new Set()

// Holiday days ('YYYY-MM-DD', national + office) for date previews on screen — same calendar as the API
export function useHolidayDays(fromYear: number, toYear: number): ReadonlySet<string> {
  const { data } = useQuery<string[]>({
    queryKey: ['holiday-days', fromYear, toYear],
    queryFn: () => api.get('/holidays/days', { params: { from: fromYear, to: toYear } }).then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  })
  return data ? new Set(data) : EMPTY
}
