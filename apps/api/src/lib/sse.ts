import type { FastifyReply, FastifyRequest } from 'fastify'
import type { OutgoingHttpHeaders } from 'node:http'
import { redis } from '@/lib/redis'

export interface SSEEvent {
  event: 'task:moved' | 'task:created' | 'task:updated' | 'comment:added' | 'request:changed' | 'inbox:changed'
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

// Per-person bell channel (office user or client user)
export const inboxChannel = (r: { kind: 'user' | 'clientUser'; id: string }) =>
  r.kind === 'user' ? `inbox:user:${r.id}` : `inbox:client:${r.id}`

export async function publishInboxEvent(r: { kind: 'user' | 'clientUser'; id: string }): Promise<void> {
  try {
    await redis.publish(inboxChannel(r), JSON.stringify({ event: 'inbox:changed', data: {} } satisfies SSEEvent))
  } catch { /* ignore in test/offline environments */ }
}

export const SSE_MAX_CONNECTION_MS = 15 * 60 * 1000

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
  } as OutgoingHttpHeaders)
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

  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    clearTimeout(maxDuration)
    sub.unsubscribe().catch(() => {})
    sub.quit().catch(() => {})
  }

  // Access is checked only when the connection opens (one-time ticket). Ending it after a while
  // makes the client reconnect with a fresh ticket, so a deactivated user or a lost scope stops
  // receiving events within this window.
  const maxDuration = setTimeout(() => {
    cleanup()
    raw.end()
  }, SSE_MAX_CONNECTION_MS)

  // Cleanup on client disconnect
  request.raw.on('close', cleanup)
}
