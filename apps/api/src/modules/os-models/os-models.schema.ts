import { z } from 'zod'
import { documentRequestItemSchema, documentDeliveryItemSchema } from '@/modules/recurring-templates/recurring-templates.schema'

export const createOSModelSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  departmentId: z.string().cuid(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  visibleToClient: z.boolean().default(true),
  requiresCompetence: z.boolean().default(false),
  deadlineBusinessDays: z.number().int().min(1).max(365).nullable().optional(),
  autoCompleteOnAllDelivered: z.boolean().default(false),
  usableStandalone: z.boolean().default(true),
  usableInProcess: z.boolean().default(false),
  isActive: z.boolean().default(true),
  documentRequests: z.array(documentRequestItemSchema).default([]),
  documentDeliveries: z.array(documentDeliveryItemSchema).default([]),
})

export const updateOSModelSchema = createOSModelSchema.partial()

export const listOSModelsQuerySchema = z.object({
  usage: z.enum(['standalone', 'process']).optional(),
})

export type CreateOSModelBody = z.infer<typeof createOSModelSchema>
export type UpdateOSModelBody = z.infer<typeof updateOSModelSchema>
