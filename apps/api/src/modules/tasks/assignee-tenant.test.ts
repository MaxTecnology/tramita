import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment,
  createTestBoard, createTestColumn, createTestTask, getAuthHeader,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const other = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const outsider = await createTestUser(other.id, { role: 'ORG_ADMIN' })
  const former = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  await prisma.user.update({ where: { id: former.id }, data: { isActive: false } })
  const department = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, department.id, admin.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id, { position: 0 })
  const task = await createTestTask(column.id, admin.id, { departmentId: department.id })
  return { admin, outsider, former, department, client, board, column, task, auth: await getAuthHeader(admin.email, 'Test@1234') }
}

describe('responsável precisa ser da equipe ativa do mesmo escritório', () => {
  it('a task cannot be given to someone of another office or to a deactivated person', async () => {
    const c = await setup()
    for (const assigneeId of [c.outsider.id, c.former.id]) {
      const edit = await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.auth }, payload: { assigneeId } })
      expect(edit.statusCode).toBe(404)
      const create = await app.inject({ method: 'POST', url: `/columns/${c.column.id}/tasks`, headers: { authorization: c.auth }, payload: { title: 'Nova', departmentId: c.department.id, assigneeId } })
      expect(create.statusCode).toBe(404)
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })).assigneeId).not.toBe(c.outsider.id)
    expect(await prisma.inAppNotification.count({ where: { recipientUserId: c.outsider.id } })).toBe(0)
  })

  it('a process cannot have a responsible of another office or a deactivated person', async () => {
    const c = await setup()
    for (const responsibleUserId of [c.outsider.id, c.former.id]) {
      const edit = await app.inject({ method: 'PATCH', url: `/boards/${c.board.id}`, headers: { authorization: c.auth }, payload: { responsibleUserId } })
      expect(edit.statusCode).toBe(404)
      const create = await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, responsibleUserId } })
      expect(create.statusCode).toBe(404)
    }
  })

  it('a colleague of the same office is still accepted', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.auth }, payload: { assigneeId: c.admin.id } })
    expect(res.statusCode).toBe(200)
  })
})
