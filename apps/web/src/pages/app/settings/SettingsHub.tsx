import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Settings, Bell, CreditCard, Building2, UserCog, Repeat, FileStack, Zap } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import type { FailedGeneration } from '@/types'

const ADMIN_ROLES = ['ORG_ADMIN']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

interface SettingsCard {
  to: string
  icon: React.ReactNode
  title: string
  description: string
  roles: string[]
  badge?: number
}

export default function SettingsHub() {
  const { user } = useAuth()
  const role = user?.role ?? ''

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: ADMIN_ROLES.includes(role),
  })

  const cards: SettingsCard[] = [
    { to: '/app/settings/templates', icon: <Settings size={20} />, title: 'Templates', description: 'Mensagens de notificação por evento', roles: ADMIN_ROLES },
    { to: '/app/settings/notifications', icon: <Bell size={20} />, title: 'Notificações', description: 'WhatsApp e e-mail por organização', roles: ADMIN_ROLES },
    { to: '/app/settings/subscription', icon: <CreditCard size={20} />, title: 'Assinatura', description: 'Plano e cobrança', roles: ADMIN_ROLES },
    { to: '/app/settings/departments', icon: <Building2 size={20} />, title: 'Departamentos', description: 'Áreas internas do escritório', roles: ADMIN_ROLES },
    { to: '/app/settings/client-users', icon: <UserCog size={20} />, title: 'Usuários de Cliente', description: 'Acessos do portal do cliente', roles: MANAGER_ROLES },
    { to: '/app/settings/recurring-templates', icon: <Repeat size={20} />, title: 'Tarefas Recorrentes', description: 'Templates de geração automática', roles: ADMIN_ROLES },
    { to: '/app/settings/os-templates', icon: <FileStack size={20} />, title: 'Templates de OS', description: 'Modelos de ordem de serviço', roles: ADMIN_ROLES },
    { to: '/app/settings/recurring-generation', icon: <Zap size={20} />, title: 'Geração manual', description: 'Rodar geração de tarefas recorrentes fora do ciclo automático', roles: ADMIN_ROLES, badge: failures.length },
  ]

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-lg md:text-xl font-bold text-foreground mb-4">Configurações</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.filter((c) => c.roles.includes(role)).map((c) => (
          <Link key={c.to} to={c.to}>
            <Card className="p-4 h-full hover:border-accent transition-colors">
              <div className="flex items-start justify-between">
                <div className="text-accent mb-2">{c.icon}</div>
                {!!c.badge && c.badge > 0 && (
                  <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-danger-text text-danger-foreground text-xs font-medium flex items-center justify-center">
                    {c.badge > 9 ? '9+' : c.badge}
                  </span>
                )}
              </div>
              <h2 className="text-sm font-medium text-foreground">{c.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
