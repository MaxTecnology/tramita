import { z } from 'zod'

export const loginBodySchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token obrigatório'),
})

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token obrigatório'),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual obrigatória'),
  newPassword: z.string().min(8, 'Nova senha deve ter no mínimo 8 caracteres'),
})

export type LoginBody = z.infer<typeof loginBodySchema>
export type RefreshBody = z.infer<typeof refreshBodySchema>
export type LogoutBody = z.infer<typeof logoutBodySchema>
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>
