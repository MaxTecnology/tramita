import { z } from 'zod'
import { ufSchema } from '@/lib/uf'

export const documentRequestItemSchema = z.object({
  name: z.string().trim().min(1, 'Nome do documento obrigatório'),
})

// Delivery = document the office sends to the client; a payment guide (DAS, FGTS) is tracked as
// paid/unpaid in the client portal, an extract/declaration is not.
export const documentDeliveryItemSchema = z.object({
  name: z.string().trim().min(1, 'Nome do documento obrigatório'),
  requiresPayment: z.boolean().default(false),
  // Robot: the obligation the document reader recognizes for this document (DAS, FGTS...)
  obligationTypeId: z.string().cuid().nullable().optional(),
})

// Due date of the template in one place: a state (scope STATE) or a city (scope CITY). The shape is
// checked against the template's scope in the service (on update the scope may be the stored one).
export const dueRuleSchema = z.object({
  uf: ufSchema.optional(),
  ibgeCityCode: z.number().int().min(1).max(9999999, 'Cidade não encontrada').optional(),
  dueDayOfPeriod: z.number().int().min(1).max(31),
  dueBusinessDayRoll: z.enum(['NONE', 'FORWARD', 'BACKWARD']).default('NONE'),
})

export type DueRuleInput = z.infer<typeof dueRuleSchema>

export const createTemplateSchema = z.object({
  departmentId: z.string().cuid(),
  title: z.string().trim().min(1, 'Título obrigatório'),
  description: z.string().optional(),
  periodicity: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),

  dueDayOfPeriod: z.number().int().min(1).max(31),
  dueBusinessDayRoll: z.enum(['NONE', 'FORWARD', 'BACKWARD']).default('NONE'),

  // QUARTERLY: 1-3, define o grupo de meses (1="Jan,Abr,Jul,Out", 2="Fev,Mai,Ago,Nov",
  // 3="Mar,Jun,Set,Dez"). ANNUAL: 1-12, mês literal do vencimento. Ignorado por MONTHLY/WEEKLY.
  dueMonthAnchor: z.number().int().min(1).max(12).default(1),

  competenceMonthOffset: z.number().int().min(0).default(1),

  targetOffsetDays: z.number().int().default(0),
  targetBusinessDayRoll: z.enum(['NONE', 'FORWARD', 'BACKWARD']).default('NONE'),

  generationMonthOffset: z.number().int().min(0).default(1),
  generationDayOfPeriod: z.number().int().min(1).max(31),

  autoCompleteOnAllActivitiesDone: z.boolean().default(false),
  notifyViaWhatsapp: z.boolean().default(true),
  notifyViaEmail: z.boolean().default(false),
  visibleToClient: z.boolean().default(true),
  isActive: z.boolean().default(true),

  documentRequests: z.array(documentRequestItemSchema).default([]),
  documentDeliveries: z.array(documentDeliveryItemSchema).default([]),

  dueScope: z.enum(['FEDERAL', 'STATE', 'CITY']).default('FEDERAL'),
  onlyListedLocations: z.boolean().default(false),
  // Sent → replaces the template's rules
  dueRules: z.array(dueRuleSchema).max(5600).default([]),
})

export const updateTemplateSchema = createTemplateSchema.partial().extend({
  // departmentId/periodicity ficam editáveis também — não há razão pra travar depois de criado
})

export type CreateTemplateBody = z.infer<typeof createTemplateSchema>
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>

export const createAssignmentSchema = z.object({
  clientId: z.string().cuid(),
})

export const updateAssignmentSchema = z.object({
  isActive: z.boolean().optional(),
})

export type CreateAssignmentBody = z.infer<typeof createAssignmentSchema>
export type UpdateAssignmentBody = z.infer<typeof updateAssignmentSchema>

export const bulkGenerateSchema = z.object({
  dueMonth: z.string().datetime(),
  assignmentIds: z.array(z.string().cuid()).min(1, 'Selecione ao menos um cliente'),
})

export type BulkGenerateBody = z.infer<typeof bulkGenerateSchema>

export const bulkGenerateAllSchema = z.object({
  dueMonth: z.string().datetime(),
})

export type BulkGenerateAllBody = z.infer<typeof bulkGenerateAllSchema>

export const bulkRegenerateSchema = z.object({
  dueMonth: z.string().datetime(),
  assignmentIds: z.array(z.string().cuid()).min(1, 'Selecione ao menos um cliente'),
})

export type BulkRegenerateBody = z.infer<typeof bulkRegenerateSchema>
