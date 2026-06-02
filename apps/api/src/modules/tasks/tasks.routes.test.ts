import { describe, it, expect } from 'vitest'
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

  it('moves task to isFinal column — status becomes DONE', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const finalCol = await createTestColumn(board.id, { position: 1, isFinal: true })
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
