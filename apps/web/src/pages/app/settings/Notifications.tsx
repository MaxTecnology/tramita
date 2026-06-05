import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { FileSearch, Search } from 'lucide-react'

interface Config {
  whatsappEnabled?: boolean
  emailEnabled?: boolean
  taskMoved?: boolean
  taskCompleted?: boolean
  commentAdded?: boolean
  dueDateAlert?: boolean
  maximizebotToken?: string        // write-only: sent on save, never returned by API
  maximizebotTokenPreview?: string | null  // read-only: masked preview returned by API
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  emailFrom?: string
}

interface NotificationLog {
  id: string
  event: string
  channel: string
  recipient: string
  status: 'SENT' | 'FAILED' | 'PENDING'
  createdAt: string
}

const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_DUE_DATE_APPROACHING: 'Prazo se aproximando',
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Enviado',
  FAILED: 'Falhou',
  PENDING: 'Pendente',
}

const STATUS_BADGE: Record<string, string> = {
  SENT: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  PENDING: 'bg-amber-100 text-amber-700',
}

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: '📱 WhatsApp',
  EMAIL: '✉️ E-mail',
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-[#185FA5]' : 'bg-gray-200',
      )}
    >
      <span className={cn(
        'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0.5',
      )} />
    </button>
  )
}

function SwitchRow({ label, description, checked, onChange }: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        {children}
      </div>
    </div>
  )
}

