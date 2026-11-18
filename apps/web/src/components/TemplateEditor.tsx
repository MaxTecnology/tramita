import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { askConfirm } from '@/components/ui/app-dialogs'
import { toast } from 'sonner'

// Plain name of each field the office can put in a message; which ones a notice fills comes from the API
const VAR_LABEL: Record<string, string> = {
  clientName: 'Nome do cliente',
  orgName: 'Nome do escritório',
  taskTitle: 'Título da tarefa',
  fromColumn: 'Etapa anterior',
  toColumn: 'Nova etapa',
  portalUrl: 'Link do portal',
  commentText: 'Texto do comentário',
  commentAuthorName: 'Autor do comentário',
  requestTitle: 'Título da solicitação',
  rejectionReason: 'Motivo',
  documentName: 'Nome do documento',
  protocolTitle: 'Título do protocolo',
  paymentInfo: 'Valor e vencimento da guia',
  templateTitle: 'Nome da tarefa recorrente',
  errorMessage: 'Motivo da falha',
  taskCount: 'Quantidade de tarefas em alerta',
  criticalCount: 'Quantidade de tarefas críticas',
  taskListText: 'Lista de tarefas em alerta',
  assumedByName: 'Quem assumiu a tarefa',
  approvalTitle: 'Título da aprovação',
}
const varLabel = (key: string) => VAR_LABEL[key] ?? `{{${key}}}`

type TemplateData = { body: string; subject?: string; isDefault: boolean; variables: string[] }

interface Props {
  event: string
  channel: string
  // Called whenever the text starts or stops differing from the saved one
  onDirtyChange?: (dirty: boolean) => void
}

export function TemplateEditor({ event, channel, onDirtyChange }: Props) {
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
      api.get<TemplateData>(`/notifications/templates/${event}/${channel}`).then((r) => r.data),
  })

  // `loaded` is the saved text; `body` is the box. When a new saved text arrives (first load, after
  // saving, another person saved) the box follows it only if it held no edit — an edit is never
  // overwritten. "Voltar ao texto padrão" asks the box to take the next one (`adoptNext`).
  // Both change in the same render: an effect would leave one render where they differ.
  const [loaded, setLoaded] = useState<string | undefined>(undefined)
  const [adoptNext, setAdoptNext] = useState(false)
  if (data?.body !== undefined && data.body !== loaded) {
    setLoaded(data.body)
    if (loaded === undefined || body === loaded || adoptNext) {
      setBody(data.body)
      setPreview(null)
      setAdoptNext(false)
    }
  }
  useEffect(() => { cursor.current = null }, [loaded])

  const variables = data?.variables ?? []
  // Fields in the text this notice never fills: they go out empty
  const emptyOnSend = [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].filter((v) => !variables.includes(v))

  const previewMutation = useMutation({
    mutationFn: () => api.post<{ rendered: string }>('/notifications/templates/preview', { event, channel, body }).then((r) => r.data),
    onSuccess: (d) => setPreview(d.rendered),
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível gerar a prévia')),
  })

  const saveMutation = useMutation({
    mutationFn: (sent: string) => api.put(`/notifications/templates/${event}/${channel}`, { body: sent }).then((r) => r.data),
    onSuccess: () => { toast.success('Mensagem salva'); queryClient.invalidateQueries({ queryKey: key }) },
    // The box keeps what was typed: the person can try again
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível salvar a mensagem')),
  })

  // What was just sent counts as saved (switching notice right after "Salvar" must not ask to
  // discard it); a failed save makes it unsaved again
  const justSaved = (saveMutation.isPending || saveMutation.isSuccess) && body === saveMutation.variables
  const dirty = loaded !== undefined && body !== loaded && !justSaved
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/notifications/templates/${event}/${channel}`),
    onSuccess: () => { toast.success('Mensagem voltou ao texto padrão'); setAdoptNext(true); queryClient.invalidateQueries({ queryKey: key }) },
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
        {data && emptyOnSend.length > 0 && (
          <p role="status" aria-label="Campos que saem vazios" className="mt-2 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-text">
            Este aviso não preenche {emptyOnSend.map((v) => VAR_LABEL[v] ? `${VAR_LABEL[v]} ({{${v}}})` : `{{${v}}}`).join(', ')}. Esse trecho sai vazio no envio.
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">Inserir no texto</p>
        <p className="mb-2 text-xs text-muted-foreground">Clique para colocar onde está o cursor. No envio, cada campo vira o dado real do cliente e da tarefa.</p>
        <div className="flex flex-wrap gap-1.5">
          {variables.map((k) => (
            <button
              key={k}
              type="button"
              title={`{{${k}}}`}
              onClick={() => insert(k)}
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground transition-colors hover:border-accent hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {varLabel(k)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={() => previewMutation.mutate()} disabled={!data || previewMutation.isPending}>
          {previewMutation.isPending ? 'Gerando prévia...' : 'Ver prévia'}
        </Button>
        <Button onClick={() => saveMutation.mutate(body)} disabled={!data || saveMutation.isPending}>
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
