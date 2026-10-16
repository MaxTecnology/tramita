import { z } from 'zod'

export const trocarTarefaBodySchema = z.object({
  taskId: z.string().cuid(),
})
