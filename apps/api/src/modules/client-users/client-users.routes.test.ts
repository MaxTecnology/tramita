import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestDepartment,
  getAuthHeader,
} from '@/test/helpers'

async function setup(role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' = 'ORG_ADMIN') {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id, { role })
  const client = await createTestClient(org.id)
  const department = await createTestDepartment(org.id)
  const auth = await getAuthHeader(user.email, 'Test@1234')
  return { org, user, client, department, auth }
}

describe('POST /client-users', () => {
  it('ORG_ADMIN creates a client user (201)', async () => {
    const { client, department, auth } = await setup('ORG_ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/client-users',
      headers: { authorization: auth },
      payload: {
        name: 'Viviane',
        email: `viviane-${Date.now()}@test.com`,
        password: 'Senha@1234',
        isActive: true,
        accesses: [{ clientId: client.id, departmentId: department.id }],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).accesses).toHaveLength(1)
  })

  it('ORG_MEMBER cannot create (403)', async () => {
    const { client, department, auth } = await setup('ORG_MEMBER')

    const res = await app.inject({
      method: 'POST',
      url: '/client-users',
      headers: { authorization: auth },
      payload: {
        name: 'Viviane',
        email: `viviane-${Date.now()}@test.com`,
        password: 'Senha@1234',
        isActive: true,
        accesses: [{ clientId: client.id, departmentId: department.id }],
      },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /client-users', () => {
  it('lists only the caller org client users', async () => {
    const { client, department, auth } = await setup('ORG_ADMIN')
    await app.inject({
      method: 'POST',
      url: '/client-users',
      headers: { authorization: auth },
      payload: {
        name: 'Viviane',
        email: `viviane-${Date.now()}@test.com`,
        password: 'Senha@1234',
        isActive: true,
        accesses: [{ clientId: client.id, departmentId: department.id }],
      },
    })

    const { auth: otherAuth } = await setup('ORG_ADMIN')

    const res = await app.inject({ method: 'GET', url: '/client-users', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)

    const otherRes = await app.inject({ method: 'GET', url: '/client-users', headers: { authorization: otherAuth } })
    expect(JSON.parse(otherRes.body)).toHaveLength(0)
  })
})

describe('PATCH /client-users/:id', () => {
  it('returns 404 when the client user belongs to another org', async () => {
    const { client, department, auth } = await setup('ORG_ADMIN')
    const created = await app.inject({
      method: 'POST',
      url: '/client-users',
      headers: { authorization: auth },
      payload: {
        name: 'Viviane',
        email: `viviane-${Date.now()}@test.com`,
        password: 'Senha@1234',
        isActive: true,
        accesses: [{ clientId: client.id, departmentId: department.id }],
      },
    })
    const { id } = JSON.parse(created.body)

    const { auth: otherAuth } = await setup('ORG_ADMIN')
    const res = await app.inject({
      method: 'PATCH',
      url: `/client-users/${id}`,
      headers: { authorization: otherAuth },
      payload: { name: 'Editado' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /client-users/:id', () => {
  it('returns 404 when the client user belongs to another org', async () => {
    const { client, department, auth } = await setup('ORG_ADMIN')
    const created = await app.inject({
      method: 'POST',
      url: '/client-users',
      headers: { authorization: auth },
      payload: {
        name: 'Viviane',
        email: `viviane-${Date.now()}@test.com`,
        password: 'Senha@1234',
        isActive: true,
        accesses: [{ clientId: client.id, departmentId: department.id }],
      },
    })
    const { id } = JSON.parse(created.body)

    const { auth: otherAuth } = await setup('ORG_ADMIN')
    const res = await app.inject({
      method: 'DELETE',
      url: `/client-users/${id}`,
      headers: { authorization: otherAuth },
    })

    expect(res.statusCode).toBe(404)
  })
})
