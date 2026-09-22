import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as maximizebot from '@/lib/maximizebot'
import * as mailer from '@/lib/mailer'
import { processNotificationJob } from '@/workers/notification.worker'
import type { NotificationJob } from '@/lib/queue'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'

vi.mock('@/lib/maximizebot', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/mailer', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))

async function setup(taskMoved: boolean) {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const client = await createTestClient(org.id)
  await prisma.client.update({ where: { id: client.id }, data: { whatsapp: '5511999999999' } })
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, user.id)

  await prisma.notificationConfig.create({
    data: {
      organizationId: org.id,
      whatsappEnabled: true,
      emailEnabled: true,
      taskMoved,
      maximizebotToken: 'Bearer fake-token',
    },
  })

  return { org, client, task }
}

describe('processNotificationJob — Column.notifyClient forceChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends TASK_MOVED even when config.taskMoved is off, when forceChannels is present', async () => {
    const { org, client, task } = await setup(false)

    const job: { data: NotificationJob } = {
      data: {
        event: 'TASK_MOVED',
        organizationId: org.id,
        clientId: client.id,
        taskId: task.id,
        forceChannels: ['WHATSAPP', 'EMAIL'],
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    }

    await processNotificationJob(job)

    expect(maximizebot.sendWhatsApp).toHaveBeenCalledTimes(1)
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_MOVED' } })
    expect(logs.some((l) => l.channel === 'WHATSAPP' && l.status === 'SENT')).toBe(true)
  })

  it('does nothing for TASK_MOVED when config.taskMoved is off and no forceChannels is present (no behavior change)', async () => {
    const { org, client, task } = await setup(false)

    const job: { data: NotificationJob } = {
      data: {
        event: 'TASK_MOVED',
        organizationId: org.id,
        clientId: client.id,
        taskId: task.id,
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    }

    await processNotificationJob(job)

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_MOVED' } })
    expect(logs).toHaveLength(0)
  })

  it('still sends TASK_MOVED normally when config.taskMoved is on (existing behavior preserved)', async () => {
    const { org, client, task } = await setup(true)

    const job: { data: NotificationJob } = {
      data: {
        event: 'TASK_MOVED',
        organizationId: org.id,
        clientId: client.id,
        taskId: task.id,
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    }

    await processNotificationJob(job)

    expect(maximizebot.sendWhatsApp).toHaveBeenCalledTimes(1)
  })
})
