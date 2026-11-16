import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { nationalHolidays, nationalHolidaysWithNames, dayKey, type HolidaySet } from '@/lib/business-days'
import type { CreateHolidayBody } from './holidays.schema'

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function listHolidays(organizationId: string, year: number) {
  const custom = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } },
    orderBy: { date: 'asc' },
  })
  return {
    national: nationalHolidaysWithNames(year),
    custom: custom.map((h) => ({ id: h.id, date: dayKey(h.date), name: h.name })),
  }
}

export async function createHoliday(organizationId: string, data: CreateHolidayBody) {
  try {
    const h = await prisma.holiday.create({ data: { organizationId, date: toDate(data.date), name: data.name } })
    return { id: h.id, date: dayKey(h.date), name: h.name }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Já existe feriado nesta data')
    }
    throw err
  }
}

export async function deleteHoliday(id: string, organizationId: string) {
  const { count } = await prisma.holiday.deleteMany({ where: { id, organizationId } })
  if (count === 0) throw new AppError(404, 'Feriado não encontrado')
  return { id }
}

// National + office holidays of the given years, as 'YYYY-MM-DD' keys (lib/business-days)
export async function loadHolidaySet(organizationId: string, years: number[]): Promise<HolidaySet> {
  const sorted = [...new Set(years)].sort()
  const custom = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: toDate(`${sorted[0]}-01-01`), lte: toDate(`${sorted[sorted.length - 1]}-12-31`) } },
    select: { date: true },
  })
  return new Set([...sorted.flatMap((y) => nationalHolidays(y)), ...custom.map((h) => dayKey(h.date))])
}
