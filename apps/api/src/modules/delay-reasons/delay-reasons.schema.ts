import { z } from 'zod'

export const createDelayReasonSchema = z.object({
  name: z.string().trim().min(2, 'Informe o motivo').max(80),
  requiresNote: z.boolean().default(false),
})
export const updateDelayReasonSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  requiresNote: z.boolean().optional(),
  isActive: z.boolean().optional(),
})
// Register (or resolve) the reason of an OS or process
export const setDelayReasonSchema = z.object({
  delayReasonId: z.string().cuid(),
  delayNote: z.string().trim().max(500).optional(),
})

export type CreateDelayReasonBody = z.infer<typeof createDelayReasonSchema>
export type UpdateDelayReasonBody = z.infer<typeof updateDelayReasonSchema>
