import { z } from 'zod'

export const transferSchema = z.object({
  toUserId: z.string({ required_error: 'Escolha o colaborador de destino' }).cuid('Escolha o colaborador de destino'),
  clientIds: z.array(z.string().cuid()).min(1, 'Selecione ao menos um cliente'),
  departmentId: z.string().cuid().optional(),
  includeBoards: z.boolean().default(true),
  includeTasks: z.boolean().default(true),
})

export const portfolioQuerySchema = z.object({
  departmentId: z.string().cuid().optional(),
})

export type TransferBody = z.infer<typeof transferSchema>
