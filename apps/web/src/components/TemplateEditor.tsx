import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: 'clientName',        label: 'Nome do cliente' },
  { key: 'orgName',           label: 'Nome do escritório' },
  { key: 'taskTitle',         label: 'Título da tarefa' },
  { key: 'fromColumn',        label: 'Etapa anterior' },
  { key: 'toColumn',          label: 'Nova etapa' },
  { key: 'dueDate',           label: 'Data de vencimento' },
  { key: 'portalUrl',         label: 'Link do portal' },
  { key: 'commentText',       label: 'Texto do comentário' },
  { key: 'commentAuthorName', label: 'Autor do comentário' },
]

interface Props {
  event: string
  channel: string
}

export function TemplateEditor({ event, channel }: Props) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['template', event, channel],
    queryFn: () =>
      api
        .get<{ body: string; subject?: string; isDefault: boolean }>(
          `/notifications/templates/${event}/${channel}`,
        )
        .then((r) => r.data),
  })

  useEffect(() => {
    if (data?.body) setBody(data.body)
  }, [data?.body])

  const previewMutation = useMutation({
    mutationFn: () =>
      api
        .post<{ rendered: string }>('/notifications/templates/preview', { event, channel, body })
        .then((r) => r.data),
    onSuccess: (data) => setPreview(data.rendered),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/notifications/templates/${event}/${channel}`, { body }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template', event, channel] })
    },
  })

  return (
    <div className="space-y-5">

      {/* Variáveis disponíveis */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Variáveis disponíveis</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_VARS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setBody((b) => b + `{{${key}}}`)}
              className="flex flex-col items-start px-3 py-2 rounded-md bg-[#185FA5] hover:bg-[#0C447C] active:scale-95 shadow-sm transition-all text-left"
            >
              <span className="text-xs font-mono font-semibold text-white leading-tight">{`{{${key}}}`}</span>
              <span className="text-[10px] text-blue-200 leading-tight mt-0.5">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Textarea */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Mensagem</p>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="font-mono text-sm border-gray-200 focus:ring-2 focus:ring-[#185FA5] focus:border-transparent rounded-lg resize-none"
        />
      </div>

      {/* Ações */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
          className="text-sm font-medium text-[#185FA5] hover:text-[#0C447C] disabled:opacity-40 transition-colors"
        >
          {previewMutation.isPending ? 'Gerando prévia...' : '↗ Ver prévia'}
        </button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="bg-[#185FA5] hover:bg-[#0C447C] text-white shadow-sm"
        >
          {saveMutation.isPending ? 'Salvando...' : 'Salvar template'}
        </Button>
      </div>

      {/* Preview */}
      {preview && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2">Prévia renderizada</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{preview}</p>
        </div>
      )}
    </div>
  )
}
