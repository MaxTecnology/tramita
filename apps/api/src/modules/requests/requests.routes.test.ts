import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestClientUser,
  createTestDepartment,
  grantClientAccess,
  getAuthHeader,
  serveClientDepartment,
} from '@/test/helpers'

async function createTestClientLogin(orgId: string) {
  const client = await createTestClient(orgId)
  const department = await createTestDepartment(orgId)
  const responsible = await createTestUser(orgId, { role: 'ORG_MEMBER' })
  await serveClientDepartment(client.id, department.id, responsible.id)
  const { clientUser, password } = await createTestClientUser(orgId)
  await grantClientAccess(clientUser.id, client.id, department.id)
  return { client, department, auth: await getAuthHeader(clientUser.email, password) }
}

describe('GET /requests', () => {
  it('ORG_MEMBER pode listar (somente leitura)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const auth = await getAuthHeader(member.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido via portal', departmentId: department.id },
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
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
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
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
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
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
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
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido 1', departmentId: department.id },
    })
    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido 2', departmentId: department.id },
    })

    const res = await app.inject({ method: 'GET', url: '/requests/pending-count', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ count: 2 })
  })

  it('CLIENT não acessa este endpoint (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const { auth } = await createTestClientLogin(org.id)

    const res = await app.inject({ method: 'GET', url: '/requests/pending-count', headers: { authorization: auth } })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /requests/:id/needs-info', () => {
  it('ORG_MANAGER marca NEEDS_INFO com comentário obrigatório', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/needs-info`, headers: { authorization: auth },
      payload: { comment: 'Qual o CNPJ?' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('NEEDS_INFO')
  })

  it('rejeita sem comment (400)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/needs-info`, headers: { authorization: auth },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejeita comment só com espaços em branco (400)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)
    const auth = await getAuthHeader(manager.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/needs-info`, headers: { authorization: auth },
      payload: { comment: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /requests/:id/cancel', () => {
  it('ORG_ADMIN cancela request aprovada sem atividade na task, com motivo obrigatório', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })

    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: auth },
      payload: { reason: 'Cliente desistiu' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('CANCELLED')
  })

  it('ORG_MEMBER não pode cancelar (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)
    const authAdmin = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: authAdmin },
      payload: { mode: 'NEW_BOARD' },
    })

    const authMember = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: authMember },
      payload: { reason: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejeita sem reason (400)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })

    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: auth },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejeita reason só com espaços em branco (400)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido', departmentId: department.id },
    })
    const request = JSON.parse(created.body)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })

    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: auth },
      payload: { reason: '   ' },
    })
    expect(res.statusCode).toBe(400)
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
    const { auth: authHeader } = await createTestClientLogin(org.id)
    const token = authHeader.replace('Bearer ', '')

    const res = await app.inject({ method: 'GET', url: `/requests/stream?token=${token}` })
    expect(res.statusCode).toBe(403)
  })
})
