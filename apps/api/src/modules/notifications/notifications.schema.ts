// apps/api/src/modules/notifications/notifications.schema.ts
import { z } from 'zod'
import { NotificationEvent, MessageChannel } from '@prisma/client'

export const updateConfigSchema = z.object({
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  taskCreated: z.boolean().optional(),
  taskMoved: z.boolean().optional(),
  taskCompleted: z.boolean().optional(),
  commentAdded: z.boolean().optional(),
  dueDateAlert: z.boolean().optional(),
  maximizebotToken: z.string().optional(),
  saveOnTicket: z.boolean().optional(),
  startChatbot: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  emailFrom: z.string().optional(),
})

export const upsertTemplateSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
})

export const previewSchema = z.object({
  event: z.nativeEnum(NotificationEvent),
  channel: z.nativeEnum(MessageChannel),
  body: z.string().optional(),
})

export const testWhatsappSchema = z.object({ number: z.string().min(10) })
export const testEmailSchema = z.object({ to: z.string().email() })

export const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  channel: z.nativeEnum(MessageChannel).optional(),
})

export const eventParamSchema = z.nativeEnum(NotificationEvent)
export const channelParamSchema = z.nativeEnum(MessageChannel)

export type UpdateConfigBody = z.infer<typeof updateConfigSchema>
export type UpsertTemplateBody = z.infer<typeof upsertTemplateSchema>
