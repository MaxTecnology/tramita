import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createBoardSchema, updateBoardSchema } from './boards.schema'
import { listBoards, getBoardById, createBoard, updateBoard } from './boards.service'

export async function boardsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { organizationId, role, sub } = request.user
    const clientId = role === 'CLIENT' ? sub : undefined
    return reply.send(await listBoards(organizationId!, clientId))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getBoardById(id, request.user.organizationId!))
  })

  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const result = createBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createBoard(request.user.organizationId!, result.data))
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateBoard(id, request.user.organizationId!, result.data))
  })
}
