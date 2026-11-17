import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { redis } from '@/lib/redis'

// Budgets per minute. Signed in: per person (an office shares one public IP — a per-IP budget would
// throttle a whole team in normal use). Not signed in (login, sign-up, forged tokens): per IP and
// tighter, against brute force. The E2E suite raises both (every spec runs from 127.0.0.1).
function budget(name: 'RATE_LIMIT_MAX' | 'RATE_LIMIT_USER_MAX', fallback: number): number {
  const raw = process.env[name]
  const value = raw ? Number(raw) : fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} inválido: ${raw}`)
  return value
}

// The person behind a valid access token; anything else (no token, expired, forged) is anonymous
function signedInUser(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  try {
    return verifyAccessToken(auth.slice(7)).sub
  } catch {
    return null
  }
}

export default fp(async function (app: FastifyInstance) {
  const perIp = budget('RATE_LIMIT_MAX', 100)
  const perUser = budget('RATE_LIMIT_USER_MAX', 300)
  await app.register(rateLimit, {
    // Shared counters: the limit holds with more than one API replica; Redis down → requests pass
    redis,
    skipOnError: true,
    timeWindow: '1 minute',
    // CORS preflights carry no work and would halve the real budget
    allowList: (request) => request.method === 'OPTIONS',
    keyGenerator: (request) => {
      const user = signedInUser(request)
      return user ? `user:${user}` : `ip:${request.ip}`
    },
    max: (_request, key) => (key.startsWith('user:') ? perUser : perIp),
  })
})
