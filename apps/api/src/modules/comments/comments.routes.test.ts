import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

describe('POST /tasks/:taskId/comments', () => {
  it('creates comment with authorType USER when JWT is from ORG_MEMBER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Comentário do usuário interno' },
    })

    expect(res.statusCode).toBe(201)
    const comment = await prisma.comment.findFirst({ where: { taskId: task.id } })
    expect(comment?.authorType).toBe('USER')
    expect(comment?.userId).toBe(user.id)
    expect(comment?.clientId).toBeNull()
  })

  it('creates comment with authorType CLIENT when JWT is from CLIENT', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Comentário do cliente final' },
    })

    expect(res.statusCode).toBe(201)
    const comment = await prisma.comment.findFirst({ where: { taskId: task.id } })
    expect(comment?.authorType).toBe('CLIENT')
    expect(comment?.clientId).toBe(client.id)
    expect(comment?.userId).toBeNull()
  })

  it('returns 404 when CLIENT tries to comment on task from another org', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const userOrg1 = await createTestUser(org1.id)
    const clientOrg1 = await createTestClient(org1.id)
    const clientOrg2 = await createTestClient(org2.id)
    const board = await createTestBoard(org1.id, clientOrg1.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, userOrg1.id)

    const auth = await getAuthHeader(clientOrg2.email, 'Client@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Tentativa cross-org' },
    })

    expect(res.statusCode).toBe(404)
  })
})
