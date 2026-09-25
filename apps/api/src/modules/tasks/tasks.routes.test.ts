import { describe, it, expect, vi } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  createTestDepartment,
  getAuthHeader,
} from '@/test/helpers'
import { createTemplate, createAssignment } from '@/modules/recurring-templates/recurring-templates.service'
import { runRecurringTasksGeneration } from '@/workers/recurring-tasks.cron'

describe('PATCH /tasks/:id/move', () => {
  it('moves task to a normal column — 200 with columnId updated', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.columnId).toBe(col2.id)
    expect(body.status).toBe('OPEN')
  })

  it('moves task to a column with statusEffect DONE — status becomes DONE', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const finalCol = await createTestColumn(board.id, { position: 1, statusEffect: 'DONE' })
    const task = await createTestTask(col1.id, user.id)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: finalCol.id, position: 0 },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('DONE')
  })

  it('returns 404 when user belongs to a different org (resource isolation)', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const user1 = await createTestUser(org1.id)
    const user2 = await createTestUser(org2.id)
    const client = await createTestClient(org1.id)
    const board = await createTestBoard(org1.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user1.id)

    const auth = await getAuthHeader(user2.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for non-existent task', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: '/tasks/nonexistent-id-00000000/move',
      headers: { authorization: auth },
      payload: { columnId: col.id, position: 0 },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /tasks', () => {
  it('filtra por clientId — só retorna tarefas daquele cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const boardA = await createTestBoard(org.id, clientA.id)
    const boardB = await createTestBoard(org.id, clientB.id)
    const colA = await createTestColumn(boardA.id, { position: 0 })
    const colB = await createTestColumn(boardB.id, { position: 0 })
    const taskA = await createTestTask(colA.id, user.id, { title: 'Tarefa A' })
    await createTestTask(colB.id, user.id, { title: 'Tarefa B' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/tasks?clientId=${clientA.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string }>
    expect(body.map((t) => t.id)).toEqual([taskA.id])
  })

  it('filtra por recurringTemplateId — retorna tarefas recorrentes (board de sistema) de clientes diferentes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Folha mensal', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: clientA.id })
    await createAssignment(template.id, org.id, { clientId: clientB.id })

    const today = new Date(Date.UTC(2026, 0, 20))
    await runRecurringTasksGeneration(today)
    vi.restoreAllMocks()

    const generatedTasks = await prisma.task.findMany({ where: { recurringTemplateId: template.id } })
    expect(generatedTasks).toHaveLength(2)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/tasks?recurringTemplateId=${template.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string; column: { board: { clientId: string } } }>
    expect(body).toHaveLength(2)
    const clientIds = body.map((t) => t.column.board.clientId).sort()
    expect(clientIds).toEqual([clientA.id, clientB.id].sort())
  })

  it('ORG_MEMBER só vê tarefas em que é assigneeId, mesmo sem filtro explícito', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const otherUser = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const ownTask = await createTestTask(col.id, otherUser.id, { title: 'Minha tarefa' })
    await prisma.task.update({ where: { id: ownTask.id }, data: { assigneeId: member.id } })
    const othersTask = await createTestTask(col.id, otherUser.id, { title: 'Tarefa de outro' })
    await prisma.task.update({ where: { id: othersTask.id }, data: { assigneeId: otherUser.id } })

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string }>
    expect(body.map((t) => t.id)).toEqual([ownTask.id])
  })

  it('combina filtros status + departmentId', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const deptA = await createTestDepartment(org.id, { name: 'Fiscal' })
    const deptB = await createTestDepartment(org.id, { name: 'Pessoal' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const match = await createTestTask(col.id, user.id, { title: 'Match', departmentId: deptA.id })
    await prisma.task.update({ where: { id: match.id }, data: { status: 'BLOCKED' } })

    const wrongStatus = await createTestTask(col.id, user.id, { title: 'Wrong status', departmentId: deptA.id })
    await prisma.task.update({ where: { id: wrongStatus.id }, data: { status: 'OPEN' } })

    const wrongDept = await createTestTask(col.id, user.id, { title: 'Wrong dept', departmentId: deptB.id })
    await prisma.task.update({ where: { id: wrongDept.id }, data: { status: 'BLOCKED' } })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/tasks?status=BLOCKED&departmentId=${deptA.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string }>
    expect(body.map((t) => t.id)).toEqual([match.id])
  })

  it('respeita o parâmetro limit e nunca excede o teto máximo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    for (let i = 0; i < 5; i++) {
      await createTestTask(col.id, user.id, { title: `Tarefa ${i}` })
    }

    const auth = await getAuthHeader(user.email, 'Test@1234')

    const limited = await app.inject({
      method: 'GET',
      url: '/tasks?limit=2',
      headers: { authorization: auth },
    })
    expect(limited.statusCode).toBe(200)
    expect((JSON.parse(limited.body) as unknown[]).length).toBe(2)

    const overCap = await app.inject({
      method: 'GET',
      url: '/tasks?limit=9999',
      headers: { authorization: auth },
    })
    expect(overCap.statusCode).toBe(400)
  })
})
