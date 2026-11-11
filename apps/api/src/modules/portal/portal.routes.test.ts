import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createOSTemplate } from '@/modules/os-templates/os-templates.service'
import { ensureRecurringSystemBoard } from '@/modules/tasks/tasks.service'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestClient,
  createTestClientUser,
  createTestDepartment,
  grantClientAccess,
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
    const department2 = await createTestDepartment(org2.id)
    const { clientUser: clientUser2, password: clientUser2Password } = await createTestClientUser(org2.id)
    await grantClientAccess(clientUser2.id, client2.id, department2.id)
    const board = await createTestBoard(org1.id, client1.id)

    const auth = await getAuthHeader(clientUser2.email, clientUser2Password)
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
    const department = await createTestDepartment(org.id)
    const { clientUser, password: clientUserPassword } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id, { departmentId: department.id })

    const auth = await getAuthHeader(clientUser.email, clientUserPassword)
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /portal/clients', () => {
  it('retorna apenas as empresas às quais o ClientUser tem acesso', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { name: 'Empresa A' })
    const clientB = await createTestClient(org.id, { name: 'Empresa B' })
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, department.id)

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: '/portal/clients',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const list = JSON.parse(res.body)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(clientA.id)
    expect(list.some((c: { id: string }) => c.id === clientB.id)).toBe(false)
  })
})

describe('GET /portal/tasks/:id/history', () => {
  it('CLIENT vê histórico de tarefa do próprio board', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: `/portal/tasks/${task.id}/history`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('retorna 404 pra tarefa de board arquivado (isActive: false)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })
    await prisma.board.update({ where: { id: board.id }, data: { isActive: false } })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: `/portal/tasks/${task.id}/history`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /portal/tasks', () => {
  it('inclui tarefas recorrentes (board de sistema RECURRING_SYSTEM) quando visibleToClient', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)

    const systemBoard = await ensureRecurringSystemBoard(client.id, org.id)
    const recurringTask = await createTestTask(systemBoard.columns[0].id, user.id, {
      title: 'Folha de Pagamento — Setembro',
      departmentId: department.id,
    })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: '/portal/tasks',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const list = JSON.parse(res.body) as Array<{ id: string }>
    expect(list.some((t) => t.id === recurringTask.id)).toBe(true)
  })

  it('não retorna tarefa com visibleToClient false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const hiddenTask = await createTestTask(col.id, user.id, { departmentId: department.id })
    await prisma.task.update({ where: { id: hiddenTask.id }, data: { visibleToClient: false } })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: '/portal/tasks',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const list = JSON.parse(res.body) as Array<{ id: string }>
    expect(list.some((t) => t.id === hiddenTask.id)).toBe(false)
  })

  it('não retorna tarefa de departamento ao qual o ClientUser não tem acesso', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id, { name: 'Fiscal' })
    const otherDepartment = await createTestDepartment(org.id, { name: 'Folha' })
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const outOfScopeTask = await createTestTask(col.id, user.id, { departmentId: otherDepartment.id })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: '/portal/tasks',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const list = JSON.parse(res.body) as Array<{ id: string }>
    expect(list.some((t) => t.id === outOfScopeTask.id)).toBe(false)
  })

  it('não retorna tarefa de board arquivado (isActive: false)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const archivedTask = await createTestTask(col.id, user.id, { departmentId: department.id })
    await prisma.board.update({ where: { id: board.id }, data: { isActive: false } })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: '/portal/tasks',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const list = JSON.parse(res.body) as Array<{ id: string }>
    expect(list.some((t) => t.id === archivedTask.id)).toBe(false)
  })
})

