import { z } from 'zod'

// Sizes a person's data never needs to pass; the e-mail is kept trimmed and in lower case, so the
// same address typed differently is one person (and signs in either way)
const name = z.string().trim().min(2, 'Nome deve ter no mínimo 2 caracteres').max(120, 'Nome muito longo (máximo 120 caracteres)')
const email = z.string().trim().toLowerCase().email('E-mail inválido').max(254, 'E-mail muito longo')
const phone = z.string().trim().max(30, 'Telefone muito longo')

export const createUserSchema = z.object({
  name,
  email,
  // No password: the server generates a temporary one and shows it once (like the reset)
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']),
  phone: phone.optional(),
  // Required for managers and members (checked with a pt-BR message below the schema)
  departmentIds: z.array(z.string().cuid()).optional(),
  seesDepartmentWork: z.boolean().optional(),
})

export const updateUserSchema = z.object({
  name: name.optional(),
  email: email.optional(),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']).optional(),
  phone: phone.nullable().optional(),
  departmentIds: z.array(z.string().cuid()).min(1, 'Selecione pelo menos um departamento').optional(),
  seesDepartmentWork: z.boolean().optional(),
})

export const listUsersQuerySchema = z.object({
  status: z.enum(['active', 'inactive'], { errorMap: () => ({ message: 'Situação inválida' }) }).default('active'),
})

export const userOptionsQuerySchema = z.object({
  departmentId: z.string().cuid('Departamento inválido').optional(),
})

export const updateMyProfileSchema = z.object({
  name: name.optional(),
  phone: phone.nullable().optional(),
})

export type CreateUserBody = z.infer<typeof createUserSchema>
export type UpdateUserBody = z.infer<typeof updateUserSchema>
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>
export type UpdateMyProfileBody = z.infer<typeof updateMyProfileSchema>
