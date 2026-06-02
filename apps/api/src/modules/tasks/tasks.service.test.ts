import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { moveTask } from '@/modules/tasks/tasks.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'

describe('moveTask', () => {
  it('updates columnId and position', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const result = await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    expect(result.columnId).toBe(col2.id)
    expect(result.position).toBe(0)
  })

  it('records TaskHistory with action moved_to, fromValue and toValue', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { title: 'Backlog', position: 0 })
    const col2 = await createTestColumn(board.id, { title: 'Em Revisão', position: 1 })
    const task = await createTestTask(col1.id, user.id)

    await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    const history = await prisma.taskHistory.findFirst({ where: { taskId: task.id } })
    expect(history?.action).toBe('moved_to')
    expect(history?.fromValue).toBe('Backlog')
    expect(history?.toValue).toBe('Em Revisão')
  })

  it('sets status DONE when target column isFinal is true', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const finalCol = await createTestColumn(board.id, { position: 1, isFinal: true })
    const task = await createTestTask(col1.id, user.id)

    const result = await moveTask(task.id, org.id, { columnId: finalCol.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    expect(result.status).toBe('DONE')
  })

  it('keeps status OPEN when target column isFinal is false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const result = await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    expect(result.status).toBe('OPEN')
  })
})
