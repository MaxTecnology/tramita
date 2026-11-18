import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Board } from '@/types'
import { toast } from 'sonner'
import { mensagemDeErro } from '@/lib/utils'
import { withDelayReason } from '@/components/shared/task-documents/delayReason'
import { placeTask } from './boardOrder'

class MoveCancelled extends Error {}

export interface MoveTaskPayload {
  taskId: string
  columnId: string
  position: number
}

export function useBoard(boardId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api.get<Board>(`/boards/${boardId}`).then((r) => r.data),
    enabled: !!boardId,
  })

  const moveMutation = useMutation({
    // Dropping a late OS on a done column asks the reason; giving up reverts the move
    mutationFn: async ({ taskId, columnId, position }: MoveTaskPayload) => {
      const result = await withDelayReason((extra) => api.patch(`/tasks/${taskId}/move`, { columnId, position, ...extra }).then((r) => r.data))
      if (result === null) throw new MoveCancelled()
      return result
    },

    onMutate: async ({ taskId, columnId, position }) => {
      await queryClient.cancelQueries({ queryKey: ['board', boardId] })
      const snapshot = queryClient.getQueryData<Board>(['board', boardId])

      if (snapshot) queryClient.setQueryData<Board>(['board', boardId], placeTask(snapshot, taskId, columnId, position))

      return { snapshot }
    },

    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(['board', boardId], ctx.snapshot)
      }
      // e.g. "Esta OS aguarda: Registro na Junta"
      if (!(err instanceof MoveCancelled)) toast.error(mensagemDeErro(err, 'Não foi possível mover a tarefa'))
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
    },
  })

  return {
    board: query.data,
    isLoading: query.isLoading,
    moveTask: moveMutation.mutate,
  }
}
