import { z } from 'zod'

export const createCommentSchema = z.object({
  content: z.string().min(1),
})

export type CreateCommentBody = z.infer<typeof createCommentSchema>
