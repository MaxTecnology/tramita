import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  moveTask,
  createTask,
  updateTask,
  reorderTasks,
  deleteTask,
  getTaskHistory,
} from '@/modules/tasks/tasks.service'
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

describe('createTask', () => {
  it('creates a task at the next position and records TaskHistory "created"', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id, { position: 0 })
    const department = await createTestDepartment(org.id)

    const task = await createTask(col.id, org.id, {
      title: 'Nova tarefa', priority: 'HIGH', tags: [], departmentId: department.id,
    }, { id: user.id, type: 'user' })

    expect(task.position).toBe(1)
    const history = await prisma.taskHistory.findFirst({ where: { taskId: task.id } })
    expect(history?.action).toBe('created')
    expect(history?.toValue).toBe('Nova tarefa')
  })

  it('throws 404 when column belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const department = await createTestDepartment(orgA.id)

    await expect(
      createTask(
        col.id,
        orgB.id,
        { title: 'X', priority: 'MEDIUM', tags: [], departmentId: department.id },
        { id: user.id, type: 'user' },
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when departmentId belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const departmentOfB = await createTestDepartment(orgB.id)

    await expect(
      createTask(
        col.id,
        orgA.id,
        { title: 'X', priority: 'MEDIUM', tags: [], departmentId: departmentOfB.id },
        { id: user.id, type: 'user' },
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateTask', () => {
  it('records priority_changed history only when priority actually changes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { priority: 'LOW' })

    await updateTask(task.id, org.id, { priority: 'URGENT' }, { id: user.id, type: 'user' })

    const history = await prisma.taskHistory.findFirst({
      where: { taskId: task.id, action: 'priority_changed' },
    })
    expect(history?.fromValue).toBe('LOW')
    expect(history?.toValue).toBe('URGENT')
  })

  it('does not record history when priority is unchanged', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { priority: 'LOW' })

    await updateTask(task.id, org.id, { priority: 'LOW' }, { id: user.id, type: 'user' })

    const history = await prisma.taskHistory.findFirst({
      where: { taskId: task.id, action: 'priority_changed' },
    })
    expect(history).toBeNull()
  })

  it('clears dueDate when explicitly set to null', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date() } })

    const result = await updateTask(task.id, org.id, { dueDate: null }, { id: user.id, type: 'user' })

    expect(result.dueDate).toBeNull()
  })

  it('throws 404 when task belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await expect(
      updateTask(task.id, orgB.id, { title: 'X' }, { id: user.id, type: 'user' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when departmentId belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const departmentOfB = await createTestDepartment(orgB.id)

    await expect(
      updateTask(task.id, orgA.id, { departmentId: departmentOfB.id }, { id: user.id, type: 'user' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('reorderTasks', () => {
  it('updates position and columnId for each task', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const taskA = await createTestTask(col.id, user.id, { position: 0 })
    const taskB = await createTestTask(col.id, user.id, { position: 1 })

    const result = await reorderTasks(
      [
        { id: taskA.id, position: 1, columnId: col.id },
        { id: taskB.id, position: 0, columnId: col.id },
      ],
      org.id,
    )

    expect(result.ok).toBe(true)
    const updatedA = await prisma.task.findUnique({ where: { id: taskA.id } })
    expect(updatedA?.position).toBe(1)
  })

  it('throws 403 when any task belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const userA = await createTestUser(orgA.id)
    const clientA = await createTestClient(orgA.id)
    const boardA = await createTestBoard(orgA.id, clientA.id)
    const colA = await createTestColumn(boardA.id, { position: 0 })
    const taskA = await createTestTask(colA.id, userA.id)

    await expect(
      reorderTasks([{ id: taskA.id, position: 0, columnId: colA.id }], orgB.id),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('deleteTask', () => {
  it('removes the task row', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const result = await deleteTask(task.id, org.id)

    expect(result.ok).toBe(true)
    const stored = await prisma.task.findUnique({ where: { id: task.id } })
    expect(stored).toBeNull()
  })

  it('throws 404 when task belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await expect(deleteTask(task.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('getTaskHistory', () => {
  it('returns history entries ordered by most recent first', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { title: 'A', position: 0 })
    const col2 = await createTestColumn(board.id, { title: 'B', position: 1 })
    const task = await createTestTask(col1.id, user.id)
    await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, { id: user.id, type: 'user' })

    const history = await getTaskHistory(task.id, org.id)

    expect(history.length).toBeGreaterThan(0)
    expect(history[0].action).toBe('moved_to')
  })

  it('throws 404 when task belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await expect(getTaskHistory(task.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateTask (status)', () => {
  it('atualiza status e registra TaskHistory status_changed', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const updated = await updateTask(task.id, org.id, { status: 'DISREGARDED' }, { id: user.id, type: 'user' })
    expect(updated.status).toBe('DISREGARDED')

    const history = await prisma.taskHistory.findMany({ where: { taskId: task.id, action: 'status_changed' } })
    expect(history).toHaveLength(1)
    expect(history[0].fromValue).toBe('OPEN')
    expect(history[0].toValue).toBe('DISREGARDED')
  })

  it('não registra histórico quando status não muda', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await updateTask(task.id, org.id, { status: 'OPEN' }, { id: user.id, type: 'user' })

    const history = await prisma.taskHistory.findMany({ where: { taskId: task.id, action: 'status_changed' } })
    expect(history).toHaveLength(0)
  })
})
