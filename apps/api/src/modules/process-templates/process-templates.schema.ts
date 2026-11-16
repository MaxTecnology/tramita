import { z } from 'zod'

const statusEffectEnum = z.enum(['NONE', 'OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE'])

const columnSchema = z.object({
  title: z.string().trim().min(1),
  statusEffect: statusEffectEnum.default('NONE'),
  notifyClient: z.boolean().default(false),
  documents: z.array(z.object({ name: z.string().trim().min(1) })).default([]),
})

// OS the process creates when opened: the model, the column (index) where it is born and the other
// items (indexes in this same list) it waits for
const itemSchema = z.object({
  osModelId: z.string().cuid(),
  columnIndex: z.number().int().min(0),
  dependsOn: z.array(z.number().int().min(0)).default([]),
})

export const createProcessTemplateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  departmentId: z.string().min(1).nullable().optional(),
  deadlineBusinessDays: z.number().int().min(1).max(365).nullable().optional(),
  clientCanRequest: z.boolean().optional(),
  columns: z.array(columnSchema).min(1, 'Adicione pelo menos uma coluna'),
  items: z.array(itemSchema).max(100).optional(),
})

export const updateProcessTemplateSchema = createProcessTemplateSchema.partial().extend({
  description: z.string().nullable().optional(),
  columns: z.array(columnSchema).min(1).optional(),
})

export type CreateProcessTemplateBody = z.infer<typeof createProcessTemplateSchema>
export type UpdateProcessTemplateBody = z.infer<typeof updateProcessTemplateSchema>
