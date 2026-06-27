import { z } from 'zod'

export const createRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})

export const approveRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EXISTING_BOARD'),
    boardId: z.string().cuid(),
    columnId: z.string().cuid(),
  }),
  z.object({
    mode: z.literal('NEW_BOARD'),
  }),
])

export const rejectRequestSchema = z.object({
  reason: z.string().optional(),
})

export const listRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
})

export type CreateRequestBody = z.infer<typeof createRequestSchema>
export type ApproveRequestBody = z.infer<typeof approveRequestSchema>
export type RejectRequestBody = z.infer<typeof rejectRequestSchema>
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>
