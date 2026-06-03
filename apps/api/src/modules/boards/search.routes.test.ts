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

describe('GET /boards/:id/tasks/search', () => {
  it('returns tasks matching title query', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id, { title: 'Abertura LTDA' })
    await createTestTask(col.id, user.id, { title: 'Encerramento SA' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}/tasks/search?q=Abertura`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const tasks = JSON.parse(res.body)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Abertura LTDA')
  })

  it('filters by priority', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id, { priority: 'HIGH' })
    await createTestTask(col.id, user.id, { priority: 'LOW' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}/tasks/search?priority=HIGH`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const tasks = JSON.parse(res.body)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].priority).toBe('HIGH')
  })

  it('returns only tasks from the authenticated user org', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const user1 = await createTestUser(org1.id)
    const user2 = await createTestUser(org2.id)
    const client1 = await createTestClient(org1.id)
    const board1 = await createTestBoard(org1.id, client1.id)
    const col1 = await createTestColumn(board1.id, { position: 0 })
    await createTestTask(col1.id, user1.id, { title: 'Tarefa Org1' })

    const auth2 = await getAuthHeader(user2.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board1.id}/tasks/search?q=Tarefa`,
      headers: { authorization: auth2 },
    })

    expect(res.statusCode).toBe(404)
  })
})
