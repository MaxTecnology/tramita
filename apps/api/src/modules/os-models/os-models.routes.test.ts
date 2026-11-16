import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestDepartment, getAuthHeader } from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dept = await createTestDepartment(org.id)
  const das = await prisma.obligationType.create({ data: { code: `DAS-${org.id}`, name: 'DAS', organizationId: org.id } })
  return { org, dept, das, admin: await getAuthHeader(admin.email, 'Test@1234'), member: await getAuthHeader(member.email, 'Test@1234') }
}
type Ctx = Awaited<ReturnType<typeof setup>>

const body = (c: Ctx, extra: object = {}) => ({
  name: 'Recálculo DAS', departmentId: c.dept.id, requiresCompetence: true, deadlineBusinessDays: 3,
  autoCompleteOnAllDelivered: true, usableStandalone: true, usableInProcess: false,
  documentRequests: [{ name: 'Extrato' }],
  documentDeliveries: [{ name: 'Guia DAS recalculada', requiresPayment: true, obligationTypeId: c.das.id }],
  ...extra,
})
const post = (c: Ctx, payload: object, auth = c.admin) => app.inject({ method: 'POST', url: '/os-models', headers: { authorization: auth }, payload })

describe('Modelo de OS', () => {
  it('creates and reads a model with documents, robot, deadline and usage', async () => {
    const c = await setup()
    const res = await post(c, body(c))
    expect(res.statusCode).toBe(201)
    const id = JSON.parse(res.body).id
    const got = JSON.parse((await app.inject({ method: 'GET', url: `/os-models/${id}`, headers: { authorization: c.member } })).body)
    expect(got).toMatchObject({
      name: 'Recálculo DAS', requiresCompetence: true, deadlineBusinessDays: 3, autoCompleteOnAllDelivered: true,
      usableStandalone: true, usableInProcess: false,
      documentRequests: [{ name: 'Extrato' }],
      documentDeliveries: [{ name: 'Guia DAS recalculada', requiresPayment: true, obligationTypeId: c.das.id }],
    })
  })

  it('needs at least one usage', async () => {
    const c = await setup()
    const res = await post(c, body(c, { usableStandalone: false, usableInProcess: false }))
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([422, 'Marque onde essa OS é usada'])
  })

  it('a model with a robot delivery must ask for the competence', async () => {
    const c = await setup()
    const res = await post(c, body(c, { requiresCompetence: false }))
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([422, 'OS com robô precisa pedir competência'])
  })

  it('an obligation or department of another office is not found', async () => {
    const c = await setup()
    const other = await setup()
    expect((await post(c, body(c, { documentDeliveries: [{ name: 'Guia', obligationTypeId: other.das.id }] }))).statusCode).toBe(404)
    expect((await post(c, body(c, { departmentId: other.dept.id }))).statusCode).toBe(404)
  })

  it('lists active models by usage', async () => {
    const c = await setup()
    await post(c, body(c, { name: 'Avulsa' }))
    await post(c, body(c, { name: 'Junta', usableStandalone: false, usableInProcess: true, documentDeliveries: [], requiresCompetence: false }))
    await post(c, body(c, { name: 'Inativa', isActive: false }))
    const names = async (q: string) => (JSON.parse((await app.inject({ method: 'GET', url: `/os-models${q}`, headers: { authorization: c.member } })).body) as { name: string }[]).map((m) => m.name).sort()
    expect(await names('?usage=standalone')).toEqual(['Avulsa'])
    expect(await names('?usage=process')).toEqual(['Junta'])
    expect(await names('')).toEqual(['Avulsa', 'Inativa', 'Junta'])
  })

  it('only the admin creates, edits or removes', async () => {
    const c = await setup()
    expect((await post(c, body(c), c.member)).statusCode).toBe(403)
    const id = JSON.parse((await post(c, body(c))).body).id
    const patched = await app.inject({ method: 'PATCH', url: `/os-models/${id}`, headers: { authorization: c.admin }, payload: { deadlineBusinessDays: 5, documentDeliveries: [] } })
    expect(JSON.parse(patched.body)).toMatchObject({ deadlineBusinessDays: 5, documentDeliveries: [] })
    expect((await app.inject({ method: 'DELETE', url: `/os-models/${id}`, headers: { authorization: c.admin } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/os-models/${id}`, headers: { authorization: c.admin } })).statusCode).toBe(404)
  })
})
