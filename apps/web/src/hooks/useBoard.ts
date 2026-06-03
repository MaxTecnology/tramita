import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Board } from '@/types'

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
    mutationFn: ({ taskId, columnId, position }: MoveTaskPayload) =>
      api.patch(`/tasks/${taskId}/move`, { columnId, position }).then((r) => r.data),

    onMutate: async ({ taskId, columnId, position }) => {
      await queryClient.cancelQueries({ queryKey: ['board', boardId] })
      const snapshot = queryClient.getQueryData<Board>(['board', boardId])

      if (snapshot) {
        const allTasks = snapshot.columns.flatMap((c) => c.tasks)
        const movingTask = allTasks.find((t) => t.id === taskId)

        if (movingTask) {
          queryClient.setQueryData<Board>(['board', boardId], {
            ...snapshot,
            columns: snapshot.columns.map((col) => ({
              ...col,
              tasks:
                col.id === columnId
                  ? [
                      ...col.tasks.filter((t) => t.id !== taskId),
                      { ...movingTask, columnId, position },
                    ]
                  : col.tasks.filter((t) => t.id !== taskId),
            })),
          })
        }
      }

      return { snapshot }
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(['board', boardId], ctx.snapshot)
      }
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
