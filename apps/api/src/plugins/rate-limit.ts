import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'

// Requests per IP per minute. Default 100 (production); the E2E suite raises it because every spec
// runs from 127.0.0.1 and would trip the limit halfway through.
function maxPerMinute(): number {
  const raw = process.env.RATE_LIMIT_MAX
  const value = raw ? Number(raw) : 100
  if (!Number.isInteger(value) || value <= 0) throw new Error(`RATE_LIMIT_MAX inválido: ${raw}`)
  return value
}

export default fp(async function (app: FastifyInstance) {
  await app.register(rateLimit, {
    max: maxPerMinute(),
    timeWindow: '1 minute',
  })
})
