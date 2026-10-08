import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { FileSearch, Search, Send, ArrowLeft, Upload, Volume2, Trash2 } from 'lucide-react'

interface Config {
  whatsappEnabled?: boolean
  emailEnabled?: boolean
  taskCreated?: boolean
  taskMoved?: boolean
  taskCompleted?: boolean
  commentAdded?: boolean
  taskBlocked?: boolean
  requestCreated?: boolean
  requestApproved?: boolean
  requestRejected?: boolean
  recurringGenerationFailed?: boolean
  documentRejected?: boolean
  slaTargetWarningDays?: number
  slaDueCriticalDays?: number
  slaDigestEnabled?: boolean
  lateClosureThresholdDays?: number
  customSlaSoundLabel?: string | null
  maximizebotToken?: string        // write-only: sent on save, never returned by API
  maximizebotTokenPreview?: string | null  // read-only: masked preview returned by API
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
  TASK_BLOCKED: 'Tarefa com impedimento',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
  DOCUMENT_REJECTED: 'Documento rejeitado',
  REQUEST_CREATED: 'Solicitação criada',
  REQUEST_APPROVED: 'Solicitação aprovada',
  REQUEST_REJECTED: 'Solicitação rejeitada',
  SLA_DIGEST: 'Resumo diário de prazos',
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
        checked ? 'bg-[#185FA5]' : 'bg-neutral-bg',
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
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-neutral-bg">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
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

  const [testEmailTo, setTestEmailTo] = useState('')
  const testEmailMutation = useMutation({
    mutationFn: (to: string) => api.post('/notifications/config/test-email', { to }),
    onSuccess: () => { toast.success('Email de teste enviado'); setTestEmailTo('') },
    onError: () => toast.error('Erro ao enviar email de teste'),
  })