describe('POST /portal/requests', () => {
  it('cliente cria uma request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const auth = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { clientId: client.id, title: 'Abertura de empresa', description: 'Quero abrir uma LTDA', departmentId: department.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('PENDING')
    expect(body.title).toBe('Abertura de empresa')
  })

  it('sem clientId no body — 400', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const auth = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { title: 'Sem empresa' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('clientId fora do escopo do usuário — 404', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const otherClient = await createTestClient(org.id, { name: 'Fora do escopo' })
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const auth = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { clientId: otherClient.id, title: 'Fora do escopo', departmentId: department.id },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /portal/requests', () => {
  it('cliente só vê as próprias requests, não as de outro cliente da mesma org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { name: 'Empresa A' })
    const clientB = await createTestClient(org.id, { name: 'Empresa B' })
    const departmentA = await createTestDepartment(org.id, { name: 'Depto A' })
    const departmentB = await createTestDepartment(org.id, { name: 'Depto B' })
    const { clientUser: clientUserA, password: passwordA } = await createTestClientUser(org.id, { email: 'porta-a@test.com' })
    const { clientUser: clientUserB, password: passwordB } = await createTestClientUser(org.id, { email: 'porta-b@test.com' })
    await grantClientAccess(clientUserA.id, clientA.id, departmentA.id)
    await grantClientAccess(clientUserB.id, clientB.id, departmentB.id)
    const authA = await getAuthHeader(clientUserA.email, passwordA)
    const authB = await getAuthHeader(clientUserB.email, passwordB)

    await app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: authA }, payload: { clientId: clientA.id, title: 'Da A', departmentId: departmentA.id } })
    await app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: authB }, payload: { clientId: clientB.id, title: 'Da B', departmentId: departmentB.id } })

    const res = await app.inject({ method: 'GET', url: `/portal/requests?clientId=${clientA.id}`, headers: { authorization: authA } })
    const list = JSON.parse(res.body)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Da A')
  })

  it('clientId fora do escopo do usuário — 404', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { name: 'Empresa A' })
    const clientB = await createTestClient(org.id, { name: 'Empresa B' })
    const departmentA = await createTestDepartment(org.id, { name: 'Depto A' })
    const { clientUser: clientUserA, password: passwordA } = await createTestClientUser(org.id, { email: 'scope-a@test.com' })
    await grantClientAccess(clientUserA.id, clientA.id, departmentA.id)
    const authA = await getAuthHeader(clientUserA.email, passwordA)

    const res = await app.inject({ method: 'GET', url: `/portal/requests?clientId=${clientB.id}`, headers: { authorization: authA } })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /portal/requests/:id/cancel', () => {
  it('cliente cancela a própria request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const auth = await getAuthHeader(clientUser.email, password)

    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { clientId: client.id, title: 'Pedido a cancelar', departmentId: department.id },
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
    const clientA = await createTestClient(org.id, { name: 'Empresa A' })
    const clientB = await createTestClient(org.id, { name: 'Empresa B' })
    const departmentA = await createTestDepartment(org.id, { name: 'Depto A' })
    const departmentB = await createTestDepartment(org.id, { name: 'Depto B' })
    const { clientUser: clientUserA, password: passwordA } = await createTestClientUser(org.id, { email: 'cancel-a@test.com' })
    const { clientUser: clientUserB, password: passwordB } = await createTestClientUser(org.id, { email: 'cancel-b@test.com' })
    await grantClientAccess(clientUserA.id, clientA.id, departmentA.id)
    await grantClientAccess(clientUserB.id, clientB.id, departmentB.id)
    const authA = await getAuthHeader(clientUserA.email, passwordA)
    const authB = await getAuthHeader(clientUserB.email, passwordB)

    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authA },
      payload: { clientId: clientA.id, title: 'Da A', departmentId: departmentA.id },
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

describe('GET /portal/os-templates', () => {
  it('retorna apenas templates ativos da organização do cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const otherOrg = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)

    await createOSTemplate(org.id, { name: 'Ativo', isActive: true, columns: [] })
    await createOSTemplate(org.id, { name: 'Inativo', isActive: false, columns: [] })
    await createOSTemplate(otherOrg.id, { name: 'De Outra Org', isActive: true, columns: [] })

    const auth = await getAuthHeader(clientUser.email, password)
    const res = await app.inject({
      method: 'GET',
      url: '/portal/os-templates',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ id: string; name: string }[]>()
    expect(body.map((t) => t.name)).toEqual(['Ativo'])
  })
})

