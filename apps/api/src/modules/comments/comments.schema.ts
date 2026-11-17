import { z } from 'zod'

export const createCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comentário obrigatório').max(4000, 'Comentário excede o limite de 4000 caracteres'),
  // Office-only note (ignored when the client writes)
  isInternal: z.boolean().optional(),
})

export type CreateCommentBody = z.infer<typeof createCommentSchema>
