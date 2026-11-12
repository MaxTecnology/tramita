import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AlertTriangle, Clock, CheckCircle2, Check } from 'lucide-react'

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
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  TRIAL: 'Trial',
  GRACE_PERIOD: 'Em carência',
  CANCELLED: 'Cancelada',
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-success-bg text-success-text',
  SUSPENDED: 'bg-danger-bg text-danger-text',
  TRIAL: 'bg-info-bg text-info-text',
  GRACE_PERIOD: 'bg-warning-bg text-warning-text',
  CANCELLED: 'bg-neutral-bg text-muted-foreground',
}

const EVENT_LABEL: Record<string, string> = {
  SUBSCRIPTION_CREATED: 'Assinatura criada',
  SUBSCRIPTION_ACTIVATED: 'Assinatura ativada',
  SUBSCRIPTION_SUSPENDED: 'Assinatura suspensa',
  SUBSCRIPTION_CANCELLED: 'Assinatura cancelada',
  PLAN_CHANGED: 'Plano alterado',
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  PAYMENT_FAILED: 'Pagamento falhou',
  TRIAL_STARTED: 'Trial iniciado',
  TRIAL_EXPIRED: 'Trial expirado',
  GRACE_PERIOD_STARTED: 'Carência iniciada',
  GRACE_PERIOD_EXPIRED: 'Carência expirada',
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
      toast.success('Plano alterado com sucesso')
      qc.invalidateQueries({ queryKey: ['org', 'subscription'] })
      setShowChangePlan(false)
    },
    onError: () => toast.error('Erro ao alterar plano'),
  })

  if (!isAuthenticated || user?.role !== 'ORG_ADMIN') return null
  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando...</div>
  if (!data) return null

  const usagePercent = Math.min(Math.round((data.clientsCount / data.plan.maxClients) * 100), 100)
  const usageBarCls = usagePercent >= 90 ? 'bg-danger-text' : usagePercent >= 70 ? 'bg-warning-text' : 'bg-accent'

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Assinatura</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie seu plano e acompanhe o histórico de cobrança.</p>
      </div>

      {/* Plano atual */}
      <div className="bg-surface rounded-xl border border-border shadow-sm p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Plano atual</p>
            <h2 className="text-2xl font-bold text-foreground">{data.plan.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="text-lg font-semibold text-foreground">
                R$ {Number(data.plan.priceMonthly).toFixed(2)}
              </span>
              <span className="text-muted-foreground">/mês</span>
            </p>
          </div>
          <div className="text-right space-y-2">
            <span className={cn('inline-block text-xs font-semibold px-2.5 py-1 rounded-full', STATUS_BADGE[data.subscriptionStatus] ?? 'bg-neutral-bg text-muted-foreground')}>
              {STATUS_LABEL[data.subscriptionStatus] ?? data.subscriptionStatus}
            </span>
            {data.trialEndsAt && (
              <p className="text-xs text-info-text flex items-center justify-end gap-1">
                <Clock size={11} />
                Trial até {new Date(data.trialEndsAt).toLocaleDateString('pt-BR')}
              </p>
            )}
            {data.gracePeriodEndsAt && (
              <p className="text-xs text-warning-text flex items-center justify-end gap-1">
                <AlertTriangle size={11} />
                Carência até {new Date(data.gracePeriodEndsAt).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        </div>

        {/* Uso de clientes */}
        <div className="space-y-1.5 mb-5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Clientes ativos</span>
            <span className={cn('font-medium', usagePercent >= 90 ? 'text-danger-text' : usagePercent >= 70 ? 'text-warning-text' : 'text-foreground')}>
              {data.clientsCount} de {data.plan.maxClients}
            </span>
          </div>
          <div className="h-2 bg-neutral-bg rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', usageBarCls)}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          {usagePercent >= 90 && (
            <p className="text-xs text-danger-text flex items-center gap-1">
              <AlertTriangle size={10} /> Limite de clientes quase atingido
            </p>
          )}
        </div>

        <Button
          variant="outline"
          onClick={() => setShowChangePlan(!showChangePlan)}
          className="border-[#185FA5] text-[#185FA5] hover:bg-info-bg"
        >
          {showChangePlan ? 'Cancelar' : 'Trocar plano'}
        </Button>
      </div>

      {/* Seleção de plano */}
      {showChangePlan && (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-5 mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Selecione o novo plano</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {plans.map((plan) => {
              const isCurrent = plan.id === data.plan.id
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'rounded-xl border-2 p-4 flex flex-col transition-colors',
                    isCurrent ? 'border-[#185FA5] bg-info-bg/60' : 'border-border hover:border-muted-foreground',
                  )}
                >
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-foreground">{plan.name}</p>
                    {isCurrent && <Check size={16} className="text-[#185FA5] flex-shrink-0" />}
                  </div>
                  <p className="text-lg font-bold text-foreground mb-0.5">
                    R$ {Number(plan.priceMonthly).toFixed(2)}
                    <span className="text-xs font-normal text-muted-foreground">/mês</span>
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">Até {plan.maxClients} clientes</p>
                  <Button
                    size="sm"
                    className={cn(
                      'w-full mt-auto',
                      isCurrent
                        ? 'bg-neutral-bg text-muted-foreground cursor-default hover:bg-neutral-bg'
                        : 'bg-[#185FA5] hover:bg-[#0C447C] text-white',
                    )}
                    onClick={() => !isCurrent && changePlanMutation.mutate(plan.id)}
                    disabled={isCurrent || changePlanMutation.isPending}
                  >
                    {isCurrent ? 'Plano atual' : changePlanMutation.isPending ? 'Alterando...' : 'Selecionar'}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Histórico */}
      <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-background/60">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Histórico</p>
        </div>

        {data.subscriptionHistory.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 size={32} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:flex items-center gap-3 px-5 py-2 bg-background/80 border-b border-border">
              <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evento</div>
              <div className="w-28 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Valor</div>
              <div className="w-36 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Data</div>
            </div>
            {data.subscriptionHistory.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-foreground truncate">
                    {EVENT_LABEL[h.event] ?? h.event.replace(/_/g, ' ')}
                  </p>
                </div>
                <div className="w-28 text-right">
                  {h.amount
                    ? <span className="font-medium text-foreground">R$ {Number(h.amount).toFixed(2)}</span>
                    : <span className="text-muted-foreground">—</span>
                  }
                </div>
                <div className="w-36 text-right">
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
