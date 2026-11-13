import { z } from 'zod'

export const IN_APP_TYPES = [
  'TASK_COMMENT', 'REQUEST_CREATED', 'REQUEST_COMMENT', 'DOCUMENT_UPLOADED', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED',
  'TASK_ASSUMED', 'TASK_ASSIGNED', 'BOARD_ASSIGNED', 'DOCUMENT_RECEIVED', 'DOCUMENT_REJECTED', 'REQUEST_STATUS',
] as const

export const listNotificationsQuerySchema = z.object({
  status: z.enum(['all', 'read', 'unread']).optional(),
  type: z.enum(IN_APP_TYPES).optional(),
  clientId: z.string().cuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export const readByTaskSchema = z.object({ taskId: z.string().min(1, 'Tarefa inválida') })

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>
