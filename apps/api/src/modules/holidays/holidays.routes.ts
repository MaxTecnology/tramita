import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createHolidaySchema, listHolidaysQuerySchema, holidayParamsSchema, holidayDaysQuerySchema } from './holidays.schema'
import { listHolidays, createHoliday, deleteHoliday, loadHolidaySet } from './holidays.service'

export async function holidaysRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  // Everyone in the office reads the calendar (deadlines show it); only the admin edits it
  const adminOnly = [requireRole('ORG_ADMIN'), checkSubscription]

  app.get('/', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request) => {
    const q = listHolidaysQuerySchema.safeParse(request.query)
    if (!q.success) throw new AppError(400, q.error.errors[0].message)
    return listHolidays(request.user.organizationId!, q.data.year ?? new Date().getUTCFullYear())
  })

  // Every holiday day of a range of years — the web previews dates with the same calendar
  app.get('/days', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request) => {
    const q = holidayDaysQuerySchema.safeParse(request.query)
    if (!q.success) throw new AppError(400, q.error.errors[0].message)
    const years = Array.from({ length: q.data.to - q.data.from + 1 }, (_, i) => q.data.from + i)
    return [...(await loadHolidaySet(request.user.organizationId!, years))].sort()
  })

  app.post('/', { preHandler: adminOnly }, async (request, reply) => {
    const body = createHolidaySchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await createHoliday(request.user.organizationId!, body.data))
  })

  app.delete('/:id', { preHandler: adminOnly }, async (request) => {
    const p = holidayParamsSchema.safeParse(request.params)
    if (!p.success) throw new AppError(400, p.error.errors[0].message)
    return deleteHoliday(p.data.id, request.user.organizationId!)
  })
}
