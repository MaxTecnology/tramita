import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const TEMPLATE_VARS = [
  'clientName', 'orgName', 'taskTitle', 'fromColumn',
  'toColumn', 'dueDate', 'portalUrl', 'commentText', 'commentAuthorName',
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
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_VARS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setBody((b) => b + `{{${v}}}`)}
            className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
          >
            {`{{${v}}}`}
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
