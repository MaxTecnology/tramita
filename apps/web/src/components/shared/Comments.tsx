import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Comment, DrawerRole } from '@/types'
import { toast } from 'sonner'

type EntityType = 'task' | 'request'

interface Props {
  entityType: EntityType
  entityId: string
  currentUserId: string
  role: DrawerRole
}

const CAN_SEE_DELETED = new Set<DrawerRole>(['ORG_ADMIN', 'ORG_MANAGER'])

function basePath(entityType: EntityType, entityId: string): string {
  return entityType === 'task' ? `/tasks/${entityId}/comments` : `/requests/${entityId}/comments`
}

function deletePath(entityType: EntityType, commentId: string): string {
  return entityType === 'task' ? `/comments/${commentId}` : `/request-comments/${commentId}`
}

export function Comments({ entityType, entityId, currentUserId, role }: Props) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const queryKey = [entityType === 'task' ? 'comments' : 'request-comments', entityId]

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey,
    queryFn: () => api.get(basePath(entityType, entityId)).then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(basePath(entityType, entityId), { content }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Comentário adicionado')
      queryClient.invalidateQueries({ queryKey })
      // Um comentário de 'request' pode reverter NEEDS_INFO -> PENDING no backend (ver
      // createRequestComment) — a lista de onde este componente é usado precisa refletir isso na
      // hora, não só no próximo refetch espontâneo. 'portal-requests' existe só no contexto do
      // portal e 'requests' só no admin — invalidar os dois aqui é inofensivo no contexto que não
      // tem a chave em cache (vira um no-op).
      if (entityType === 'request') {
        queryClient.invalidateQueries({ queryKey: ['portal-requests'] })
        queryClient.invalidateQueries({ queryKey: ['requests'] })
      }
      setContent('')
    },
    onError: () => toast.error('Erro ao adicionar comentário'),
  })

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.delete(deletePath(entityType, commentId)).then((r) => r.data),
    onSuccess: () => {
      toast.success('Comentário removido')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error('Erro ao remover comentário'),
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
                isClient ? 'bg-blue-500/10 border-accent' : 'bg-violet-500/10 border-violet-400',
                isDeleted && 'opacity-60',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn('text-xs font-semibold', isClient ? 'text-blue-700 dark:text-blue-300' : 'text-violet-700 dark:text-violet-300')}>
                  {author?.name ?? (isClient ? 'Cliente' : 'Colaborador')}
                  {isClient && <span className="ml-1 text-blue-500 dark:text-blue-400 font-normal">(cliente)</span>}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString('pt-BR')}
                  </span>
                  {canDelete(c) && (
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(c.id)}
                      className="text-xs text-danger-text hover:text-danger-hover"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              {isDeleted ? (
                <div>
                  <p className="text-xs text-muted-foreground italic">
                    Comentário removido em {new Date(c.deletedAt!).toLocaleString('pt-BR')}
                  </p>
                  {CAN_SEE_DELETED.has(role) && c.deletedContent && (
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Ver conteúdo removido
                      </summary>
                      <p className="text-sm text-muted-foreground mt-1 line-through">{c.deletedContent}</p>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-sm text-foreground">{c.content}</p>
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
          className="flex-1 rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
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
