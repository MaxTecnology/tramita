import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { consumeStreamTicket, issueStreamTicket } from './stream-ticket'
import { prisma } from '@/lib/prisma'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import { assertMemberSeesTargets } from '@/middlewares/memberScope'
import { getClientAccessScope } from '@/modules/client-users/client-access'

export async function streamRoutes(app: FastifyInstance) {
  app.post('/stream/ticket', { preHandler: [verifyJWT] }, async (request, reply) => {
    return reply.send({ ticket: await issueStreamTicket(request.user) })
  })

  app.get('/boards/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { ticket } = request.query as { ticket?: string }

    // EventSource can't send headers: auth via a one-time ticket from POST /stream/ticket
    const user = await consumeStreamTicket(ticket)
    if (!user.organizationId) throw new AppError(403, 'Acesso negado') // MASTER has no processes

    // Verify board exists and belongs to the user's org
    const board = await prisma.board.findFirst({
      where: { id, organizationId: user.organizationId!, isActive: true, type: 'OS' },
    })
    if (!board) throw new AppError(404, 'Board não encontrado')
    await assertMemberSeesTargets(user, { boardIds: [id] })

    // CLIENT subscribers are additionally gated at the company level — a ClientUser must have
    // access to the board's client, or the board effectively doesn't exist to them. Department
    // filtering is intentionally not applied here: the events pushed on this stream are already
    // coarse (task id/title/column), matching the concern being board-level access, not
    // per-event department leakage.
    if (user.role === 'CLIENT') {
      const scope = await getClientAccessScope(user.sub)
      if (!scope.clientIds.includes(board.clientId)) throw new AppError(404, 'Board não encontrado')
    }

    attachSSESubscriber(request, reply, `board:${id}`)
  })
}
