import type { FastifyInstance } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { prisma } from '@/lib/prisma'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'

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
      where: { id, organizationId: user.organizationId!, isActive: true },
    })
    if (!board) throw new AppError(404, 'Board não encontrado')

    attachSSESubscriber(request, reply, `board:${id}`)
  })
}
