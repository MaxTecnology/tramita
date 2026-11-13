import { z } from 'zod'

export const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']),
  phone: z.string().optional(),
  // Required for managers and members (checked with a pt-BR message below the schema)
  departmentIds: z.array(z.string().cuid()).optional(),
  seesDepartmentWork: z.boolean().optional(),
})

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']).optional(),
  phone: z.string().nullable().optional(),
  departmentIds: z.array(z.string().cuid()).min(1, 'Selecione pelo menos um departamento').optional(),
  seesDepartmentWork: z.boolean().optional(),
})

export const userOptionsQuerySchema = z.object({
  departmentId: z.string().cuid('Departamento inválido').optional(),
})

export const updateMyProfileSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').optional(),
  phone: z.string().nullable().optional(),
})

export type CreateUserBody = z.infer<typeof createUserSchema>
export type UpdateUserBody = z.infer<typeof updateUserSchema>
export type UpdateMyProfileBody = z.infer<typeof updateMyProfileSchema>
