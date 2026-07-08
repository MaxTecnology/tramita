import { z } from 'zod'

export const createClientSchema = z.object({
  name: z.string().min(2),
  clientType: z.enum(['PF', 'PJ']).default('PJ'),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
})

export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  clientType: z.enum(['PF', 'PJ']).optional(),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  email: z.string().email().optional(),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
})

export type CreateClientBody = z.infer<typeof createClientSchema>
export type UpdateClientBody = z.infer<typeof updateClientSchema>

export const listClientsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
})

export const setAssignmentsSchema = z.object({
  userIds: z.array(z.string()).default([]),
})

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>
export type SetAssignmentsBody = z.infer<typeof setAssignmentsSchema>
