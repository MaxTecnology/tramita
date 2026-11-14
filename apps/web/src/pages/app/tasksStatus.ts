import { STATUS_LABEL } from '@/components/shared/TaskDrawer'
import type { Task } from '@/types'

// "Pendentes" = not finished (Aberto, Iniciado, Com Impedimento): what still needs someone. It is
// the default so a blocked or overdue task is never hidden behind "Aberto".
export type StatusFilter = 'PENDING' | 'ALL' | Task['status']

export const DEFAULT_STATUS_FILTER: StatusFilter = 'PENDING'

const SINGLE: Task['status'][] = ['OPEN', 'STARTED', 'BLOCKED', 'DONE', 'DISREGARDED']

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'ALL', label: 'Todos' },
  ...SINGLE.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
]

export function statusFilterParams(filter: StatusFilter): Record<string, string> {
  if (filter === 'ALL') return {}
  if (filter === 'PENDING') return { openOnly: 'true' }
  return { status: filter }
}
