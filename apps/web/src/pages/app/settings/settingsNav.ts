import type { LucideIcon } from 'lucide-react'
import { AlarmClock, Bell, Building2, CalendarOff, CreditCard, FileStack, FileText, ListChecks, MessageSquareText, Repeat, UserCog, Zap } from 'lucide-react'

// Every settings page in one place: the side menu (desktop) and the cards hub (phones) read it,
// so names, order and who sees each page never drift apart.
export const ADMIN_ONLY = ['ORG_ADMIN']
export const ADMIN_AND_MANAGER = ['ORG_ADMIN', 'ORG_MANAGER']

export interface SettingsPage {
  to: string
  title: string
  description: string
  icon: LucideIcon
  roles: string[]
  // Shows the count of recurring generations that failed
  failuresBadge?: boolean
}

export interface SettingsGroup {
  title: string
  pages: SettingsPage[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'Escritório',
    pages: [
      { to: '/app/settings/departments', title: 'Departamentos', description: 'Áreas que atendem os clientes', icon: Building2, roles: ADMIN_ONLY },
      { to: '/app/settings/holidays', title: 'Feriados', description: 'Dias que não contam nos prazos em dias úteis', icon: CalendarOff, roles: ADMIN_ONLY },
      { to: '/app/settings/subscription', title: 'Assinatura', description: 'Plano, uso e cobrança', icon: CreditCard, roles: ADMIN_ONLY },
    ],
  },
  {
    title: 'Portal do cliente',
    pages: [
      { to: '/app/settings/client-users', title: 'Acessos ao portal', description: 'Quem de cada cliente acompanha os processos', icon: UserCog, roles: ADMIN_AND_MANAGER },
    ],
  },
  {
    title: 'Trabalho',
    pages: [
      { to: '/app/settings/recurring-templates', title: 'Tarefas recorrentes', description: 'Obrigações geradas todo mês, trimestre ou ano', icon: Repeat, roles: ADMIN_ONLY },
      { to: '/app/settings/os-models', title: 'Modelos de OS', description: 'Serviços avulsos: documentos, prazo e robô', icon: ListChecks, roles: ADMIN_ONLY },
      { to: '/app/settings/process-templates', title: 'Modelos de processo', description: 'Etapas e OS de cada tipo de processo', icon: FileStack, roles: ADMIN_ONLY },
      { to: '/app/settings/delay-reasons', title: 'Motivos de atraso', description: 'Pedidos ao concluir fora do prazo interno', icon: AlarmClock, roles: ADMIN_ONLY },
      { to: '/app/settings/recurring-generation', title: 'Geração manual', description: 'Gerar um mês fora do horário automático', icon: Zap, roles: ADMIN_ONLY, failuresBadge: true },
    ],
  },
  {
    title: 'Comunicação',
    pages: [
      { to: '/app/settings/templates', title: 'Mensagens', description: 'Texto do WhatsApp e do e-mail de cada aviso', icon: MessageSquareText, roles: ADMIN_ONLY },
      { to: '/app/settings/notifications', title: 'Notificações', description: 'Quais avisos saem e por qual canal', icon: Bell, roles: ADMIN_ONLY },
    ],
  },
  {
    title: 'Robô de documentos',
    pages: [
      { to: '/app/settings/document-models', title: 'Modelos de documento', description: 'Ensina o robô a reconhecer seus documentos', icon: FileText, roles: ADMIN_ONLY },
    ],
  },
]

export function settingsGroupsFor(role: string): SettingsGroup[] {
  return SETTINGS_GROUPS
    .map((g) => ({ ...g, pages: g.pages.filter((p) => p.roles.includes(role)) }))
    .filter((g) => g.pages.length > 0)
}
