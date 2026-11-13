import type { FastifyInstance, FastifyRequest } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { AppError } from '@/errors/AppError'
import { listNotificationsQuerySchema, readByTaskSchema } from './inbox.schema'
import { listNotifications, countUnread, setRead, readAll, readByTask, type Recipient } from './inbox.service'

// The inbox of whoever is logged in: client users by their ClientUser id, office staff by their user id
function recipientOf(request: FastifyRequest): Recipient {
  const { role, sub } = request.user
  if (role === 'CLIENT') return { kind: 'clientUser', id: sub }
  if (role === 'ORG_ADMIN' || role === 'ORG_MANAGER' || role === 'ORG_MEMBER') return { kind: 'user', id: sub }
  throw new AppError(403, 'Acesso negado')
}

export async function inboxRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', async (request, reply) => {
    const result = listNotificationsQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await listNotifications(recipientOf(request), result.data))
  })

  app.get('/unread-count', async (request, reply) => {
    return reply.send({ count: await countUnread(recipientOf(request)) })
  })

  app.post('/read-all', async (request, reply) => {
    return reply.send({ count: await readAll(recipientOf(request)) })
  })

  app.post('/read-by-task', async (request, reply) => {
    const result = readByTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send({ count: await readByTask(recipientOf(request), result.data.taskId) })
  })

  app.post('/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string }
    await setRead(recipientOf(request), id, true)
    return reply.send({ ok: true })
  })

  app.post('/:id/unread', async (request, reply) => {
    const { id } = request.params as { id: string }
    await setRead(recipientOf(request), id, false)
    return reply.send({ ok: true })
  })
}
