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

// Review queue filter: "Minhas" = documents suggested for my tasks
export const filaQuerySchema = z.object({
  scope: z.enum(['mine', 'department', 'all']).optional(),
})

// Confirm several suggestions at once (the "sem pendência" ones in the queue)
export const confirmarLoteSchema = z.object({
  ids: z.array(z.string().cuid()).min(1, 'Selecione ao menos um documento').max(50, 'Até 50 documentos por vez'),
})
