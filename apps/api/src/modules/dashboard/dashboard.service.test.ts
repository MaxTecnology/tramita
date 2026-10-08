import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getDashboardMetrics, getTeamMembers, getProductivityMetrics } from '@/modules/dashboard/dashboard.service'
import { ensureRecurringSystemBoard } from '@/modules/tasks/tasks.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  createTestDepartment,
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
    expect(result.tasksByStatus).toEqual({ OPEN: 0, STARTED: 0, BLOCKED: 0, DONE: 0, DISREGARDED: 0 })
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

  it('counts tasks living on the RECURRING_SYSTEM board in tasksByStatus and completedTasksThisMonth, but not in activeBoards/overdueBoards', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)

    const systemBoard = await ensureRecurringSystemBoard(client.id, org.id)
    await createTestTask(systemBoard.columns[0].id, user.id)
    const doneTask = await createTestTask(systemBoard.columns[0].id, user.id)
    await prisma.task.update({ where: { id: doneTask.id }, data: { status: 'DONE' } })

    const result = await getDashboardMetrics(org.id)

    // The system board itself must never count as a "processo" for the org.
    expect(result.kpis.activeBoards).toBe(0)
    expect(result.kpis.overdueBoards).toBe(0)
    // But the tasks that live on it are real work and must show up in task-level aggregates.
    expect(result.kpis.completedTasksThisMonth).toBe(1)
    expect(result.tasksByStatus.OPEN).toBe(1)
    expect(result.tasksByStatus.DONE).toBe(1)
  })
})

describe('getTeamMembers', () => {
  it('lista id e nome dos usuários ativos da organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const result = await getTeamMembers(org.id)

    expect(result).toEqual([{ id: user.id, name: user.name }])
  })

  it('não inclui usuário de outra organização', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    await createTestUser(orgB.id)

    const result = await getTeamMembers(orgA.id)

    expect(result).toEqual([])
  })
})

describe('getProductivityMetrics', () => {
  it('retorna zerado quando não há nenhuma tarefa no período', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await getProductivityMetrics(org.id, {
      from: new Date('2026-01-01'), to: new Date('2026-01-31'),
    })

    expect(result.byPerson).toEqual([])
    expect(result.byDepartment).toEqual([])
  })

  it('conta volume e cumprimento de vencimento de uma tarefa OS concluída dentro do prazo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    const dueDate = new Date('2026-06-20T00:00:00Z')
    const completedAt = new Date('2026-06-15T00:00:00Z') // antes do vencimento
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE', dueDate, completedAt, assigneeId: user.id } })

    const result = await getProductivityMetrics(org.id, {
      from: new Date('2026-06-01'), to: new Date('2026-06-30'),
    })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.volume.os).toBe(1)
    expect(person.onTimeRate.due).toEqual({ onTime: 1, late: 0, applicable: 1 })
  })

  it('não conta meta (targetDate) no denominador quando a tarefa nunca teve targetDate (task OS comum)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'DONE', completedAt: new Date('2026-06-15'), assigneeId: user.id, targetDate: null },
    })

    const result = await getProductivityMetrics(org.id, { from: new Date('2026-06-01'), to: new Date('2026-06-30') })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.onTimeRate.target.applicable).toBe(0)
  })

  it('conta tarefa ainda BLOCKED (sem evento de saída) até "agora" no tempo de impedimento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'BLOCKED', assigneeId: user.id } })
    const blockedSince = new Date()
    blockedSince.setUTCDate(blockedSince.getUTCDate() - 3)
    await prisma.taskHistory.create({
      data: {
        taskId: task.id, action: 'status_changed', fromValue: 'OPEN', toValue: 'BLOCKED',
        actorType: 'user', actorId: user.id, actorName: user.name, createdAt: blockedSince,
      },
    })

    const from = new Date()
    from.setUTCDate(from.getUTCDate() - 30)
    const result = await getProductivityMetrics(org.id, { from, to: new Date() })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.blocked.taskCount).toBe(1)
    expect(person.blocked.totalDays).toBeGreaterThanOrEqual(2) // ~3 dias, com margem de arredondamento
  })

  it('ORG_MEMBER filtrando por departamento com outro colega só vê a própria linha (aplicado via userId forçado)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const me = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const colleague = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    await createTestTask(column.id, me.id, { departmentId: dept.id })
    await createTestTask(column.id, colleague.id, { departmentId: dept.id })

    const result = await getProductivityMetrics(org.id, {
      from: new Date('2020-01-01'), to: new Date('2030-01-01'),
      departmentId: dept.id, userId: me.id,
    })

    expect(result.byPerson.every((p) => p.userId === me.id)).toBe(true)
  })

  it('não acusa fechamento tardio quando a tarefa foi concluída sem nenhum evento de histórico anterior', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'DONE', completedAt: new Date(), assigneeId: user.id },
    })

    const from = new Date()
    from.setUTCDate(from.getUTCDate() - 1)
    const result = await getProductivityMetrics(org.id, { from, to: new Date() })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.lateClosureCount).toBe(0)
  })
})
