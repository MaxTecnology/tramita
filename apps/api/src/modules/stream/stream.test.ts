import { describe, it, expect, vi, afterEach } from 'vitest'
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
import { redis } from '@/lib/redis'
import { moveTask } from '@/modules/tasks/tasks.service'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SSE — event emission', () => {
  it('publishes task:moved event to board Redis channel after moveTask', async () => {
    const publishSpy = vi.spyOn(redis, 'publish').mockResolvedValue(0 as unknown as number)

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, { id: user.id, type: 'user' })

    expect(publishSpy).toHaveBeenCalledWith(
      `board:${board.id}`,
      expect.stringContaining('"task:moved"'),
    )
  })
})

describe('GET /boards/:id/stream', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/boards/xxx/stream' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/boards/xxx/stream?token=invalid-token',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for non-existent board with valid token', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const authHeader = await getAuthHeader(user.email, 'Test@1234')
    const token = authHeader.replace('Bearer ', '')

    const res = await app.inject({
      method: 'GET',
      url: `/boards/nonexistent-board-id/stream?token=${token}`,
    })
    expect(res.statusCode).toBe(404)
  })
})
