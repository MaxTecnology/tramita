import { z } from 'zod'

export const updateOrgSchema = z.object({
  planId: z.string().optional(),
  subscriptionStatus: z
    .enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'GRACE_PERIOD', 'TRIAL'])
    .optional(),
})

export const registerOrgSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  cnpj: z.string().optional(),
  email: z.string().email('E-mail inválido'),
  phone: z.string().optional(),
  adminName: z.string().min(2, 'Nome do admin obrigatório'),
  adminPassword: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
  planId: z.string().min(1, 'Plano obrigatório'),
})

export const changePlanSchema = z.object({
  planId: z.string().min(1, 'planId obrigatório'),
})

export type UpdateOrgBody = z.infer<typeof updateOrgSchema>
export type RegisterOrgBody = z.infer<typeof registerOrgSchema>
export type ChangePlanBody = z.infer<typeof changePlanSchema>
