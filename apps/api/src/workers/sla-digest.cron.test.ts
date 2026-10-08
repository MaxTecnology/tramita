import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import { runSlaDigest } from './sla-digest.cron'

vi.mock('@/lib/queue', () => ({ enqueueNotification: vi.fn().mockResolvedValue(undefined) }))

describe('runSlaDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enfileira digest pro assignee quando a task está em alerta', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const assignee = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, assignee.id)

    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + 1) // dentro da janela crítica padrão (1 dia)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate, assigneeId: assignee.id } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SLA_DIGEST', userId: assignee.id }),
    )
  })

  it('não enfileira nada quando nenhuma task está em alerta', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)

    const farDueDate = new Date()
    farDueDate.setUTCDate(farDueDate.getUTCDate() + 60)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: farDueDate } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('não enfileira nada quando slaDigestEnabled está desligado', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.notificationConfig.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, slaDigestEnabled: false },
      update: { slaDigestEnabled: false },
    })
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)

    const dueDate = new Date()
    await prisma.task.update({ where: { id: task.id }, data: { dueDate } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('cai para os admins/managers da org quando a task não tem assignee', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id) // sem assigneeId

    const dueDate = new Date()
    await prisma.task.update({ where: { id: task.id }, data: { dueDate } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SLA_DIGEST', userId: admin.id }),
    )
  })
})
