import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { askConfirm } from '@/components/ui/app-dialogs'
import { toast } from 'sonner'

// What can go into a message, by the name the office knows it (the code goes in the text)
const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: 'clientName', label: 'Nome do cliente' },
  { key: 'orgName', label: 'Nome do escritório' },
  { key: 'taskTitle', label: 'Título da tarefa' },
  { key: 'fromColumn', label: 'Etapa anterior' },
  { key: 'toColumn', label: 'Nova etapa' },
  { key: 'dueDate', label: 'Data de vencimento' },
  { key: 'portalUrl', label: 'Link do portal' },
  { key: 'commentText', label: 'Texto do comentário' },
  { key: 'commentAuthorName', label: 'Autor do comentário' },
  { key: 'taskCount', label: 'Quantidade de tarefas em alerta' },
  { key: 'criticalCount', label: 'Quantidade de tarefas críticas' },
  { key: 'taskListText', label: 'Lista de tarefas em alerta' },
  { key: 'assumedByName', label: 'Quem assumiu a tarefa' },
  { key: 'approvalTitle', label: 'Título da aprovação' },
]

interface Props {
  event: string
  channel: string
}

export function TemplateEditor({ event, channel }: Props) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  // Where the cursor was when the text box lost focus (clicking a variable takes the focus away)
  const cursor = useRef<{ start: number; end: number } | null>(null)

  const key = ['template', event, channel]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ body: string; subject?: string; isDefault: boolean }>(`/notifications/templates/${event}/${channel}`).then((r) => r.data),
  })

  useEffect(() => {
    if (data?.body !== undefined) { setBody(data.body); setPreview(null); cursor.current = null }
  }, [data?.body])

  const previewMutation = useMutation({
    mutationFn: () => api.post<{ rendered: string }>('/notifications/templates/preview', { event, channel, body }).then((r) => r.data),
    onSuccess: (d) => setPreview(d.rendered),
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível gerar a prévia')),
  })

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/notifications/templates/${event}/${channel}`, { body }).then((r) => r.data),
    onSuccess: () => { toast.success('Mensagem salva'); queryClient.invalidateQueries({ queryKey: key }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível salvar a mensagem')),
  })

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/notifications/templates/${event}/${channel}`),
    onSuccess: () => { toast.success('Mensagem voltou ao texto padrão'); queryClient.invalidateQueries({ queryKey: key }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível voltar ao texto padrão')),
  })

  function rememberCursor() {
    const el = box.current
    if (el) cursor.current = { start: el.selectionStart, end: el.selectionEnd }
  }

  function insert(variable: string) {
    const token = `{{${variable}}}`
    const at = cursor.current ?? { start: body.length, end: body.length }
    const next = body.slice(0, at.start) + token + body.slice(at.end)
    setBody(next)
    const caret = at.start + token.length
    cursor.current = { start: caret, end: caret }
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(caret, caret) })
  }

  async function backToDefault() {
    const ok = await askConfirm({
      title: 'Voltar ao texto padrão?',
      description: 'O texto personalizado deste aviso é apagado e passa a valer o texto do sistema.',
      confirmLabel: 'Voltar ao padrão',
    })
    if (ok) resetMutation.mutate()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={data?.isDefault === false ? 'rounded bg-info-bg px-2 py-0.5 text-xs text-info-text' : 'rounded bg-neutral-bg px-2 py-0.5 text-xs text-muted-foreground'}>
          {data === undefined ? 'Carregando...' : data.isDefault ? 'Texto padrão do sistema' : 'Personalizada pelo escritório'}
        </span>
        {data?.isDefault === false && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void backToDefault()} disabled={resetMutation.isPending}>
            Voltar ao texto padrão
          </Button>
        )}
      </div>

      <div>
        <label htmlFor="template-body" className="mb-1.5 block text-sm font-medium text-foreground">Mensagem</label>
        <Textarea
          id="template-body"
          ref={box}
          value={body}
          onChange={(e) => { setBody(e.target.value); setPreview(null) }}
          onSelect={rememberCursor}
          onBlur={rememberCursor}
          rows={8}
          disabled={!data}
          placeholder={data ? undefined : 'Carregando a mensagem...'}
          className="resize-y font-mono text-sm"
        />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">Inserir no texto</p>
        <p className="mb-2 text-xs text-muted-foreground">Clique para colocar onde está o cursor. No envio, cada campo vira o dado real do cliente e da tarefa.</p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map(({ key: k, label }) => (
            <button
              key={k}
              type="button"
              title={`{{${k}}}`}
              onClick={() => insert(k)}
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground transition-colors hover:border-accent hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={() => previewMutation.mutate()} disabled={!data || previewMutation.isPending}>
          {previewMutation.isPending ? 'Gerando prévia...' : 'Ver prévia'}
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={!data || saveMutation.isPending}>
          {saveMutation.isPending ? 'Salvando...' : 'Salvar mensagem'}
        </Button>
      </div>

      {preview && (
        <div className="rounded-lg border border-border bg-neutral-bg/50 p-4">
          <p className="mb-2 text-sm font-medium text-foreground">Como o cliente vai receber (com dados de exemplo)</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{preview}</p>
        </div>
      )}
    </div>
  )
}
