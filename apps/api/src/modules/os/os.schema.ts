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
