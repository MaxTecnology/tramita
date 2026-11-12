import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { redis } from '@/lib/redis'
import { attachSSESubscriber, SSE_MAX_CONNECTION_MS } from './sse'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function fakeConnection() {
  const sub = { on: vi.fn(), subscribe: vi.fn().mockResolvedValue(1), unsubscribe: vi.fn().mockResolvedValue(1), quit: vi.fn().mockResolvedValue('OK') }
  vi.spyOn(redis, 'duplicate').mockReturnValue(sub as never)
  const raw = Object.assign(new EventEmitter(), { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() })
  const reqRaw = new EventEmitter()
  const reply = { hijack: vi.fn(), raw, getHeaders: () => ({}) } as unknown as FastifyReply
  const request = { raw: reqRaw } as unknown as FastifyRequest
  return { sub, raw, reqRaw, reply, request }
}

describe('attachSSESubscriber', () => {
  it('closes the connection after the maximum duration so the client reconnects with a fresh ticket', () => {
    vi.useFakeTimers()
    const { sub, raw, reply, request } = fakeConnection()

    attachSSESubscriber(request, reply, 'board:b1')
    vi.advanceTimersByTime(SSE_MAX_CONNECTION_MS - 1)
    expect(raw.end).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(raw.end).toHaveBeenCalledTimes(1)
    expect(sub.quit).toHaveBeenCalledTimes(1)
  })

  it('client disconnect cleans up once and cancels the maximum-duration timer', () => {
    vi.useFakeTimers()
    const { sub, raw, reqRaw, reply, request } = fakeConnection()

    attachSSESubscriber(request, reply, 'board:b1')
    reqRaw.emit('close')
    vi.advanceTimersByTime(SSE_MAX_CONNECTION_MS)

    expect(raw.end).not.toHaveBeenCalled()
    expect(sub.quit).toHaveBeenCalledTimes(1)
  })
})
