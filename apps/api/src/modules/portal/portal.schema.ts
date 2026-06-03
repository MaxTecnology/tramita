import { z } from 'zod'

export const updateProfileSchema = z.object({
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres').optional(),
  whatsapp: z.string().regex(/^\d{10,15}$/, 'WhatsApp deve conter entre 10 e 15 dígitos').optional(),
})

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>
