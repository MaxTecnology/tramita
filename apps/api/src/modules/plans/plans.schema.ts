import { z } from 'zod'

export const createPlanSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  maxClients: z.number().int().positive('Limite de clientes deve ser positivo'),
  priceMonthly: z.number().positive('Preço deve ser positivo'),
  features: z.record(z.boolean()).default({}),
})

export const updatePlanSchema = createPlanSchema.partial()

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
