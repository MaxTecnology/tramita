import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
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

export type CreateTaskBody = z.infer<typeof createTaskSchema>
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>
export type MoveTaskBody = z.infer<typeof moveTaskSchema>
export type ReorderTasksBody = z.infer<typeof reorderTasksSchema>
