// apps/api/src/modules/protocols/protocols.schema.ts
import { z } from 'zod'

export const createProtocolSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().datetime().optional(),
  attachmentId: z.string().cuid().optional(),
  content: z.string().min(1).optional(),
  requiresPayment: z.boolean().default(false),
  amount: z.string().trim().optional(),
}).refine((data) => !!data.attachmentId || !!data.content, {
  message: 'Informe um anexo existente ou um texto pro protocolo',
  path: ['content'],
}).refine((data) => !data.requiresPayment || !!data.amount, {
  message: 'Informe o valor da guia',
  path: ['amount'],
})

export const updateProtocolPaymentSchema = z.object({
  amount: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
})

export const cancelProtocolSchema = z.object({
  reason: z.string({ required_error: 'Informe o motivo do cancelamento' }).trim().min(3, 'Informe o motivo do cancelamento'),
})

export const listProtocolsQuerySchema = z.object({
  status: z.enum(['SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED']).optional(),
  clientId: z.string().cuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export type CreateProtocolBody = z.infer<typeof createProtocolSchema>
export type ListProtocolsQuery = z.infer<typeof listProtocolsQuerySchema>

export const unpaidGuidesQuerySchema = z.object({
  clientId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida (use AAAA-MM)').optional(),
  situation: z.enum(['overdue', 'upcoming', 'paid']).optional(),
})
