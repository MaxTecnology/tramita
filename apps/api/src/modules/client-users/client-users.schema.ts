import { z } from 'zod'

const accessSchema = z.object({
  clientId: z.string().cuid(),
  departmentId: z.string().cuid(),
})

export const createClientUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  isActive: z.boolean().default(true),
  accesses: z.array(accessSchema).min(1, 'Selecione pelo menos um cliente e departamento'),
})

export const updateClientUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  accesses: z.array(accessSchema).min(1, 'Selecione pelo menos um cliente e departamento').optional(),
})

export type CreateClientUserBody = z.infer<typeof createClientUserSchema>
export type UpdateClientUserBody = z.infer<typeof updateClientUserSchema>
