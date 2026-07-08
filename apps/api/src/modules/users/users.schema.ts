import { z } from 'zod'

export const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']),
  phone: z.string().optional(),
})

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']).optional(),
  phone: z.string().optional(),
})

export const updateMyProfileSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').optional(),
  phone: z.string().optional(),
})

export type CreateUserBody = z.infer<typeof createUserSchema>
export type UpdateUserBody = z.infer<typeof updateUserSchema>
export type UpdateMyProfileBody = z.infer<typeof updateMyProfileSchema>