export default function Notifications() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'config' | 'logs'>('config')
  const [form, setForm] = useState<Config>({})
  const [logSearch, setLogSearch] = useState('')
  const [logStatus, setLogStatus] = useState<'' | 'SENT' | 'FAILED' | 'PENDING'>('')

  const { data: config } = useQuery<Config>({
    queryKey: ['notifications-config'],
    queryFn: () => api.get('/notifications/config').then((r) => r.data),
  })

  const { data: logs = [] } = useQuery<NotificationLog[]>({
    queryKey: ['notifications-logs'],
    queryFn: () => api.get('/notifications/logs').then((r) => r.data),
  })

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== null && v !== '' && v !== undefined),
      )
      return api.patch('/notifications/config', payload).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success('Configurações salvas')
      queryClient.invalidateQueries({ queryKey: ['notifications-config'] })
    },
    onError: () => toast.error('Erro ao salvar configurações'),
  })

  const filteredLogs = useMemo(() => {
    const q = logSearch.toLowerCase().trim()
    return logs.filter((l) => {
      if (logStatus && l.status !== logStatus) return false
      if (q) {
        const event = (EVENT_LABEL[l.event] ?? l.event).toLowerCase()
        return event.includes(q) || l.recipient.toLowerCase().includes(q)
      }
      return true
    })
  }, [logs, logSearch, logStatus])

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Notificações</h1>
        <p className="text-sm text-gray-500 mt-1">Configure os canais e eventos de notificação do escritório.</p>
      </div>

      {/* Abas */}
      <div className="flex border-b border-gray-200 mb-6">
        {(['config', 'logs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-[#185FA5] text-[#185FA5]'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t === 'config' ? 'Configurações' : 'Histórico de envios'}
          </button>
        ))}
      </div>

      {/* Aba: Configurações */}
      {tab === 'config' && (
        <div className="space-y-4">
          <Section title="Eventos">
            <SwitchRow
              label="Tarefa movida"
              description="Notifica quando uma tarefa muda de etapa"
              checked={form.taskMoved ?? false}
              onChange={(v) => setForm({ ...form, taskMoved: v })}
            />
            <SwitchRow
              label="Tarefa concluída"
              description="Notifica quando uma tarefa é finalizada"
              checked={form.taskCompleted ?? false}
              onChange={(v) => setForm({ ...form, taskCompleted: v })}
            />
            <SwitchRow
              label="Comentário adicionado"
              description="Notifica quando alguém comenta em uma tarefa"
              checked={form.commentAdded ?? false}
              onChange={(v) => setForm({ ...form, commentAdded: v })}
            />
            <SwitchRow
              label="Prazo se aproximando"
              description="Notifica 24h antes do vencimento"
              checked={form.dueDateAlert ?? false}
              onChange={(v) => setForm({ ...form, dueDateAlert: v })}
            />
          </Section>

          <Section title="WhatsApp — MaximizeBot">
            <SwitchRow
              label="Habilitar WhatsApp"
              checked={form.whatsappEnabled ?? false}
              onChange={(v) => setForm({ ...form, whatsappEnabled: v })}
            />
            <div className={cn('space-y-1 transition-opacity', !form.whatsappEnabled && 'opacity-40 pointer-events-none')}>
              <Label htmlFor="wb-token">Bearer Token</Label>
              <Input
                id="wb-token"
                type="text"
                value={form.maximizebotToken ?? ''}
                onChange={(e) => setForm({ ...form, maximizebotToken: e.target.value })}
                placeholder="Bearer <token>"
                className="font-mono text-sm"
              />
              {config?.maximizebotTokenPreview && (
                <p className="text-xs text-gray-400 mt-1">
                  Salvo: <span className="font-mono text-gray-500">{config.maximizebotTokenPreview}</span>
                </p>
              )}
            </div>
          </Section>

          <Section title="E-mail — SMTP">
            <SwitchRow
              label="Habilitar E-mail"
              checked={form.emailEnabled ?? false}
              onChange={(v) => setForm({ ...form, emailEnabled: v })}
            />
            <div className={cn('space-y-3 transition-opacity', !form.emailEnabled && 'opacity-40 pointer-events-none')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="smtp-host">Host SMTP</Label>
                  <Input id="smtp-host" value={form.smtpHost ?? ''} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smtp-port">Porta</Label>
                  <Input id="smtp-port" type="number" value={form.smtpPort ?? ''} onChange={(e) => setForm({ ...form, smtpPort: e.target.value ? Number(e.target.value) : undefined })} placeholder="587" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smtp-user">Usuário</Label>
                  <Input id="smtp-user" value={form.smtpUser ?? ''} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} placeholder="seu@email.com" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smtp-from">Remetente</Label>
                  <Input id="smtp-from" value={form.emailFrom ?? ''} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })} placeholder="Tramita <noreply@...>" />
                </div>
              </div>
            </div>
          </Section>

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white shadow-sm"
            >
              {saveMutation.isPending ? 'Salvando...' : 'Salvar configurações'}
            </Button>
          </div>
        </div>
      )}

      {/* Aba: Histórico */}
      {tab === 'logs' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                aria-label="Buscar logs"
                type="text"
                placeholder="Buscar por evento ou destinatário..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
              />
            </div>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([
                { value: '' as const,        label: 'Todos' },
                { value: 'SENT' as const,    label: 'Enviado' },
                { value: 'PENDING' as const, label: 'Pendente' },
                { value: 'FAILED' as const,  label: 'Falhou' },
              ]).map(({ value, label }) => (
                <button
                  key={value || 'all'}
                  type="button"
                  onClick={() => setLogStatus(value)}
                  className={cn(
                    'px-3 py-2 text-sm font-medium transition-colors',
                    logStatus === value ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-16">
                <FileSearch size={36} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">Nenhum registro encontrado</p>
                <p className="text-xs text-gray-400 mt-1">
                  {logs.length === 0 ? 'Ainda não há envios registrados.' : 'Ajuste os filtros para ver mais resultados.'}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden sm:flex items-center gap-3 px-5 py-2 bg-gray-50/80 border-b border-gray-100">
                  <div className="flex-[2] text-xs font-semibold text-gray-400 uppercase tracking-wide">Evento</div>
                  <div className="flex-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Canal</div>
                  <div className="flex-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Destinatário</div>
                  <div className="w-24 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Status</div>
                  <div className="w-32 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Data</div>
                </div>
                {filteredLogs.map((log) => (
                  <div key={log.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3 border-b border-gray-100 last:border-0 text-sm">
                    <div className="flex-[2] min-w-0">
                      <p className="text-gray-800 truncate">{EVENT_LABEL[log.event] ?? log.event}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-500 truncate">{CHANNEL_LABEL[log.channel] ?? log.channel}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-500 truncate">{log.recipient}</p>
                    </div>
                    <div className="w-24 text-right">
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_BADGE[log.status] ?? 'bg-gray-100 text-gray-600')}>
                        {STATUS_LABEL[log.status] ?? log.status}
                      </span>
                    </div>
                    <div className="w-32 text-right">
                      <p className="text-xs text-gray-400">
                        {new Date(log.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {filteredLogs.length > 0 && (
            <p className="text-xs text-gray-400 text-right">
              {filteredLogs.length === logs.length
                ? `${logs.length} registro${logs.length !== 1 ? 's' : ''}`
                : `Exibindo ${filteredLogs.length} de ${logs.length}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