describe('Portal — departamentos e solicitações (só departamento acessível)', () => {
  async function setup() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const staff = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const folha = await createTestDepartment(org.id, { name: 'Folha' })
    await prisma.clientAssignment.createMany({
      data: [
        { clientId: client.id, departmentId: fiscal.id, userId: staff.id },
        { clientId: client.id, departmentId: folha.id, userId: staff.id },
      ],
    })
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, fiscal.id)
    const auth = await getAuthHeader(clientUser.email, password)
    return { org, client, fiscal, folha, auth }
  }

  it('GET /portal/departments exige clientId', async () => {
    const { auth } = await setup()
    const res = await app.inject({ method: 'GET', url: '/portal/departments', headers: { authorization: auth } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('clientId é obrigatório')
  })

  it('GET /portal/departments devolve 404 para empresa sem acesso', async () => {
    const { org, auth } = await setup()
    const other = await createTestClient(org.id)
    const res = await app.inject({
      method: 'GET', url: `/portal/departments?clientId=${other.id}`, headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /portal/departments lista só os departamentos com acesso do usuário naquela empresa', async () => {
    const { client, fiscal, auth } = await setup()
    const res = await app.inject({
      method: 'GET', url: `/portal/departments?clientId=${client.id}`, headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: fiscal.id, name: 'Fiscal' }])
  })

  it('POST /portal/requests sem departmentId → 400', async () => {
    const { client, auth } = await setup()
    const res = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: auth },
      payload: { clientId: client.id, title: 'Pedido' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Selecione o departamento')
  })

  it('POST /portal/requests em departamento sem acesso → 403', async () => {
    const { client, folha, auth } = await setup()
    const res = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: auth },
      payload: { clientId: client.id, title: 'Pedido', departmentId: folha.id },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toBe('Você não tem acesso a este departamento')
  })

  it('POST /portal/requests em departamento com acesso → 201', async () => {
    const { client, fiscal, auth } = await setup()
    const res = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: auth },
      payload: { clientId: client.id, title: 'Pedido', departmentId: fiscal.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().departmentId).toBe(fiscal.id)
  })
})

describe('Portal — solicitações isoladas por departamento', () => {
  async function setup() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const staff = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const folha = await createTestDepartment(org.id, { name: 'Folha' })
    await prisma.clientAssignment.createMany({
      data: [
        { clientId: client.id, departmentId: fiscal.id, userId: staff.id },
        { clientId: client.id, departmentId: folha.id, userId: staff.id },
      ],
    })
    const { clientUser: fiscalUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(fiscalUser.id, client.id, fiscal.id)
    const folhaRequest = await prisma.request.create({
      data: { organizationId: org.id, clientId: client.id, title: 'Rescisão', departmentId: folha.id },
    })
    const fiscalRequest = await prisma.request.create({
      data: { organizationId: org.id, clientId: client.id, title: 'DAS', departmentId: fiscal.id },
    })
    return { client, folhaRequest, fiscalRequest, auth: await getAuthHeader(fiscalUser.email, password) }
  }

  it('a lista só traz solicitações dos departamentos com acesso', async () => {
    const { client, auth } = await setup()
    const res = await app.inject({ method: 'GET', url: `/portal/requests?clientId=${client.id}`, headers: { authorization: auth } })
    expect(res.json().map((r: { title: string }) => r.title)).toEqual(['DAS'])
  })

  it('detalhe, cancelamento e comentários de solicitação de outro departamento → 404', async () => {
    const { folhaRequest, auth } = await setup()
    const detail = await app.inject({ method: 'GET', url: `/portal/requests/${folhaRequest.id}`, headers: { authorization: auth } })
    const cancel = await app.inject({ method: 'PATCH', url: `/portal/requests/${folhaRequest.id}/cancel`, headers: { authorization: auth } })
    const comments = await app.inject({ method: 'GET', url: `/requests/${folhaRequest.id}/comments`, headers: { authorization: auth } })
    const comment = await app.inject({
      method: 'POST', url: `/requests/${folhaRequest.id}/comments`, headers: { authorization: auth }, payload: { content: 'oi' },
    })
    expect([detail.statusCode, cancel.statusCode, comments.statusCode, comment.statusCode]).toEqual([404, 404, 404, 404])
  })
})
