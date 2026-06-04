import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Comment, DrawerRole } from '@/types'

interface Props {
  taskId: string
  currentUserId: string
  role: DrawerRole
}

const CAN_SEE_DELETED = new Set<DrawerRole>(['ORG_ADMIN', 'ORG_MANAGER'])

export function Comments({ taskId, currentUserId, role }: Props) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ['comments', taskId],
    queryFn: () => api.get(`/tasks/${taskId}/comments`).then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/comments`, { content }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
      setContent('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.delete(`/comments/${commentId}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', taskId] }),
  })

  function canDelete(c: Comment) {
    if (c.deletedAt) return false
    if (role === 'CLIENT') return c.client?.id === currentUserId
    if (role === 'ORG_ADMIN' || role === 'ORG_MANAGER') return true
    return c.user?.id === currentUserId
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2">
        {comments.map((c) => {
          const isClient = c.authorType === 'CLIENT'
          const author = isClient ? c.client : c.user
          const isDeleted = !!c.deletedAt

          return (
            <div
              key={c.id}
              className={cn(
                'rounded-lg p-3 border-l-2',
                isClient ? 'bg-blue-50 border-blue-400' : 'bg-violet-50 border-violet-400',
                isDeleted && 'opacity-60',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn('text-xs font-semibold', isClient ? 'text-blue-700' : 'text-violet-700')}>
                  {author?.name ?? (isClient ? 'Cliente' : 'Colaborador')}
                  {isClient && <span className="ml-1 text-blue-500 font-normal">(cliente)</span>}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {new Date(c.createdAt).toLocaleString('pt-BR')}
                  </span>
                  {canDelete(c) && (
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(c.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              {isDeleted ? (
                <div>
                  <p className="text-xs text-gray-400 italic">
                    Comentário removido em {new Date(c.deletedAt!).toLocaleString('pt-BR')}
                  </p>
                  {CAN_SEE_DELETED.has(role) && c.deletedContent && (
                    <details className="mt-1">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                        Ver conteúdo removido
                      </summary>
                      <p className="text-sm text-gray-500 mt-1 line-through">{c.deletedContent}</p>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-800">{c.content}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 items-start mt-1">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Adicionar comentário..."
          rows={2}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
        />
        <Button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !content.trim()}
          size="sm"
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}
