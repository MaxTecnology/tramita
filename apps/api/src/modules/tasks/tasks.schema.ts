import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  departmentId: z.string().cuid(),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['OPEN', 'STARTED', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
  departmentId: z.string().cuid().optional(),
  visibleToClient: z.boolean().optional(),
  targetDate: z.string().datetime().nullable().optional(),
  competence: z.string().datetime().nullable().optional(),
})

export const moveTaskSchema = z.object({
  columnId: z.string().cuid(),
  position: z.number().int().min(0),
})

export const reorderTasksSchema = z.array(
  z.object({
    id: z.string().cuid(),
    position: z.number().int().min(0),
    columnId: z.string().cuid(),
  }),
)

export const listTasksQuerySchema = z.object({
  clientId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  status: z.enum(['OPEN', 'STARTED', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
  recurringTemplateId: z.string().cuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export type CreateTaskBody = z.infer<typeof createTaskSchema>
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>
export type MoveTaskBody = z.infer<typeof moveTaskSchema>
export type ReorderTasksBody = z.infer<typeof reorderTasksSchema>
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>
