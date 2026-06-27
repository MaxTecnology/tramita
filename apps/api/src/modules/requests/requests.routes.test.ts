import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  getAuthHeader,
} from '@/test/helpers'

describe('GET /requests', () => {
  it('ORG_MEMBER pode listar (somente leitura)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(member.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: await getAuthHeader(client.email, 'Client@1234') },
      payload: { title: 'Pedido via portal' },
    })

    const res = await app.inject({ method: 'GET', url: '/requests', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
  })
})

describe('POST /requests/:id/approve', () => {
  it('ORG_MEMBER não pode aprovar (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const authClient = await getAuthHeader(client.email, 'Client@1234')
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/approve`,
      headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('ORG_ADMIN aprova com NEW_BOARD e a request passa a ter taskId', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const authClient = await getAuthHeader(client.email, 'Client@1234')
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/approve`,
      headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('APPROVED')
    expect(body.taskId).not.toBeNull()
  })
})

describe('POST /requests/:id/reject', () => {
  it('ORG_MANAGER rejeita com motivo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const client = await createTestClient(org.id)
    const authClient = await getAuthHeader(client.email, 'Client@1234')
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/reject`,
      headers: { authorization: auth },
      payload: { reason: 'Fora de escopo' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('REJECTED')
  })
})

describe('GET /requests/pending-count', () => {
  it('retorna a contagem de pendentes da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: await getAuthHeader(client.email, 'Client@1234') },
      payload: { title: 'Pedido 1' },
    })
    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: await getAuthHeader(client.email, 'Client@1234') },
      payload: { title: 'Pedido 2' },
    })

    const res = await app.inject({ method: 'GET', url: '/requests/pending-count', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ count: 2 })
  })

  it('CLIENT não acessa este endpoint (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(client.email, 'Client@1234')

    const res = await app.inject({ method: 'GET', url: '/requests/pending-count', headers: { authorization: auth } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /requests/stream', () => {
  it('retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/requests/stream' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 com token inválido', async () => {
    const res = await app.inject({ method: 'GET', url: '/requests/stream?token=invalid-token' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 para CLIENT', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const authHeader = await getAuthHeader(client.email, 'Client@1234')
    const token = authHeader.replace('Bearer ', '')

    const res = await app.inject({ method: 'GET', url: `/requests/stream?token=${token}` })
    expect(res.statusCode).toBe(403)
  })
})
