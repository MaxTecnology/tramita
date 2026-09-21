import { z } from 'zod'

const documentItemSchema = z.object({
  name: z.string().trim().min(1, 'Nome do documento obrigatório'),
})

export const createTemplateSchema = z.object({
  departmentId: z.string().cuid(),
  title: z.string().trim().min(1, 'Título obrigatório'),
  description: z.string().optional(),
  periodicity: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']),

  dueMonthOffset: z.number().int().min(0).default(0),
  dueDayOfPeriod: z.number().int().min(1).max(31),
  dueRollToBusinessDay: z.boolean().default(false),

  targetOffsetDays: z.number().int().default(0),
  targetRollToBusinessDay: z.boolean().default(false),

  generationMonthOffset: z.number().int().min(0).default(1),
  generationDayOfPeriod: z.number().int().min(1).max(31),

  autoCompleteOnAllActivitiesDone: z.boolean().default(false),
  notifyViaWhatsapp: z.boolean().default(true),
  notifyViaEmail: z.boolean().default(false),
  visibleToClient: z.boolean().default(true),
  isActive: z.boolean().default(true),

  documentRequests: z.array(documentItemSchema).default([]),
  documentDeliveries: z.array(documentItemSchema).default([]),
})

export const updateTemplateSchema = createTemplateSchema.partial().extend({
  // departmentId/periodicity ficam editáveis também — não há razão pra travar depois de criado
})

export type CreateTemplateBody = z.infer<typeof createTemplateSchema>
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>

export const createAssignmentSchema = z.object({
  clientId: z.string().cuid(),
  boardId: z.string().cuid(),
  columnId: z.string().cuid(),
})

export const updateAssignmentSchema = z.object({
  boardId: z.string().cuid().optional(),
  columnId: z.string().cuid().optional(),
  isActive: z.boolean().optional(),
})

export type CreateAssignmentBody = z.infer<typeof createAssignmentSchema>
export type UpdateAssignmentBody = z.infer<typeof updateAssignmentSchema>
