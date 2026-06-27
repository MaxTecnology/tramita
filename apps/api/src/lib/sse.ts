import type { FastifyReply, FastifyRequest } from 'fastify'
import { redis } from '@/lib/redis'

export interface SSEEvent {
  event: 'task:moved' | 'task:created' | 'task:updated' | 'comment:added' | 'request:changed'
  data: Record<string, unknown>
}

export async function publishBoardEvent(boardId: string, payload: SSEEvent): Promise<void> {
  try {
    await redis.publish(`board:${boardId}`, JSON.stringify(payload))
  } catch { /* ignore in test/offline environments */ }
}

export async function publishOrgEvent(organizationId: string, payload: SSEEvent): Promise<void> {
  try {
    await redis.publish(`org:${organizationId}:requests`, JSON.stringify(payload))
  } catch { /* ignore in test/offline environments */ }
}

// Hijacks the reply, subscribes to `channel` on a dedicated Redis connection, and
// forwards every published message as an SSE event. Shared by every SSE route in
// the project so the hijack/heartbeat/cleanup plumbing exists in exactly one place.
export function attachSSESubscriber(
  request: FastifyRequest,
  reply: FastifyReply,
  channel: string,
): void {
  reply.hijack()
  const raw = reply.raw

  // Forward CORS headers already set by @fastify/cors plugin (via onRequest hook),
  // then overlay SSE-specific headers. This ensures Vary: Origin and correct
  // Access-Control-Allow-Origin are sent even with hijacked responses.
  raw.writeHead(200, {
    ...reply.getHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  // Flush headers immediately — writeHead buffers until first write()
  raw.write(': connected\n\n')

  // Dedicated Redis subscriber per connection
  const sub = redis.duplicate()

  sub.on('message', (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: unknown }
      raw.write(`event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`)
    } catch { /* ignore malformed messages */ }
  })

  sub.subscribe(channel).catch(() => {})

  // Heartbeat every 15 seconds — keeps connection alive and resets browser SSE timeout
  const heartbeat = setInterval(() => {
    raw.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)
  }, 15_000)

  // Cleanup on client disconnect
  request.raw.on('close', () => {
    clearInterval(heartbeat)
    sub.unsubscribe().catch(() => {})
    sub.quit().catch(() => {})
  })
}
