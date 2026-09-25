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

const clientUserLinkSchema = z.union([
  z.object({
    existingId: z.string().cuid(),
    departmentIds: z.array(z.string().cuid()).min(1),
  }),
  z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    departmentIds: z.array(z.string().cuid()).min(1),
  }),
])

export const createClientSchema = z.object({
  name: z.string().min(2),
  codigo: z.string().optional(),
  clientType: z.enum(['PF', 'PJ']).default('PJ'),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  ...addressFields,
  clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário'),
})

export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  codigo: z.string().nullable().optional(),
  clientType: z.enum(['PF', 'PJ']).optional(),
  cnpj: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  cep: z.string().nullable().optional(),
  estado: z.string().nullable().optional(),
  cidade: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  logradouro: z.string().nullable().optional(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
  clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário').optional(),
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
