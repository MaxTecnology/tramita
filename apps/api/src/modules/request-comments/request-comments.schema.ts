// apps/api/src/modules/request-comments/request-comments.schema.ts
import { z } from 'zod'

export const createRequestCommentSchema = z.object({
  content: z.string().min(1),
})

export type CreateRequestCommentBody = z.infer<typeof createRequestCommentSchema>
