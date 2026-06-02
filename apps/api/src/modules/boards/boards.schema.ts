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