  const uploadSoundMutation = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData()
      // label precisa vir ANTES de file no FormData — o backend lê esse campo via
      // `file.fields.label` do fastify/multipart, que só captura campos que já chegaram no
      // stream antes do arquivo ser processado.
      data.append('label', file.name)
      data.append('file', file)
      return api.post('/notifications/config/sla-sound', data)
    },
    onSuccess: () => {
      toast.success('Som do escritório atualizado')
      // Três telas dependem do som da org: esta (notifications-config), o Perfil e o próprio
      // useSlaAlerts (sla-config/sla-custom-sound-url) — sem invalidar as três, ficam até 5min
      // (staleTime) mostrando o estado antigo.
      queryClient.invalidateQueries({ queryKey: ['notifications-config'] })
      queryClient.invalidateQueries({ queryKey: ['sla-config'] })
      queryClient.invalidateQueries({ queryKey: ['sla-custom-sound-url'] })
    },
    onError: () => toast.error('Erro ao enviar som — use MP3 ou WAV, até 500KB'),
  })

  const deleteSoundMutation = useMutation({
    mutationFn: () => api.delete('/notifications/config/sla-sound'),
    onSuccess: () => {
      toast.success('Som do escritório removido')
      queryClient.invalidateQueries({ queryKey: ['notifications-config'] })
      queryClient.invalidateQueries({ queryKey: ['sla-config'] })
      queryClient.invalidateQueries({ queryKey: ['sla-custom-sound-url'] })
    },
    onError: () => toast.error('Erro ao remover som'),
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
        <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">Notificações</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure os canais e eventos de notificação do escritório.</p>
      </div>

      {/* Abas */}
      <div className="flex border-b border-border mb-6">
        {(['config', 'logs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-[#185FA5] text-[#185FA5]'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'config' ? 'Configurações' : 'Histórico de envios'}
          </button>
        ))}
      </div>

      {/* Aba: Configurações */}
      {tab === 'config' && (
        <div className="space-y-4">
          <Section title="Eventos — Tarefas">
            <SwitchRow
              label="Tarefa criada"
              description="Notifica o cliente quando uma nova tarefa é aberta pra ele (inclusive tarefas recorrentes)"
              checked={form.taskCreated ?? false}
              onChange={(v) => setForm({ ...form, taskCreated: v })}
            />
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
              label="Tarefa com impedimento"
              description="Notifica o cliente quando uma tarefa dele fica com impedimento"
              checked={form.taskBlocked ?? false}
              onChange={(v) => setForm({ ...form, taskBlocked: v })}
            />
            <SwitchRow
              label="Documento rejeitado"
              description="Notifica o cliente quando um documento enviado por ele é rejeitado"
              checked={form.documentRejected ?? false}
              onChange={(v) => setForm({ ...form, documentRejected: v })}
            />
          </Section>

          <Section title="Eventos — Solicitações">
            <SwitchRow
              label="Solicitação criada"
              description="Notifica a equipe interna quando um cliente abre uma solicitação"
              checked={form.requestCreated ?? false}
              onChange={(v) => setForm({ ...form, requestCreated: v })}
            />
            <SwitchRow
              label="Solicitação aprovada"
              description="Notifica o cliente quando a solicitação dele é aprovada"
              checked={form.requestApproved ?? false}
              onChange={(v) => setForm({ ...form, requestApproved: v })}
            />
            <SwitchRow
              label="Solicitação rejeitada"
              description="Notifica o cliente quando a solicitação dele não é aprovada"
              checked={form.requestRejected ?? false}
              onChange={(v) => setForm({ ...form, requestRejected: v })}
            />
          </Section>

          <Section title="Eventos — Tarefas recorrentes">
            <SwitchRow
              label="Falha na geração de tarefa recorrente"
              description="Notifica os administradores quando o sistema não consegue gerar uma tarefa recorrente automaticamente"
              checked={form.recurringGenerationFailed ?? false}
              onChange={(v) => setForm({ ...form, recurringGenerationFailed: v })}
            />
          </Section>

          <Section title="Alertas de SLA">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="sla-target-days">Aviso de meta (dias antes)</Label>
                <Input
                  id="sla-target-days"
                  type="number"
                  min={0}
                  max={90}
                  value={form.slaTargetWarningDays ?? 3}
                  onChange={(e) => setForm({ ...form, slaTargetWarningDays: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sla-critical-days">Aviso crítico (dias antes do vencimento)</Label>
                <Input
                  id="sla-critical-days"
                  type="number"
                  min={0}
                  max={90}
                  value={form.slaDueCriticalDays ?? 1}
                  onChange={(e) => setForm({ ...form, slaDueCriticalDays: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="late-closure-days">Alerta de fechamento tardio (dias parados antes de concluir)</Label>
                <Input
                  id="late-closure-days"
                  type="number"
                  min={0}
                  max={90}
                  value={form.lateClosureThresholdDays ?? 2}
                  onChange={(e) => setForm({ ...form, lateClosureThresholdDays: Number(e.target.value) })}
                />
              </div>
            </div>
            <SwitchRow
              label="Resumo diário de prazos"
              description="Envia 1 email/WhatsApp por dia (8h) listando tarefas com prazo próximo, em vez de notificação a cada tarefa"
              checked={form.slaDigestEnabled ?? false}
              onChange={(v) => setForm({ ...form, slaDigestEnabled: v })}
            />
            <div className="space-y-1">
              <Label>Som customizado do escritório</Label>
              <p className="text-xs text-muted-foreground">
                Som usado no alerta sonoro em tempo real (push no navegador). MP3 ou WAV, até 500KB.
              </p>
              {config?.customSlaSoundLabel ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-neutral-bg px-3 py-2">
                  <span className="text-sm text-foreground flex items-center gap-1.5">
                    <Volume2 size={14} />
                    {config.customSlaSoundLabel}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleteSoundMutation.isPending}
                    onClick={() => deleteSoundMutation.mutate()}
                    className="flex items-center gap-1.5"
                  >
                    <Trash2 size={14} />
                    Remover
                  </Button>
                </div>
              ) : (
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-neutral-bg">
                  <Upload size={14} />
                  {uploadSoundMutation.isPending ? 'Enviando...' : 'Escolher arquivo (.mp3/.wav)'}
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav"
                    className="hidden"
                    disabled={uploadSoundMutation.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadSoundMutation.mutate(file)
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
            </div>
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
                <p className="text-xs text-muted-foreground mt-1">
                  Salvo: <span className="font-mono text-muted-foreground">{config.maximizebotTokenPreview}</span>
                </p>
              )}
            </div>
          </Section>

          <Section title="E-mail">
            <SwitchRow
              label="Habilitar E-mail"
              checked={form.emailEnabled ?? false}
              onChange={(v) => setForm({ ...form, emailEnabled: v })}
            />
            <p className="text-xs text-muted-foreground">
              Os emails são enviados automaticamente pelo Tramita via <span className="font-medium">notificacoes@autohubs.com.br</span>.
            </p>
            <div className={cn('space-y-1 transition-opacity', !form.emailEnabled && 'opacity-40 pointer-events-none')}>
              <Label htmlFor="test-email-to">Enviar email de teste</Label>
              <div className="flex gap-2">
                <Input
                  id="test-email-to"
                  type="email"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="destinatario@email.com"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!testEmailTo || testEmailMutation.isPending}
                  onClick={() => testEmailMutation.mutate(testEmailTo)}
                  className="flex items-center gap-1.5 flex-shrink-0"
                >
                  <Send size={14} />
                  {testEmailMutation.isPending ? 'Enviando...' : 'Testar'}
                </Button>
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
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Buscar logs"
                type="text"
                placeholder="Buscar por evento ou destinatário..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
              />
            </div>
            <div className="flex rounded-lg border border-border overflow-hidden">
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
                    logStatus === value ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista */}
          <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-16">
                <FileSearch size={36} className="mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm font-medium text-muted-foreground">Nenhum registro encontrado</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logs.length === 0 ? 'Ainda não há envios registrados.' : 'Ajuste os filtros para ver mais resultados.'}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden sm:flex items-center gap-3 px-5 py-2 bg-neutral-bg border-b border-border">
                  <div className="flex-[2] text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evento</div>
                  <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Canal</div>
                  <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Destinatário</div>
                  <div className="w-24 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Status</div>
                  <div className="w-32 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Data</div>
                </div>
                {filteredLogs.map((log) => (
                  <div key={log.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3 border-b border-border last:border-0 text-sm">
                    <div className="flex-[2] min-w-0">
                      <p className="text-foreground truncate">{EVENT_LABEL[log.event] ?? log.event}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground truncate">{CHANNEL_LABEL[log.channel] ?? log.channel}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground truncate">{log.recipient}</p>
                    </div>
                    <div className="w-24 text-right">
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_BADGE[log.status] ?? 'bg-gray-100 text-gray-600')}>
                        {STATUS_LABEL[log.status] ?? log.status}
                      </span>
                    </div>
                    <div className="w-32 text-right">
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {filteredLogs.length > 0 && (
            <p className="text-xs text-muted-foreground text-right">
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
