import { z } from 'zod'

export const productivityQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  departmentId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  boardType: z.enum(['OS', 'RECURRING_SYSTEM']).optional(),
})
