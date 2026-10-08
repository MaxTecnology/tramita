// apps/api/src/modules/dashboard/dashboard.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, getAuthHeader,
  createTestClient, createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

describe('GET /dashboard/productivity', () => {
  it('ORG_MEMBER não consegue ver produtividade de outro usuário mesmo passando o userId dele', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const me = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const colleague = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(me.email, 'Test@1234')
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, colleague.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date(), assigneeId: colleague.id } })

    const res = await app.inject({
      method: 'GET',
      url: `/dashboard/productivity?from=2020-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z&userId=${colleague.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.byPerson.find((p: { userId: string }) => p.userId === colleague.id)).toBeUndefined()
  })

  it('ORG_ADMIN consegue filtrar por outro usuário normalmente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, member.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date(), assigneeId: member.id } })

    const res = await app.inject({
      method: 'GET',
      url: `/dashboard/productivity?from=2020-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z&userId=${member.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.byPerson.find((p: { userId: string }) => p.userId === member.id)).toBeDefined()
  })
})
