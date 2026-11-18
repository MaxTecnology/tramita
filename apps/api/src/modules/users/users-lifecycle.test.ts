import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestDepartment, getAuthHeader } from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const department = await createTestDepartment(org.id)
  return { org, department, auth: await getAuthHeader(admin.email, 'Test@1234') }
}
type Ctx = Awaited<ReturnType<typeof setup>>

const as = (auth: string) => ({ authorization: auth })
const create = (c: Ctx, extra: object = {}) => app.inject({
  method: 'POST', url: '/users', headers: as(c.auth),
  payload: { name: 'Bruna Lima', email: `bruna-${Math.random()}@x.com`, role: 'ORG_MEMBER', departmentIds: [c.department.id], ...extra },
})

describe('cadastro com senha gerada pelo sistema', () => {
  it('the server creates the password and shows it once; the person signs in with it', async () => {
    const c = await setup()
    const res = await create(c)
    expect(res.statusCode).toBe(201)
    const body = res.json() as { email: string; temporaryPassword: string }
    expect(body.temporaryPassword).toMatch(/^.{12,}$/)
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: body.email, password: body.temporaryPassword } })
    expect(login.statusCode).toBe(200)
    // Never shown again: the list does not carry it
    const list = await app.inject({ method: 'GET', url: '/users', headers: as(c.auth) })
    expect(JSON.stringify(list.json())).not.toContain(body.temporaryPassword)
  })

  it('a password typed by the admin is ignored', async () => {
    const c = await setup()
    const res = await create(c, { password: 'Escolhida@123' })
    expect(res.statusCode).toBe(201)
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: res.json().email, password: 'Escolhida@123' } })
    expect(login.statusCode).toBe(401)
  })
})

describe('desativados e reativação', () => {
  async function deactivated(c: Ctx) {
    const user = await createTestUser(c.org.id, { role: 'ORG_MEMBER' })
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
    return user
  }

  it('the list shows active people by default and the deactivated ones on request', async () => {
    const c = await setup()
    const gone = await deactivated(c)
    const active = (await app.inject({ method: 'GET', url: '/users', headers: as(c.auth) })).json() as { id: string }[]
    expect(active.map((u) => u.id)).not.toContain(gone.id)
    const inactive = (await app.inject({ method: 'GET', url: '/users?status=inactive', headers: as(c.auth) })).json() as { id: string; isActive: boolean }[]
    expect(inactive.map((u) => [u.id, u.isActive])).toEqual([[gone.id, false]])
    expect((await app.inject({ method: 'GET', url: '/users?status=xx', headers: as(c.auth) })).statusCode).toBe(400)
  })

  it('reactivating brings the person back, with the same departments', async () => {
    const c = await setup()
    const gone = await deactivated(c)
    const res = await app.inject({ method: 'POST', url: `/users/${gone.id}/reactivate`, headers: as(c.auth) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: gone.id, isActive: true })
    const active = (await app.inject({ method: 'GET', url: '/users', headers: as(c.auth) })).json() as { id: string }[]
    expect(active.map((u) => u.id)).toContain(gone.id)
    expect((await app.inject({ method: 'POST', url: `/users/${gone.id}/reactivate`, headers: as(c.auth) })).json())
      .toEqual({ message: 'Usuário já está ativo' })
  })

  it('only the admin of the same office reactivates', async () => {
    const c = await setup()
    const gone = await deactivated(c)
    const other = await setup()
    expect((await app.inject({ method: 'POST', url: `/users/${gone.id}/reactivate`, headers: as(other.auth) })).statusCode).toBe(404)
    const manager = await createTestUser(c.org.id, { role: 'ORG_MANAGER' })
    const managerAuth = await getAuthHeader(manager.email, 'Test@1234')
    expect((await app.inject({ method: 'POST', url: `/users/${gone.id}/reactivate`, headers: as(managerAuth) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/users?status=inactive', headers: as(managerAuth) })).statusCode).toBe(403)
  })
})
