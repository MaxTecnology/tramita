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

export const createOrgByMasterSchema = z
  .object({
    name: z.string().min(2, 'Nome obrigatório'),
    email: z.string().email('E-mail inválido'),
    phone: z.string().optional(),
    cnpj: z.string().optional(),
    planId: z.string().min(1, 'Plano obrigatório'),
    adminName: z.string().min(2, 'Nome do admin obrigatório'),
    createAsaasSubscription: z.boolean(),
  })
  .refine((data) => !data.createAsaasSubscription || !!data.cnpj, {
    message: 'CNPJ é obrigatório para criar assinatura na Asaas',
    path: ['cnpj'],
  })

export type UpdateOrgBody = z.infer<typeof updateOrgSchema>
export type RegisterOrgBody = z.infer<typeof registerOrgSchema>
export type ChangePlanBody = z.infer<typeof changePlanSchema>
export type CreateOrgByMasterBody = z.infer<typeof createOrgByMasterSchema>
