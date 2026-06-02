import { z } from 'zod'

export const createClientSchema = z.object({
  name: z.string().min(2),
  cnpj: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8),
  whatsapp: z.string().optional(),
})

export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  cnpj: z.string().optional(),
  email: z.string().email().optional(),
  whatsapp: z.string().optional(),
})

export type CreateClientBody = z.infer<typeof createClientSchema>
export type UpdateClientBody = z.infer<typeof updateClientSchema>
