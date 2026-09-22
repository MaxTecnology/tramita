import type { FastifyInstance } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { prisma } from '@/lib/prisma'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import { getClientAccessScope } from '@/modules/client-users/client-access'

export async function streamRoutes(app: FastifyInstance) {
  app.get('/boards/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { token } = request.query as { token?: string }

    // Auth via query param — EventSource API doesn't support custom headers
    if (!token) throw new AppError(401, 'Token não fornecido')

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      throw new AppError(401, 'Token inválido ou expirado')
    }

    // Verify board exists and belongs to the user's org
    const board = await prisma.board.findFirst({
      where: { id, organizationId: user.organizationId!, isActive: true, type: 'OS' },
    })
    if (!board) throw new AppError(404, 'Board não encontrado')

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
