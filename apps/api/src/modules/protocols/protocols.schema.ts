// apps/api/src/modules/protocols/protocols.schema.ts
import { z } from 'zod'

export const createProtocolSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().datetime().optional(),
  attachmentId: z.string().cuid().optional(),
  content: z.string().min(1).optional(),
}).refine((data) => !!data.attachmentId || !!data.content, {
  message: 'Informe um anexo existente ou um texto pro protocolo',
  path: ['content'],
})

export const listProtocolsQuerySchema = z.object({
  status: z.enum(['SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED']).optional(),
  clientId: z.string().cuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export type CreateProtocolBody = z.infer<typeof createProtocolSchema>
export type ListProtocolsQuery = z.infer<typeof listProtocolsQuerySchema>
