import { describe, expect, it } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, getAuthHeader } from '@/test/helpers'

async function setup(maxClients = 10) {
  const plan = await createTestPlan()
  await prisma.plan.update({ where: { id: plan.id }, data: { maxClients } })
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  return { org, auth: await getAuthHeader(admin.email, 'Test@1234') }
}
const reactivate = (auth: string, id: string) => app.inject({ method: 'POST', url: `/clients/${id}/reactivate`, headers: { authorization: auth } })

describe('reativar cliente', () => {
  it('a deactivated client comes back active', async () => {
    const s = await setup()
    const client = await createTestClient(s.org.id, { isActive: false })
    const res = await reactivate(s.auth, client.id)
    expect(res.statusCode).toBe(200)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).isActive).toBe(true)
  })

  it('respects the plan limit, like a new client', async () => {
    const s = await setup(1)
    await createTestClient(s.org.id)
    const inactive = await createTestClient(s.org.id, { isActive: false })
    const res = await reactivate(s.auth, inactive.id)
    expect(res.statusCode).toBe(422)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: inactive.id } })).isActive).toBe(false)
  })

  it('an active client or one of another office is not found; a member cannot', async () => {
    const s = await setup()
    expect((await reactivate(s.auth, (await createTestClient(s.org.id)).id)).statusCode).toBe(404)
    const other = await setup()
    expect((await reactivate(s.auth, (await createTestClient(other.org.id, { isActive: false })).id)).statusCode).toBe(404)
    const member = await createTestUser(s.org.id, { role: 'ORG_MEMBER' })
    expect((await reactivate(await getAuthHeader(member.email, 'Test@1234'), (await createTestClient(s.org.id, { isActive: false })).id)).statusCode).toBe(403)
  })
})

describe('portal de cliente desativado', () => {
  it('the portal user stops seeing the deactivated client, and sees it again after reactivation', async () => {
    const { createTestDepartment, createTestClientUser, grantClientAccess } = await import('@/test/helpers')
    const s = await setup()
    const dept = await createTestDepartment(s.org.id)
    const client = await createTestClient(s.org.id, { name: 'ACME' })
    const { clientUser, password } = await createTestClientUser(s.org.id)
    await grantClientAccess(clientUser.id, client.id, dept.id)
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: clientUser.email, password } })
    const portal = `Bearer ${JSON.parse(login.body).accessToken}`
    const seen = async () => ((await app.inject({ method: 'GET', url: '/portal/clients', headers: { authorization: portal } })).json() as { id: string }[]).map((c) => c.id)

    expect(await seen()).toEqual([client.id])
    await app.inject({ method: 'DELETE', url: `/clients/${client.id}`, headers: { authorization: s.auth } })
    expect(await seen()).toEqual([])
    await reactivate(s.auth, client.id)
    expect(await seen()).toEqual([client.id])
  })
})

describe('reativar cliente — integridade', () => {
  it('another active client took the code meanwhile: 409 saying so, nothing changes', async () => {
    const s = await setup()
    const old = await createTestClient(s.org.id, { codigo: '777', isActive: false })
    await createTestClient(s.org.id, { codigo: '777' })
    const res = await reactivate(s.auth, old.id)
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/código/i)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: old.id } })).isActive).toBe(false)
  })

  it('a department responsible was deactivated meanwhile: 409 naming the department', async () => {
    const { createTestDepartment, serveClientDepartment } = await import('@/test/helpers')
    const s = await setup()
    const fiscal = await createTestDepartment(s.org.id, { name: 'Fiscal' })
    const bruna = await createTestUser(s.org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(s.org.id, { isActive: false })
    await serveClientDepartment(client.id, fiscal.id, bruna.id)
    await prisma.user.update({ where: { id: bruna.id }, data: { isActive: false } })
    const res = await reactivate(s.auth, client.id)
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain('Fiscal')
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).isActive).toBe(false)
  })
})

it('a deactivated client can be edited (to fix its responsible) and then reactivated', async () => {
  const { createTestDepartment } = await import('@/test/helpers')
  const s = await setup()
  const dept = await createTestDepartment(s.org.id)
  const ana = await createTestUser(s.org.id, { role: 'ORG_ADMIN' })
  const body = {
    name: 'Fulano', codigo: `R-${Date.now()}`, clientType: 'PF', cpf: '529.982.247-25', estado: 'SE', ibgeCityCode: 2800308,
    departments: [{ departmentId: dept.id, responsibleUserId: ana.id }],
    clientUsers: [{ name: 'Contato', email: `react-${Date.now()}@x.com`, password: 'Senha@1234', departmentIds: [dept.id] }],
  }
  const created = (await app.inject({ method: 'POST', url: '/clients', headers: { authorization: s.auth }, payload: body })).json() as { id: string }
  await app.inject({ method: 'DELETE', url: `/clients/${created.id}`, headers: { authorization: s.auth } })
  const users = (await app.inject({ method: 'GET', url: `/clients/${created.id}/users`, headers: { authorization: s.auth } })).json() as { existingId: string; departmentIds: string[] }[]
  const edit = await app.inject({
    method: 'PATCH', url: `/clients/${created.id}`, headers: { authorization: s.auth },
    payload: { ...body, name: 'Fulano Editado', clientUsers: users.map((u) => ({ existingId: u.existingId, departmentIds: u.departmentIds })) },
  })
  expect(edit.statusCode).toBe(200)
  expect((await reactivate(s.auth, created.id)).statusCode).toBe(200)
  expect((await prisma.client.findUniqueOrThrow({ where: { id: created.id } })).name).toBe('Fulano Editado')
})
