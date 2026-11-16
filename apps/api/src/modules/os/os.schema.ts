import { z } from 'zod'

const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida (use AAAA-MM)')

export const openOSSchema = z.object({
  osModelId: z.string().cuid(),
  clientId: z.string().cuid(),
  competence: competence.optional(),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
})

export const addOSToProcessSchema = z.object({
  osModelId: z.string().cuid(),
  columnId: z.string().cuid(),
  competence: competence.optional(),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  dependsOnTaskIds: z.array(z.string().cuid()).max(50).default([]),
})

export type OpenOSBody = z.infer<typeof openOSSchema>
export type AddOSToProcessBody = z.infer<typeof addOSToProcessSchema>

export function competenceToDate(value: string): Date {
  const [y, m] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
}

export const releaseEarlySchema = z.object({
  reason: z.string().trim().min(3, 'Explique por que liberar antes').max(500),
})

export const listOSQuerySchema = z.object({
  clientId: z.string().cuid().optional(),
  osModelId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  boardId: z.string().cuid().optional(),
  situation: z.enum(['ON_TIME', 'DUE_SOON', 'LATE', 'PAUSED', 'WAITING_DEPENDENCY', 'DONE', 'NONE']).optional(),
  search: z.string().trim().max(100).optional(),
})
export type ListOSQuery = z.infer<typeof listOSQuerySchema>

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')
export const osDashboardQuerySchema = z.object({ from: isoDay, to: isoDay })
