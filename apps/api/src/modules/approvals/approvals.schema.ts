import { z } from 'zod'

export const CLOSE_REASONS = ['APPROVED_OUTSIDE', 'NO_RESPONSE'] as const

export const requestApprovalSchema = z.object({
  title: z.string().trim().min(1, 'Informe o título').max(200, 'Título muito longo'),
  message: z.string().trim().max(2000, 'Mensagem muito longa').optional(),
})

export const closeApprovalSchema = z.object({
  reason: z.enum(CLOSE_REASONS, { errorMap: () => ({ message: 'Escolha o motivo' }) }),
  note: z.string().trim().min(1, 'A observação é obrigatória').max(2000, 'Observação muito longa'),
})

export const approveSchema = z.object({
  note: z.string().trim().max(2000, 'Observação muito longa').optional(),
})

export const requestChangesSchema = z.object({
  note: z.string().trim().min(1, 'Diga o que precisa ser ajustado').max(2000, 'Observação muito longa'),
})

export type RequestApprovalBody = z.infer<typeof requestApprovalSchema>
export type CloseApprovalBody = z.infer<typeof closeApprovalSchema>
