import { z } from 'zod'

// A request is free (department + description) or for a service of the catalog: a standalone OS
// model (with the competence when it asks for one) or a requestable process; the department then
// comes from the model
export const createRequestSchema = z.object({
  clientId: z.string().cuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  departmentId: z.string().cuid('Selecione o departamento').optional(),
  processTemplateId: z.string().cuid().optional(),
  osModelId: z.string().cuid().optional(),
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida (use AAAA-MM)').optional(),
}).refine((b) => !(b.processTemplateId && b.osModelId), { message: 'Escolha um serviço só' })
  .refine((b) => b.departmentId || b.processTemplateId || b.osModelId, { message: 'Selecione o departamento' })

export const approveRequestSchema = z.discriminatedUnion('mode', [
  // Into an existing process: a free task, or an OS of a model (optionally waiting for other OS)
  z.object({
    mode: z.literal('EXISTING_BOARD'),
    boardId: z.string().cuid(),
    columnId: z.string().cuid(),
    osModelId: z.string().cuid().optional(),
    dependsOnTaskIds: z.array(z.string().cuid()).max(50).optional(),
  }),
  // A new process (with the requested template, its OS are created) or a plain board
  z.object({
    mode: z.literal('NEW_BOARD'),
  }),
  // A standalone OS (the model requested, or the one the office picks)
  z.object({
    mode: z.literal('OS'),
    osModelId: z.string().cuid().optional(),
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
