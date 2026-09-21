import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getDashboardMetrics } from '@/modules/dashboard/dashboard.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'

describe('getDashboardMetrics', () => {
  it('returns zeroed metrics for an organization with no boards', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await getDashboardMetrics(org.id)

    expect(result.kpis).toEqual({
      activeBoards: 0,
      overdueBoards: 0,
      completedTasksThisMonth: 0,
      urgentOpenTasks: 0,
    })
    expect(result.tasksByStatus).toEqual({ OPEN: 0, BLOCKED: 0, DONE: 0, DISREGARDED: 0 })
    expect(result.atRisk).toEqual([])
  })

  it('counts only active boards belonging to the organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const clientA = await createTestClient(orgA.id)
    await createTestBoard(orgA.id, clientA.id)
    const clientB = await createTestClient(orgB.id)
    await createTestBoard(orgB.id, clientB.id)

    const result = await getDashboardMetrics(orgA.id)

    expect(result.kpis.activeBoards).toBe(1)
  })

  it('flags a board as overdue when it has a task past its dueDate and not DONE/CANCELLED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })

    const result = await getDashboardMetrics(org.id)

    expect(result.kpis.overdueBoards).toBe(1)
  })

  it('does not count a board as overdue when its only overdue task is DONE', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000), status: 'DONE' },
    })

    const result = await getDashboardMetrics(org.id)

    expect(result.kpis.overdueBoards).toBe(0)
  })

  it('counts tasks completed this month and urgent open tasks', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const done = await createTestTask(col.id, user.id, { position: 0 })
    await prisma.task.update({ where: { id: done.id }, data: { status: 'DONE' } })

    await createTestTask(col.id, user.id, { position: 1, priority: 'URGENT' })

    const result = await getDashboardMetrics(org.id)

    expect(result.kpis.completedTasksThisMonth).toBe(1)
    expect(result.kpis.urgentOpenTasks).toBe(1)
  })

  it('groups tasks by status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const t1 = await createTestTask(col.id, user.id, { position: 0 })
    const t2 = await createTestTask(col.id, user.id, { position: 1 })
    await prisma.task.update({ where: { id: t2.id }, data: { status: 'BLOCKED' } })
    void t1

    const result = await getDashboardMetrics(org.id)

    expect(result.tasksByStatus.OPEN).toBe(1)
    expect(result.tasksByStatus.BLOCKED).toBe(1)
  })

  it('sorts atRisk boards by daysOverdue descending (most overdue first)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)

    const boardSoon = await createTestBoard(org.id, client.id)
    const colSoon = await createTestColumn(boardSoon.id, { position: 0 })
    const taskSoon = await createTestTask(colSoon.id, user.id)
    await prisma.task.update({
      where: { id: taskSoon.id },
      data: { dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    })

    const boardOld = await createTestBoard(org.id, client.id)
    const colOld = await createTestColumn(boardOld.id, { position: 0 })
    const taskOld = await createTestTask(colOld.id, user.id)
    await prisma.task.update({
      where: { id: taskOld.id },
      data: { dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    })

    const result = await getDashboardMetrics(org.id)

    expect(result.atRisk[0].boardId).toBe(boardOld.id)
    expect(result.atRisk[0].daysOverdue).toBeGreaterThanOrEqual(result.atRisk[1].daysOverdue)
  })

  it('caps atRisk at 8 boards', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)

    for (let i = 0; i < 10; i++) {
      const board = await createTestBoard(org.id, client.id)
      const col = await createTestColumn(board.id, { position: 0 })
      const task = await createTestTask(col.id, user.id)
      await prisma.task.update({
        where: { id: task.id },
        data: { dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      })
    }

    const result = await getDashboardMetrics(org.id)

    expect(result.atRisk.length).toBeLessThanOrEqual(8)
  })
})
