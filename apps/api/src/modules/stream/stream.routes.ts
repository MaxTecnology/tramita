import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { consumeStreamTicket, issueStreamTicket, streamRecheck } from './stream-ticket'
import { prisma } from '@/lib/prisma'
import { attachSSESubscriber, inboxChannel } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import { assertStaffSees } from '@/middlewares/staffScope'
import { loadStaffScope } from '@/modules/staff-scope/staff-scope'
import { getClientAccessScope } from '@/modules/client-users/client-access'

export async function streamRoutes(app: FastifyInstance) {
  app.post('/stream/ticket', { preHandler: [verifyJWT] }, async (request, reply) => {
    return reply.send({ ticket: await issueStreamTicket(request.user) })
  })

  // Bell: the person's own channel (office user or client user), same ticket auth as the boards
  app.get('/notifications/stream', async (request, reply) => {
    const { ticket } = request.query as { ticket?: string }
    const user = await consumeStreamTicket(ticket)
    if (!user.organizationId) throw new AppError(403, 'Acesso negado') // MASTER has no inbox
    const staff = user.role === 'ORG_ADMIN' || user.role === 'ORG_MANAGER' || user.role === 'ORG_MEMBER'
    if (!staff && user.role !== 'CLIENT') throw new AppError(403, 'Acesso negado')
    attachSSESubscriber(request, reply, inboxChannel({ kind: staff ? 'user' : 'clientUser', id: user.sub }), streamRecheck(user))
  })

  app.get('/boards/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { ticket } = request.query as { ticket?: string }

    // EventSource can't send headers: auth via a one-time ticket from POST /stream/ticket
    const user = await consumeStreamTicket(ticket)
    if (!user.organizationId) throw new AppError(403, 'Acesso negado') // MASTER has no processes

    // Verify board exists and belongs to the user's org
    const board = await prisma.board.findFirst({
      // Processes and the recurring board: both have open panels that refresh in real time
      where: { id, organizationId: user.organizationId!, isActive: true },
    })
    if (!board) throw new AppError(404, 'Board não encontrado')
    const staffCheck = user.role === 'ORG_MEMBER' || user.role === 'ORG_MANAGER'
      ? async () => assertStaffSees(await loadStaffScope(user), user.organizationId!, { boardIds: [id] }, 'read')
      : null
    if (staffCheck) await staffCheck()

    // CLIENT subscribers are additionally gated at the company level — a ClientUser must have
    // access to the board's client, or the board effectively doesn't exist to them. The events are
    // not filtered per task (department, visibleToClient), so a client gets only their names
    // (eventOnly below) and reloads through the API.
    const clientCheck = user.role === 'CLIENT'
      ? async () => {
        const scope = await getClientAccessScope(user.sub)
        if (!scope.clientIds.includes(board.clientId)) throw new AppError(404, 'Board não encontrado')
      }
      : null
    if (clientCheck) await clientCheck()

    // Scope can shrink while the panel is open ("ver colegas" turned off, portfolio moved)
    attachSSESubscriber(request, reply, `board:${id}`, { ...streamRecheck(user, staffCheck ?? clientCheck ?? undefined), eventOnly: user.role === 'CLIENT' })
  })
}
