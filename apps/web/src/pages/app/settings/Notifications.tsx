import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

interface Config {
  whatsappEnabled?: boolean
  emailEnabled?: boolean
  taskMoved?: boolean
  taskCompleted?: boolean
  commentAdded?: boolean
  dueDateAlert?: boolean
  maximizebotToken?: string
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

export default function Notifications() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Config>({})

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
      // Strip null and empty-string values — Zod rejects null for optional fields
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

  const STATUS_COLOR: Record<string, string> = {
    SENT: 'text-green-600',
    FAILED: 'text-red-600',
    PENDING: 'text-yellow-600',
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Configurações de Notificação</h1>

      <Card>
        <CardHeader><CardTitle>Eventos habilitados</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Tarefa movida" checked={form.taskMoved ?? false} onChange={(v) => setForm({ ...form, taskMoved: v })} />
          <Toggle label="Tarefa concluída" checked={form.taskCompleted ?? false} onChange={(v) => setForm({ ...form, taskCompleted: v })} />
          <Toggle label="Comentário adicionado" checked={form.commentAdded ?? false} onChange={(v) => setForm({ ...form, commentAdded: v })} />
          <Toggle label="Prazo se aproximando" checked={form.dueDateAlert ?? false} onChange={(v) => setForm({ ...form, dueDateAlert: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>WhatsApp (MaximizeBot)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Habilitar WhatsApp" checked={form.whatsappEnabled ?? false} onChange={(v) => setForm({ ...form, whatsappEnabled: v })} />
          <div>
            <Label>Bearer Token</Label>
            <Input
              type="password"
              value={form.maximizebotToken ?? ''}
              onChange={(e) => setForm({ ...form, maximizebotToken: e.target.value })}
              placeholder="Bearer <token>"
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>E-mail (SMTP)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Habilitar E-mail" checked={form.emailEnabled ?? false} onChange={(v) => setForm({ ...form, emailEnabled: v })} />
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Host SMTP</Label><Input value={form.smtpHost ?? ''} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} className="mt-1" /></div>
            <div><Label>Porta</Label><Input type="number" value={form.smtpPort ?? ''} onChange={(e) => setForm({ ...form, smtpPort: e.target.value ? Number(e.target.value) : undefined })} className="mt-1" /></div>
            <div><Label>Usuário</Label><Input value={form.smtpUser ?? ''} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} className="mt-1" /></div>
            <div><Label>Remetente</Label><Input value={form.emailFrom ?? ''} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })} className="mt-1" /></div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Salvar configurações
      </Button>

      <Card>
        <CardHeader><CardTitle>Logs de notificação</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum log ainda.</p>
          ) : (
            <div className="space-y-1">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                  <span className="text-gray-700">{log.event} · {log.channel} → {log.recipient}</span>
                  <span className={STATUS_COLOR[log.status]}>{log.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
