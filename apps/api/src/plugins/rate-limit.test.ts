import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimitPlugin from './rate-limit'
import { generateAccessToken } from '@/lib/jwt'

// A small budget to see the limit work: 2 per IP (no login), 3 per signed-in user
let app: FastifyInstance
const saved = { ip: process.env.RATE_LIMIT_MAX, user: process.env.RATE_LIMIT_USER_MAX }

beforeAll(async () => {
  process.env.RATE_LIMIT_MAX = '2'
  process.env.RATE_LIMIT_USER_MAX = '3'
  app = Fastify()
  await app.register(rateLimitPlugin)
  app.get('/ping', async () => ({ ok: true }))
  app.options('/ping', async () => ({}))
  await app.ready()
})
afterAll(async () => {
  await app.close()
  process.env.RATE_LIMIT_MAX = saved.ip
  process.env.RATE_LIMIT_USER_MAX = saved.user
})

const bearer = (sub: string) => `Bearer ${generateAccessToken({ sub, role: 'ORG_MEMBER', organizationId: 'org1' })}`
const hit = (headers: Record<string, string> = {}, method: 'GET' | 'OPTIONS' = 'GET') =>
  app.inject({ method, url: '/ping', headers, remoteAddress: '10.0.0.9' }).then((r) => r.statusCode)

describe('limite de requisições', () => {
  it('each signed-in person has their own budget, even behind the same IP (an office NAT)', async () => {
    const ana = [await hit({ authorization: bearer('ana') }), await hit({ authorization: bearer('ana') }), await hit({ authorization: bearer('ana') }), await hit({ authorization: bearer('ana') })]
    expect(ana).toEqual([200, 200, 200, 429])
    expect(await hit({ authorization: bearer('bia') })).toBe(200)
  })

  it('CORS preflights never count', async () => {
    for (let i = 0; i < 5; i++) expect(await hit({}, 'OPTIONS')).not.toBe(429)
  })

  it('without login (or with a forged token) the limit is per IP and tighter', async () => {
    const results = [await hit(), await hit({ authorization: 'Bearer forjado' }), await hit()]
    expect(results).toEqual([200, 200, 429])
  })
})
