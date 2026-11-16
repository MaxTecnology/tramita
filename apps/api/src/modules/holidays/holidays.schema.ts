import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')

export const createHolidaySchema = z.object({
  date: isoDate,
  name: z.string().trim().min(2, 'Informe o nome do feriado').max(80),
})
export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})
export const holidayParamsSchema = z.object({ id: z.string().min(1) })

export type CreateHolidayBody = z.infer<typeof createHolidaySchema>

// At most 5 years at once (previews of annual templates)
export const holidayDaysQuerySchema = z.object({
  from: z.coerce.number().int().min(2000).max(2100),
  to: z.coerce.number().int().min(2000).max(2100),
}).refine((q) => q.to >= q.from && q.to - q.from <= 4, { message: 'Intervalo de anos inválido (máximo 5 anos)' })
