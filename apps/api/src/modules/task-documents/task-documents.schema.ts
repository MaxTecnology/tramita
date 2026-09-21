import { z } from 'zod'

export const addDocumentItemSchema = z.object({
  name: z.string().trim().min(1, 'Nome do documento obrigatório'),
})

export const reviewDocumentRequirementSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rejectionReason: z.string().trim().min(1).optional(),
})

export type AddDocumentItemBody = z.infer<typeof addDocumentItemSchema>
export type ReviewDocumentRequirementBody = z.infer<typeof reviewDocumentRequirementSchema>
