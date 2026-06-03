import { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Task } from '@/types'

interface Props {
  task: Task
  open: boolean
  onClose: () => void
}

interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  signedUrl: string
  createdAt: string
}

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export function TaskModal({ task, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(task.title)
  const [priority, setPriority] = useState(task.priority)

  const mutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] })
      onClose()
    },
  })

  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['attachments', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
    enabled: open,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/tasks/${task.id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
  })

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete(`/tasks/${task.id}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
  })

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Editar tarefa</h2>

        <div className="space-y-4">
          <div>
            <Label htmlFor="task-title">Título</Label>
            <Input
              id="task-title"
              aria-label="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="task-priority">Prioridade</Label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Task['priority'])}
              className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Attachments */}
          <div className="mt-4">
            <Label>Anexos</Label>
            <div className="mt-1 space-y-1">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                  <a
                    href={a.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline truncate max-w-[240px]"
                  >
                    {a.filename}
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteAttachmentMutation.mutate(a.id)}
                    className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0"
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 cursor-pointer">
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadMutation.mutate(file)
                  e.target.value = ''
                }}
              />
              <span className="text-xs text-blue-600 hover:underline">
                {uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo'}
              </span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate({ title, priority })}
            disabled={mutation.isPending}
          >
            Salvar
          </Button>
        </div>
      </div>
    </div>
  )
}
