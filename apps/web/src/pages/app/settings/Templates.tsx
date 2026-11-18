import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { TemplateEditor } from '@/components/TemplateEditor'
import { askConfirm } from '@/components/ui/app-dialogs'

const EVENTS = [
  'TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_BLOCKED',
  'DOCUMENT_REJECTED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
  'REQUEST_NEEDS_INFO', 'REQUEST_COMMENT_ADDED', 'REQUEST_CANCELLED', 'PROTOCOL_CREATED',
  'RECURRING_GENERATION_FAILED', 'SLA_DIGEST', 'TASK_ASSUMED', 'APPROVAL_REQUESTED', 'APPROVAL_CHANGES_REQUESTED',
] as const
const CHANNELS = ['WHATSAPP', 'EMAIL'] as const
const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail' }

const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_BLOCKED: 'Tarefa com impedimento',
  DOCUMENT_REJECTED: 'Documento rejeitado',
  REQUEST_CREATED: 'Solicitação criada',
  REQUEST_APPROVED: 'Solicitação aprovada',
  REQUEST_REJECTED: 'Solicitação rejeitada',
  REQUEST_NEEDS_INFO: 'Solicitação precisa de mais informação',
  REQUEST_COMMENT_ADDED: 'Comentário em solicitação',
  REQUEST_CANCELLED: 'Solicitação cancelada (pós-aprovação)',
  PROTOCOL_CREATED: 'Protocolo criado',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
  SLA_DIGEST: 'Resumo diário de prazos',
  TASK_ASSUMED: 'Tarefa assumida por um colega',
  APPROVAL_REQUESTED: 'Pedido de aprovação ao cliente',
  APPROVAL_CHANGES_REQUESTED: 'Cliente pediu ajuste na aprovação',
}

// Configurações › Mensagens: the WhatsApp and e-mail text of each notice
export default function Templates() {
  const [event, setEvent] = useState<string>('TASK_MOVED')
  const [channel, setChannel] = useState<string>('WHATSAPP')
  const dirty = useRef(false)
  const onDirtyChange = useCallback((d: boolean) => { dirty.current = d }, [])

  // Closing or reloading the tab with an edited text: the browser asks first
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  async function change(apply: () => void) {
    if (dirty.current) {
      const ok = await askConfirm({
        title: 'Descartar a mudança não salva?',
        description: 'O texto editado deste aviso ainda não foi salvo e se perde ao trocar.',
        confirmLabel: 'Descartar',
      })
      if (!ok) return
    }
    dirty.current = false
    apply()
  }
  const selectCls = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Mensagens"
        description="O texto de cada aviso automático, por WhatsApp e por e-mail. Sem personalizar, vale o texto padrão do sistema. Quais avisos são enviados se define em Notificações."
      />
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row">
          <div className="flex-1 space-y-1">
            <label htmlFor="template-event" className="text-sm font-medium text-foreground">Aviso</label>
            <select id="template-event" value={event} onChange={(e) => { const v = e.target.value; void change(() => setEvent(v)) }} className={selectCls}>
              {EVENTS.map((e) => <option key={e} value={e}>{EVENT_LABEL[e]}</option>)}
            </select>
          </div>
          <div className="space-y-1 sm:w-44">
            <label htmlFor="template-channel" className="text-sm font-medium text-foreground">Canal</label>
            <select id="template-channel" value={channel} onChange={(e) => { const v = e.target.value; void change(() => setChannel(v)) }} className={selectCls}>
              {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 py-5">
          <TemplateEditor key={`${event}-${channel}`} event={event} channel={channel} onDirtyChange={onDirtyChange} />
        </div>
      </div>
    </div>
  )
}
