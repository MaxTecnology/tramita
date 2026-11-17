import { describe, it, expect, vi, afterEach } from 'vitest'
import * as cnpjLookup from '@/lib/cnpj-lookup'
import { redis } from '@/lib/redis'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, getAuthHeader, generateValidCnpj } from '@/test/helpers'

let n = 0

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const user = await createTestUser(org.id)
  const dept = await createTestDepartment(org.id)
  return { org, user, dept, auth: await getAuthHeader(user.email, 'Test@1234') }
}
type Ctx = Awaited<ReturnType<typeof setup>>

const payload = (c: Ctx, over: Record<string, unknown> = {}) => ({
  name: 'Fulano', codigo: `L-${Date.now()}-${++n}`, clientType: 'PF', cpf: '529.982.247-25',
  estado: 'SE', ibgeCityCode: 2800308,
  departments: [{ departmentId: c.dept.id, responsibleUserId: c.user.id }],
  clientUsers: [{ name: 'Contato', email: `loc-${Date.now()}-${n}@x.com`, password: 'Senha@1234', departmentIds: [c.dept.id] }],
  ...over,
})

const create = (c: Ctx, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/clients', headers: { authorization: c.auth }, payload: payload(c, over) })

describe('estado e cidade do cliente', () => {
  it('saves the city name from the IBGE table, whatever the body says', async () => {
    const c = await setup()
    const res = await create(c, { cidade: 'Qualquer coisa' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ estado: 'SE', cidade: 'Aracaju', ibgeCityCode: 2800308 })
  })

  it('a forged huge city code is a 400, not a server error', async () => {
    const c = await setup()
    const res = await create(c, { ibgeCityCode: 3000000000 })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ message: 'Informe a cidade do cliente' })
  })

  it('refuses a city of another state, and an unknown city, saving nothing', async () => {
    const c = await setup()
    const other = await create(c, { ibgeCityCode: 2704302 })
    expect(other.statusCode).toBe(400)
    expect(other.json()).toEqual({ message: 'A cidade não pertence ao estado informado' })
    const unknown = await create(c, { ibgeCityCode: 9999999 })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json()).toEqual({ message: 'Cidade não encontrada' })
    expect(await prisma.client.count({ where: { organizationId: c.org.id } })).toBe(0)
  })

  it('an old client without city must get one to be saved again', async () => {
    const c = await setup()
    const old = await createTestClient(c.org.id, { estado: null, ibgeCityCode: null })
    const body = payload(c, { clientType: 'PJ', cpf: null, cnpj: generateValidCnpj(Date.now()), cep: '49000000', bairro: 'Centro', logradouro: 'Rua A', numero: '1' })
    const without = await app.inject({ method: 'PATCH', url: `/clients/${old.id}`, headers: { authorization: c.auth }, payload: { ...body, ibgeCityCode: null } })
    expect(without.statusCode).toBe(400)
    expect(without.json()).toEqual({ message: 'Informe a cidade do cliente' })
    const fixed = await app.inject({ method: 'PATCH', url: `/clients/${old.id}`, headers: { authorization: c.auth }, payload: body })
    expect(fixed.statusCode).toBe(200)
    expect(await prisma.client.findUnique({ where: { id: old.id }, select: { estado: true, ibgeCityCode: true, cidade: true } }))
      .toEqual({ estado: 'SE', ibgeCityCode: 2800308, cidade: 'Aracaju' })
  })

  it('a client of another office stays out of reach (404)', async () => {
    const c = await setup()
    const otherOrg = await createTestOrg((await createTestPlan()).id)
    const foreign = await createTestClient(otherOrg.id)
    const res = await app.inject({ method: 'PATCH', url: `/clients/${foreign.id}`, headers: { authorization: c.auth }, payload: payload(c) })
    expect(res.statusCode).toBe(404)
  })

  it('lists bring the state and the city code', async () => {
    const c = await setup()
    await createTestClient(c.org.id, { estado: 'AL', ibgeCityCode: 2704302 })
    const res = await app.inject({ method: 'GET', url: '/clients', headers: { authorization: c.auth } })
    expect(res.json()[0]).toMatchObject({ estado: 'AL', cidade: 'Maceió', ibgeCityCode: 2704302 })
  })
})

describe('buscador de CNPJ — limite por pessoa', () => {
  afterEach(() => vi.restoreAllMocks())

  it('10 lookups a minute per person; the 11th waits (429)', async () => {
    await redis.del('cnpj-lookup:11222333000181')
    vi.spyOn(cnpjLookup, 'lookupCnpj').mockResolvedValue({
      razaoSocial: 'ACME', nomeFantasia: null, cep: null, estado: 'SE', cidade: 'ARACAJU', ibgeCityCode: 2800308,
      bairro: null, logradouro: null, numero: null, complemento: null,
    })
    const c = await setup()
    const lookup = () => app.inject({ method: 'GET', url: '/clients/lookup-cnpj/11222333000181', headers: { authorization: c.auth } })
    for (let i = 0; i < 10; i++) expect((await lookup()).statusCode).toBe(200)
    expect((await lookup()).statusCode).toBe(429)
  })
})

