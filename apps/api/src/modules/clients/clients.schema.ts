import { z } from 'zod'

const addressFields = {
  cep: z.string().optional(),
  estado: z.string().optional(),
  cidade: z.string().optional(),
  bairro: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
}

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
  ...addressFields,
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
  ...addressFields,
})

export type CreateClientBody = z.infer<typeof createClientSchema>
export type UpdateClientBody = z.infer<typeof updateClientSchema>

export const listClientsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
})

export const setAssignmentSchema = z.object({
  departmentId: z.string().cuid(),
  userId: z.string().cuid().nullable(),
})

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>
export type SetAssignmentBody = z.infer<typeof setAssignmentSchema>
