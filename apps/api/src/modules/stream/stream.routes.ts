import type { FastifyInstance } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
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

    // Hijack: Fastify won't close the response automatically
    reply.hijack()
    const raw = reply.raw

    const origin = process.env.NODE_ENV === 'production'
      ? 'https://tramita.autohubs.com.br'
      : (request.headers.origin ?? '*')

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    })

    // Dedicated Redis subscriber per connection
    const sub = redis.duplicate()

    sub.on('message', (_channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message) as { event: string; data: unknown }
        raw.write(`event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`)
      } catch { /* ignore malformed messages */ }
    })

    await sub.subscribe(`board:${id}`)

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      raw.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)
    }, 30_000)

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      sub.unsubscribe().catch(() => {})
      sub.quit().catch(() => {})
    })
  })
}
