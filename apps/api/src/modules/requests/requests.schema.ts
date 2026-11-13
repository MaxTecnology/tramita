import { z } from 'zod'

export const createRequestSchema = z.object({
  clientId: z.string().cuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  departmentId: z.string({ required_error: 'Selecione o departamento' }).cuid('Selecione o departamento'),
  osTemplateId: z.string().cuid().optional(),
})

export const approveRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EXISTING_BOARD'),
    boardId: z.string().cuid(),
    columnId: z.string().cuid(),
  }),
  z.object({
    mode: z.literal('NEW_BOARD'),
  }),
])

export const rejectRequestSchema = z.object({
  reason: z.string().optional(),
})

export const needsInfoRequestSchema = z.object({
  comment: z.string().trim().min(1, 'Comentário obrigatório').max(4000, 'Comentário excede o limite de 4000 caracteres'),
})

export const cancelApprovedRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Motivo obrigatório').max(4000, 'Motivo excede o limite de 4000 caracteres'),
})

export const listRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'NEEDS_INFO']).optional(),
  // Minhas · Meu departamento · Todas (permission is still the staff scope)
  scope: z.enum(['mine', 'department', 'all']).optional(),
})

export type CreateRequestBody = z.infer<typeof createRequestSchema>
export type ApproveRequestBody = z.infer<typeof approveRequestSchema>
export type RejectRequestBody = z.infer<typeof rejectRequestSchema>
export type NeedsInfoRequestBody = z.infer<typeof needsInfoRequestSchema>
export type CancelApprovedRequestBody = z.infer<typeof cancelApprovedRequestSchema>
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>
