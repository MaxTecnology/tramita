import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestClient,
  createTestUser,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

describe('Portal — isolamento de tenant', () => {
  it('CLIENT não acessa board de outra org (404)', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const client1 = await createTestClient(org1.id)
    const client2 = await createTestClient(org2.id)
    const board = await createTestBoard(org1.id, client1.id)

    const auth = await getAuthHeader(client2.email, 'Client@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(404)
  })

  it('CLIENT não pode mover tarefas (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /portal/profile', () => {
  it('CLIENT atualiza próprio whatsapp — 200', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: '/portal/profile',
      headers: { authorization: auth },
      payload: { whatsapp: '5582999999999' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).whatsapp).toBe('5582999999999')
  })

  it('ORG_MEMBER não acessa /portal/profile (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: '/portal/profile',
      headers: { authorization: auth },
      payload: { whatsapp: '5582999999999' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /portal/tasks/:id/history', () => {
  it('CLIENT vê histórico de tarefa do próprio board', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/portal/tasks/${task.id}/history`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})

describe('POST /portal/requests', () => {
  it('cliente cria uma request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(client.email, 'Client@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { title: 'Abertura de empresa', description: 'Quero abrir uma LTDA' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('PENDING')
    expect(body.title).toBe('Abertura de empresa')
  })
})

describe('GET /portal/requests', () => {
  it('cliente só vê as próprias requests, não as de outro cliente da mesma org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'porta-a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'porta-b@test.com' })
    const authA = await getAuthHeader(clientA.email, 'Client@1234')
    const authB = await getAuthHeader(clientB.email, 'Client@1234')

    await app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: authA }, payload: { title: 'Da A' } })
    await app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: authB }, payload: { title: 'Da B' } })

    const res = await app.inject({ method: 'GET', url: '/portal/requests', headers: { authorization: authA } })
    const list = JSON.parse(res.body)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Da A')
  })
})

describe('PATCH /portal/requests/:id/cancel', () => {
  it('cliente cancela a própria request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(client.email, 'Client@1234')

    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { title: 'Pedido a cancelar' },
    })
    const request = JSON.parse(created.body)

    const res = await app.inject({
      method: 'PATCH',
      url: `/portal/requests/${request.id}/cancel`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('CANCELLED')
  })

  it('cliente não pode cancelar request de outro cliente (404)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'cancel-a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'cancel-b@test.com' })
    const authA = await getAuthHeader(clientA.email, 'Client@1234')
    const authB = await getAuthHeader(clientB.email, 'Client@1234')

    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authA },
      payload: { title: 'Da A' },
    })
    const request = JSON.parse(created.body)

    const res = await app.inject({
      method: 'PATCH',
      url: `/portal/requests/${request.id}/cancel`,
      headers: { authorization: authB },
    })
    expect(res.statusCode).toBe(404)
  })
})
