import { z } from 'zod'

const statusEffectEnum = z.enum(['NONE', 'OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE'])

const columnSchema = z.object({
  title: z.string().trim().min(1),
  statusEffect: statusEffectEnum.default('NONE'),
  notifyClient: z.boolean().default(false),
  documents: z.array(z.object({ name: z.string().trim().min(1) })).default([]),
})

export const createOSTemplateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  columns: z.array(columnSchema).min(1, 'Adicione pelo menos uma coluna'),
})

export const updateOSTemplateSchema = createOSTemplateSchema.partial().extend({
  description: z.string().nullable().optional(),
  columns: z.array(columnSchema).min(1).optional(),
})

export type CreateOSTemplateBody = z.infer<typeof createOSTemplateSchema>
export type UpdateOSTemplateBody = z.infer<typeof updateOSTemplateSchema>
