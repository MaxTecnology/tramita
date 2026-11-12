import { z } from 'zod'

const competenceSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida (use AAAA-MM)')
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')

export const portalProtocolsQuerySchema = z.object({
  clientId: z.string({ required_error: 'clientId é obrigatório' }).min(1, 'clientId é obrigatório'),
  status: z.enum(['SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED']).optional(),
  search: z.string().trim().optional(),
  competence: competenceSchema.optional(),
  departmentId: z.string().optional(),
  dueFrom: dateOnlySchema.optional(),
  dueTo: dateOnlySchema.optional(),
  paymentStatus: z.enum(['unpaid', 'paid']).optional(),
})

export const markPaidSchema = z.object({
  amount: z.string({ required_error: 'Informe o valor pago' }).trim().min(1, 'Informe o valor pago'),
})

export const portalClientQuerySchema = z.object({
  clientId: z.string({ required_error: 'clientId é obrigatório' }).min(1, 'clientId é obrigatório'),
})

export const documentRequestsQuerySchema = portalClientQuerySchema.extend({
  competence: competenceSchema,
})
