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
    <div className="space-y-4">
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

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        className="font-mono text-sm"
      />

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
        >
          Prévia
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Salvar
        </Button>
      </div>

      {preview && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm whitespace-pre-wrap">
          <p className="text-xs font-medium text-gray-500 mb-2">Preview:</p>
          {preview}
        </div>
      )}
    </div>
  )
}
