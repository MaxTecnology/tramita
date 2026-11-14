import { useQueryClient } from '@tanstack/react-query'
import { useEventStream } from './useEventStream'

function taskIdOf(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (parsed && typeof parsed === 'object' && 'taskId' in parsed && typeof parsed.taskId === 'string') return parsed.taskId
  } catch { /* no payload */ }
  return null
}

// Real time for a board (process or the recurring board): the lists and, when the event names a task,
// its open panel — documents, history, comments, approvals and attachments
export function useBoardStream(boardId: string | undefined) {
  const queryClient = useQueryClient()
  const refresh = (data: string) => {
    queryClient.invalidateQueries({ queryKey: ['board', boardId] })
    queryClient.invalidateQueries({ queryKey: ['portal-board', boardId] })
    queryClient.invalidateQueries({ queryKey: ['boards'] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    const taskId = taskIdOf(data)
    if (!taskId) return
    for (const key of ['task-documents', 'task-history', 'comments', 'task-approvals', 'attachments', 'protocols']) {
      queryClient.invalidateQueries({ queryKey: [key, taskId] })
    }
  }
  useEventStream(`/boards/${boardId}/stream`, {
    'task:moved': refresh,
    'task:created': refresh,
    'task:updated': refresh,
    'comment:added': refresh,
  }, !!boardId)
}
