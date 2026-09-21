import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getBoardById } from './boards.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

describe('getBoardById (visibilidade)', () => {
  it('esconde tarefas com visibleToClient=false quando hideInvisibleTasks=true', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const visibleTask = await createTestTask(col.id, user.id)
    const hiddenTask = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: hiddenTask.id }, data: { visibleToClient: false } })

    const asClient = await getBoardById(board.id, org.id, true)
    const taskIdsAsClient = asClient.columns.flatMap((c) => c.tasks).map((t) => t.id)
    expect(taskIdsAsClient).toContain(visibleTask.id)
    expect(taskIdsAsClient).not.toContain(hiddenTask.id)

    const asOrg = await getBoardById(board.id, org.id, false)
    const taskIdsAsOrg = asOrg.columns.flatMap((c) => c.tasks).map((t) => t.id)
    expect(taskIdsAsOrg).toContain(hiddenTask.id)
  })

  it('lança 404 quando um cliente tenta acessar o board de outro cliente na mesma org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const boardOfB = await createTestBoard(org.id, clientB.id)

    await expect(
      getBoardById(boardOfB.id, org.id, false, clientA.id),
    ).rejects.toMatchObject({ statusCode: 404 })

    // O próprio cliente B consegue acessar o próprio board normalmente
    await expect(
      getBoardById(boardOfB.id, org.id, true, clientB.id),
    ).resolves.toBeDefined()
  })
})
