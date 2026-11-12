import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBRL } from '@/lib/money'

interface UnpaidGuidesSummary {
  unpaidCount: number
  unpaidTotal: string
  overdueCount: number
  overdueTotal: string
}

// Dashboard indicator: guides sent to clients and not marked as paid yet (overdue highlighted).
export function UnpaidGuidesCard() {
  const { data } = useQuery<UnpaidGuidesSummary>({
    queryKey: ['unpaid-guides-summary'],
    queryFn: () => api.get('/protocols/unpaid/summary').then((r) => r.data),
  })
  if (!data || data.unpaidCount === 0) return null

  return (
    <Link
      to="/app/guides"
      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 bg-surface rounded-lg border-l-4 border-warning-text p-4 shadow-sm hover:bg-neutral-bg"
    >
      <div className="flex items-center gap-3">
        <Receipt size={20} className="text-warning-text" />
        <div>
          <p className="text-sm text-muted-foreground">Guias não pagas</p>
          <p className="text-lg font-bold text-foreground">
            {data.unpaidCount} · {formatBRL(data.unpaidTotal)}
          </p>
        </div>
      </div>
      {data.overdueCount > 0 && (
        <p className="text-sm font-medium text-danger-text sm:ml-auto">
          {data.overdueCount} vencida{data.overdueCount > 1 ? 's' : ''} · {formatBRL(data.overdueTotal)}
        </p>
      )}
    </Link>
  )
}
