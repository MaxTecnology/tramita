import { z } from 'zod'

export const createColumnSchema = z.object({
  title: z.string().min(1),
  color: z.string().optional(),
  position: z.number().int().min(0),
  isFinal: z.boolean().default(false),
})

export const updateColumnSchema = z.object({
  title: z.string().min(1).optional(),
  color: z.string().optional(),
  position: z.number().int().min(0).optional(),
  isFinal: z.boolean().optional(),
})

export const reorderColumnsSchema = z.array(
  z.object({
    id: z.string().cuid(),
    position: z.number().int().min(0),
  }),
)

export type CreateColumnBody = z.infer<typeof createColumnSchema>
export type UpdateColumnBody = z.infer<typeof updateColumnSchema>
export type ReorderColumnsBody = z.infer<typeof reorderColumnsSchema>
