// apps/api/src/modules/request-comments/request-comments.schema.ts
import { z } from 'zod'

export const createRequestCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comentário obrigatório').max(4000, 'Comentário excede o limite de 4000 caracteres'),
})

export type CreateRequestCommentBody = z.infer<typeof createRequestCommentSchema>
