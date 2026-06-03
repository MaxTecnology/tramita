import { z } from 'zod'

export const attachmentParamsSchema = z.object({
  id: z.string().cuid(),
})

export const deleteAttachmentParamsSchema = z.object({
  id: z.string().cuid(),
  attachmentId: z.string().cuid(),
})
