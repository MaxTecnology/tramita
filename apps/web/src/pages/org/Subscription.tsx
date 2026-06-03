import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa', SUSPENDED: 'Suspensa', TRIAL: 'Trial',
  GRACE_PERIOD: 'Em carência', CANCELLED: 'Cancelada',
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 hover:bg-green-100',
  SUSPENDED: 'bg-red-100 text-red-700 hover:bg-red-100',
  TRIAL: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  GRACE_PERIOD: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  CANCELLED: 'bg-gray-100 text-gray-500 hover:bg-gray-100',
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
  if (isLoading) return <div className="p-6 text-gray-500">Carregando...</div>
  if (!data) return null

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Assinatura</h1>

      {/* Current plan */}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Plano atual</p>
              <h2 className="text-xl font-bold text-gray-900">{data.plan.name}</h2>
              <p className="text-sm text-gray-500 mt-1">
                Até {data.plan.maxClients} clientes · R$ {Number(data.plan.priceMonthly).toFixed(2)}/mês
              </p>
              <p className="text-sm text-gray-500">
                {data.clientsCount} cliente{data.clientsCount !== 1 ? 's' : ''} ativo{data.clientsCount !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="text-right space-y-1">
              <Badge className={STATUS_CLASS[data.subscriptionStatus] ?? 'bg-gray-100 text-gray-500'}>
                {STATUS_LABEL[data.subscriptionStatus] ?? data.subscriptionStatus}
              </Badge>
              {data.trialEndsAt && (
                <p className="text-xs text-gray-500">
                  Trial expira em {new Date(data.trialEndsAt).toLocaleDateString('pt-BR')}
                </p>
              )}
              {data.gracePeriodEndsAt && (
                <p className="text-xs text-amber-600">
                  Carência até {new Date(data.gracePeriodEndsAt).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setShowChangePlan(!showChangePlan)}
          >
            {showChangePlan ? 'Cancelar' : 'Trocar plano'}
          </Button>
        </CardContent>
      </Card>

      {/* Change plan */}
      {showChangePlan && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Selecione o novo plano</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-lg border-2 p-4 ${
                    plan.id === data.plan.id
                      ? 'border-[#185FA5] bg-blue-50'
                      : 'border-gray-200'
                  }`}
                >
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    R$ {Number(plan.priceMonthly).toFixed(2)}/mês
                  </p>
                  <p className="text-xs text-gray-400 mb-3">Até {plan.maxClients} clientes</p>
                  <Button
                    size="sm"
                    className="w-full bg-[#185FA5] hover:bg-[#0C447C] text-white"
                    onClick={() => changePlanMutation.mutate(plan.id)}
                    disabled={plan.id === data.plan.id || changePlanMutation.isPending}
                  >
                    {plan.id === data.plan.id ? 'Plano atual' : 'Selecionar'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.subscriptionHistory.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-500">Nenhum evento registrado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Evento', 'Valor', 'Data'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.subscriptionHistory.map((h) => (
                  <tr key={h.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 text-gray-700">{h.event.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {h.amount ? `R$ ${Number(h.amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(h.createdAt).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
