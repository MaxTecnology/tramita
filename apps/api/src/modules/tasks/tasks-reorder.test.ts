import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn, createTestTask, getAuthHeader } from '@/test/helpers'

const enqueued: { event: string }[] = []
beforeEach(() => {
  enqueued.length = 0
  vi.spyOn(queue, 'enqueueNotification').mockImplementation(async (job) => { enqueued.push(job) })
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const board = await createTestBoard(org.id, (await createTestClient(org.id)).id)
  const todo = await createTestColumn(board.id, { position: 0 })
  const doing = await createTestColumn(board.id, { position: 1 })
  const mk = (col: string, title: string, position: number) => createTestTask(col, admin.id, { title, position })
  const [a, b, c] = [await mk(todo.id, 'A', 0), await mk(todo.id, 'B', 1), await mk(todo.id, 'C', 2)]
  const [x, y] = [await mk(doing.id, 'X', 0), await mk(doing.id, 'Y', 1)]
  return { auth: await getAuthHeader(admin.email, 'Test@1234'), todo, doing, a, b, c, x, y }
}
const order = async (columnId: string) =>
  (await prisma.task.findMany({ where: { columnId }, orderBy: { position: 'asc' }, select: { title: true, position: true } }))
const move = (auth: string, id: string, columnId: string, position: number) =>
  app.inject({ method: 'PATCH', url: `/tasks/${id}/move`, headers: { authorization: auth }, payload: { columnId, position } })

describe('ordem das tarefas no quadro', () => {
  it('moving inside the same column reorders it, without history nor notice to the client', async () => {
    const s = await setup()
    expect((await move(s.auth, s.c.id, s.todo.id, 0)).statusCode).toBe(200)
    expect(await order(s.todo.id)).toEqual([{ title: 'C', position: 0 }, { title: 'A', position: 1 }, { title: 'B', position: 2 }])
    expect(await prisma.taskHistory.count({ where: { taskId: s.c.id, action: 'moved_to' } })).toBe(0)
    expect(enqueued.filter((j) => j.event === 'TASK_MOVED')).toHaveLength(0)
  })

  it('moving to another column puts the task where it was dropped', async () => {
    const s = await setup()
    expect((await move(s.auth, s.a.id, s.doing.id, 1)).statusCode).toBe(200)
    expect((await order(s.doing.id)).map((t) => t.title)).toEqual(['X', 'A', 'Y'])
    expect((await order(s.doing.id)).map((t) => t.position)).toEqual([0, 1, 2])
    expect((await order(s.todo.id)).map((t) => t.title)).toEqual(['B', 'C'])
    expect(enqueued.filter((j) => j.event === 'TASK_MOVED')).toHaveLength(1)
  })

  it('a position past the end means the end', async () => {
    const s = await setup()
    await move(s.auth, s.a.id, s.todo.id, 99)
    expect((await order(s.todo.id)).map((t) => t.title)).toEqual(['B', 'C', 'A'])
  })
})
