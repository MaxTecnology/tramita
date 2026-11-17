import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { app } from '@/test/setup'
import { buildApp } from '@/server'
import { ROUTE_DOCS } from '@/api-docs/catalog'

afterEach(() => vi.unstubAllEnvs())

type OpenApi = { paths: Record<string, Record<string, { summary?: string; tags?: string[]; security?: unknown[]; requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> } }>> }
const spec = (): OpenApi => JSON.parse(JSON.stringify(app.swagger())) as OpenApi

async function appWith(env: Record<string, string>): Promise<FastifyInstance> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const built = buildApp()
  await built.ready()
  return built
}

describe('documentação da API', () => {
  it('lists every route with its module tag; private routes ask for the bearer token, the public login does not', () => {
    const doc = spec()
    expect(Object.values(doc.paths).flatMap((ops) => Object.keys(ops)).length).toBe(Object.keys(ROUTE_DOCS).length)
    expect(doc.paths['/tasks'].get.tags).toEqual(['Tarefas'])
    expect(doc.paths['/tasks'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/auth/login'].post.security).toEqual([])
  })

  it('every route has a summary in the catalog, and the catalog names no route that does not exist', () => {
    const doc = spec()
    const operations = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`, summary: op.summary })))
    expect(operations.filter((o) => !o.summary).map((o) => o.key)).toEqual([])
    const existing = new Set(operations.map((o) => o.key))
    expect(Object.keys(ROUTE_DOCS).filter((k) => !existing.has(k))).toEqual([])
  })

  it('plumbing routes stay out: no CORS preflight (OPTIONS) and no catch-all path', () => {
    const doc = spec()
    expect(Object.keys(doc.paths).filter((p) => p.includes('*'))).toEqual([])
    expect(Object.values(doc.paths).filter((ops) => 'options' in ops)).toEqual([])
  })

  it('a documented route shows its body taken from the Zod schema', () => {
    const body = spec().paths['/auth/login'].post.requestBody!.content['application/json'].schema
    expect(Object.keys(body.properties ?? {})).toEqual(expect.arrayContaining(['email', 'password']))
  })

  it('documenting does not validate: the route keeps its own Zod answer', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nao-e-email', password: '' } })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ message: expect.any(String) })
    expect(JSON.parse(res.body).message).not.toContain('body/')
  })

  it('the reference page is opt-in: only with API_DOCS_ENABLED=true and never in production', async () => {
    expect((await app.inject({ method: 'GET', url: '/reference/' })).statusCode).toBe(404)
    const dev = await appWith({ API_DOCS_ENABLED: 'true' })
    expect((await dev.inject({ method: 'GET', url: '/reference/' })).statusCode).toBe(200)
    await dev.close()
    const prod = await appWith({ API_DOCS_ENABLED: 'true', NODE_ENV: 'production' })
    expect((await prod.inject({ method: 'GET', url: '/reference/' })).statusCode).toBe(404)
    await prod.close()
  })

  it('the reference page runs its inline script (no CSP there) while every other route keeps the CSP', async () => {
    const dev = await appWith({ API_DOCS_ENABLED: 'true' })
    expect((await dev.inject({ method: 'GET', url: '/reference/' })).headers['content-security-policy']).toBeUndefined()
    expect((await dev.inject({ method: 'GET', url: '/health' })).headers['content-security-policy']).toContain("script-src 'self'")
    await dev.close()
  })

  it('the live reference only points at the local API ("Try it" never hits production)', async () => {
    const built = await appWith({})
    const servers = (JSON.parse(JSON.stringify(built.swagger())) as { servers: { url: string }[] }).servers
    expect(servers.map((x) => x.url)).toEqual([`http://localhost:${process.env.PORT ?? 3000}`])
    await built.close()
  })

  it('schemas use the OpenAPI 3.1 (JSON Schema) dialect: no 3.0 `nullable` nor boolean exclusiveMinimum', () => {
    const text = JSON.stringify(spec())
    expect(text).not.toContain('"nullable"')
    expect(text).not.toMatch(/"exclusive(Minimum|Maximum)":(true|false)/)
  })
})
