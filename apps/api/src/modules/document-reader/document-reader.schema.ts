import { z } from 'zod'

// Optional on both actions: which pending delivery the document fills, and the guide amount/due
// date when the robot did not read them (or the reviewer corrects them).
export const anexarOpcoesSchema = z.object({
  deliverableId: z.string().cuid().optional(),
  amount: z.string().trim().optional(),
  paymentDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento inválida').optional(),
})

export const trocarTarefaBodySchema = anexarOpcoesSchema.extend({
  taskId: z.string().cuid(),
})
