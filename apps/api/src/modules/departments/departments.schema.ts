import { z } from 'zod'

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
})

export const updateDepartmentSchema = createDepartmentSchema.partial()

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>
