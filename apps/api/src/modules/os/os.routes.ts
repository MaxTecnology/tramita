import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { openOSSchema, addOSToProcessSchema, releaseEarlySchema, listOSQuerySchema } from './os.schema'
import { listOS } from './os-list.service'
import { getStageTimes, getOSDashboard } from './os-metrics.service'
import { osDashboardQuerySchema } from './os.schema'
import { openOS, addOSToProcess } from './os.service'
import { releaseEarly } from './os-deadline.service'
import { prisma } from '@/lib/prisma'

export async function osRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  const staffWrite = [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription]

  app.get('/boards/:id/stage-times', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request) => {
    const { id } = request.params as { id: string }
    return getStageTimes(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role })
  })

  app.get('/dashboard/os', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request) => {
    const q = osDashboardQuerySchema.safeParse(request.query)
    if (!q.success) throw new AppError(400, q.error.errors[0].message)
    return getOSDashboard(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, {
      from: new Date(`${q.data.from}T00:00:00.000Z`), to: new Date(`${q.data.to}T23:59:59.999Z`),
    })
  })

  app.get('/os', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request) => {
    const q = listOSQuerySchema.safeParse(request.query)
    if (!q.success) throw new AppError(400, q.error.errors[0].message)
    return listOS(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, q.data)
  })

  // Standalone OS (client's services board); scope: clients the user reaches, like opening a process
  app.post('/os', { preHandler: staffWrite }, async (request, reply) => {
    const body = openOSSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await openOS(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, body.data))
  })

  app.post('/boards/:id/os', { preHandler: staffWrite }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = addOSToProcessSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await addOSToProcess(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, id, body.data))
  })

  // Manager/admin releases an OS before the one it waits for finishes (reason goes to the history)
  app.post('/tasks/:id/release', { preHandler: staffWrite }, async (request) => {
    const { id } = request.params as { id: string }
    const body = releaseEarlySchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    const user = await prisma.user.findUnique({ where: { id: request.user.sub }, select: { name: true } })
    await releaseEarly(id, request.user.organizationId!, { id: request.user.sub, name: user?.name ?? 'Escritório', role: request.user.role }, body.data.reason)
    return { id }
  })
}
