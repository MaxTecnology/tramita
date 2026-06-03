import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  getAuthHeader,
} from '@/test/helpers'

describe('POST /boards', () => {
  it('ORG_MEMBER cria board e fica como responsável automático', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: auth },
      payload: { title: 'Abertura LTDA', clientId: client.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.title).toBe('Abertura LTDA')
    expect(body.responsibleUserId).toBe(member.id)
    expect(body.columns).toHaveLength(3)
    expect(body.columns[0].title).toBe('Pendente')
    expect(body.columns[2].title).toBe('Concluído')
    expect(body.columns[2].isFinal).toBe(true)
  })

  it('ORG_MANAGER cria board sem responsável automático', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: auth },
      payload: { title: 'Processo ABC', clientId: client.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.responsibleUserId).toBeNull()
    expect(body.columns).toHaveLength(3)
  })

  it('ORG_MANAGER pode atribuir responsável ao criar board', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: auth },
      payload: { title: 'Processo XYZ', clientId: client.id, responsibleUserId: member.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.responsibleUserId).toBe(member.id)
  })
})

describe('GET /boards', () => {
  it('ORG_MEMBER vê apenas boards onde é responsável', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const authMember = await getAuthHeader(member.email, 'Test@1234')
    const authAdmin = await getAuthHeader(admin.email, 'Test@1234')

    // Board do member (criado pelo member → responsibleUserId = member.id)
    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authMember },
      payload: { title: 'Board do Member', clientId: client.id },
    })

    // Board do admin (sem responsável)
    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authAdmin },
      payload: { title: 'Board do Admin', clientId: client.id },
    })

    // Member vê só o seu
    const res = await app.inject({
      method: 'GET',
      url: '/boards',
      headers: { authorization: authMember },
    })

    expect(res.statusCode).toBe(200)
    const boards = JSON.parse(res.body)
    expect(boards).toHaveLength(1)
    expect(boards[0].title).toBe('Board do Member')
  })

  it('ORG_MANAGER vê todos os boards da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const authManager = await getAuthHeader(manager.email, 'Test@1234')
    const authMember = await getAuthHeader(member.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authManager },
      payload: { title: 'Board Manager', clientId: client.id },
    })
    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authMember },
      payload: { title: 'Board Member', clientId: client.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/boards',
      headers: { authorization: authManager },
    })

    expect(res.statusCode).toBe(200)
    const boards = JSON.parse(res.body)
    expect(boards).toHaveLength(2)
  })
})

describe('GET /clients (ORG_MEMBER)', () => {
  it('ORG_MEMBER pode listar clientes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    await createTestClient(org.id)

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const clients = JSON.parse(res.body)
    expect(clients).toHaveLength(1)
  })

  it('ORG_MEMBER não pode criar clientes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: auth },
      payload: { name: 'Novo Cliente', email: 'c@test.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(403)
  })
})
