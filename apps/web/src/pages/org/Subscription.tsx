import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

interface Plan { id: string; name: string; maxClients: number; priceMonthly: number }
interface HistoryItem { id: string; event: string; amount: number | null; createdAt: string }
interface SubscriptionData {
  subscriptionStatus: string
  trialEndsAt: string | null
  gracePeriodEndsAt: string | null
  plan: Plan
  clientsCount: number
  subscriptionHistory: HistoryItem[]
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa', SUSPENDED: 'Suspensa', TRIAL: 'Trial',
  GRACE_PERIOD: 'Em carência', CANCELLED: 'Cancelada',
}
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#2a7a2a', SUSPENDED: '#c00', TRIAL: '#0060a0',
  GRACE_PERIOD: '#a06000', CANCELLED: '#666',
}

export default function OrgSubscription() {
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const [showChangePlan, setShowChangePlan] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'ORG_ADMIN') {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  const { data, isLoading } = useQuery<SubscriptionData>({
    queryKey: ['org', 'subscription'],
    queryFn: () => api.get('/org/subscription').then((r) => r.data as SubscriptionData),
    enabled: isAuthenticated && user?.role === 'ORG_ADMIN',
  })

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
    enabled: showChangePlan,
  })

  const changePlanMutation = useMutation({
    mutationFn: (planId: string) => api.post('/org/subscription/change-plan', { planId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'subscription'] })
      setShowChangePlan(false)
    },
  })

  if (!isAuthenticated || user?.role !== 'ORG_ADMIN') return null
  if (isLoading) return <p style={{ padding: 32 }}>Carregando...</p>
  if (!data) return null

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>Assinatura</h1>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 24, marginBottom: 24, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Plano atual</p>
            <h2 style={{ margin: '4px 0' }}>{data.plan.name}</h2>
            <p style={{ margin: 0, color: '#555' }}>
              Até {data.plan.maxClients} clientes · R$ {Number(data.plan.priceMonthly).toFixed(2)}/mês
            </p>
            <p style={{ margin: '6px 0 0', color: '#555', fontSize: 14 }}>
              {data.clientsCount} cliente{data.clientsCount !== 1 ? 's' : ''} ativo{data.clientsCount !== 1 ? 's' : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontWeight: 600, color: STATUS_COLORS[data.subscriptionStatus] ?? '#333' }}>
              {STATUS_LABELS[data.subscriptionStatus] ?? data.subscriptionStatus}
            </span>
            {data.trialEndsAt && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>
                Trial expira em {new Date(data.trialEndsAt).toLocaleDateString('pt-BR')}
              </p>
            )}
            {data.gracePeriodEndsAt && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#a06000' }}>
                Carência até {new Date(data.gracePeriodEndsAt).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowChangePlan(!showChangePlan)}
          style={{ marginTop: 16, padding: '8px 16px' }}
        >
          {showChangePlan ? 'Cancelar' : 'Trocar plano'}
        </button>
      </div>

      {showChangePlan && (
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 24, marginBottom: 24, background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Selecione o novo plano</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {plans.map((plan) => (
              <div
                key={plan.id}
                style={{
                  border: plan.id === data.plan.id ? '2px solid #0070f3' : '1px solid #ddd',
                  borderRadius: 8, padding: 16, minWidth: 160, flex: 1,
                }}
              >
                <strong>{plan.name}</strong>
                <p style={{ margin: '4px 0' }}>R$ {Number(plan.priceMonthly).toFixed(2)}/mês</p>
                <p style={{ margin: '0 0 8px', fontSize: 13, color: '#555' }}>
                  Até {plan.maxClients} clientes
                </p>
                <button
                  onClick={() => changePlanMutation.mutate(plan.id)}
                  disabled={plan.id === data.plan.id || changePlanMutation.isPending}
                  style={{ width: '100%', padding: '6px' }}
                >
                  {plan.id === data.plan.id ? 'Atual' : 'Selecionar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2>Histórico</h2>
        {data.subscriptionHistory.length === 0 ? (
          <p style={{ color: '#666' }}>Nenhum evento registrado.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Evento</th>
                <th style={{ padding: '8px 12px' }}>Valor</th>
                <th style={{ padding: '8px 12px' }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptionHistory.map((h) => (
                <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 12px' }}>{h.event.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {h.amount ? `R$ ${Number(h.amount).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#666', fontSize: 13 }}>
                    {new Date(h.createdAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
