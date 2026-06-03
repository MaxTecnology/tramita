import { z } from 'zod'

export const createBoardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().cuid(),
})

export const updateBoardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
})

export type CreateBoardBody = z.infer<typeof createBoardSchema>
export type UpdateBoardBody = z.infer<typeof updateBoardSchema>

export const searchQuerySchema = z.object({
  q: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']).optional(),
  assigneeId: z.string().cuid().optional(),
  dueBefore: z.string().datetime().optional(),
  dueAfter: z.string().datetime().optional(),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
