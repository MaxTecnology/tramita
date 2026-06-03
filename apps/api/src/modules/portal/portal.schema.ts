import { z } from 'zod'

export const updateProfileSchema = z.object({
  password: z.string().min(6).optional(),
  whatsapp: z.string().optional(),
})

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>
