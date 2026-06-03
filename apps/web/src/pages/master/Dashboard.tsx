import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, Building2, TrendingDown } from 'lucide-react'

interface Revenue {
  mrr: number
  totalOrgsAtivas: number
  churn: number
}

export default function MasterDashboard() {
  const { data, isLoading, error } = useQuery<Revenue>({
    queryKey: ['master', 'revenue'],
    queryFn: () => api.get('/master/revenue').then((r) => r.data as Revenue),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>
  if (error) return <div className="p-8 text-red-500">Erro ao carregar dados.</div>

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="MRR"
          value={`R$ ${(data?.mrr ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={<TrendingUp size={20} />}
          iconColor="#185FA5"
        />
        <StatCard
          label="Orgs Ativas"
          value={String(data?.totalOrgsAtivas ?? 0)}
          icon={<Building2 size={20} />}
          iconColor="#378ADD"
        />
        <StatCard
          label="Churn"
          value={String(data?.churn ?? 0)}
          icon={<TrendingDown size={20} />}
          iconColor="#dc2626"
        />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  iconColor,
}: {
  label: string
  value: string
  icon: React.ReactNode
  iconColor: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500">{label}</p>
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      </CardContent>
    </Card>
  )
}
