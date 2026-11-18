import { api } from '@/lib/api'
import { withDelayReason } from '@/components/shared/task-documents/delayReason'
import type { Task } from '@/types'

// Status change from the Kanban, with the same rules as the task panel: finishing an OS after its
// internal deadline asks the reason (the API answers 422 until it comes). false = the person gave up.
export async function changeTaskStatus(taskId: string, status: Task['status']): Promise<boolean> {
  if (status !== 'DONE') {
    await api.patch(`/tasks/${taskId}`, { status })
    return true
  }
  const result = await withDelayReason((extra) => api.patch(`/tasks/${taskId}`, { status, ...extra }).then((r) => r.data))
  return result !== null
}

// An OS waiting for another one has no status of its own until it is released (the panel shows
// "aguardando ..." instead of the status select)
export function waitsForAnotherOS(task: Pick<Task, 'status' | 'osModelId' | 'releasedAt'>): boolean {
  return !!task.osModelId && !task.releasedAt && task.status !== 'DONE' && task.status !== 'DISREGARDED'
}
