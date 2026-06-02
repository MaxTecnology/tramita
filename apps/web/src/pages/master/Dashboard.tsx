import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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

  if (isLoading) return <p>Carregando...</p>
  if (error) return <p style={{ color: 'red' }}>Erro ao carregar dados.</p>

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <div style={{ display: 'flex', gap: 24 }}>
        <StatCard label="MRR" value={`R$ ${(data?.mrr ?? 0).toFixed(2)}`} />
        <StatCard label="Orgs Ativas" value={String(data?.totalOrgsAtivas ?? 0)} />
        <StatCard label="Churn" value={String(data?.churn ?? 0)} />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '24px 32px',
        background: '#fff',
        minWidth: 160,
      }}
    >
      <p style={{ margin: 0, color: '#666', fontSize: 13 }}>{label}</p>
      <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 700 }}>{value}</p>
    </div>
  )
}
