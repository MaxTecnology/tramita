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

describe('processNotificationJob — TASK_BLOCKED respeita config.taskBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setupTaskBlocked(taskBlocked: boolean) {
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
        taskBlocked,
        maximizebotToken: 'Bearer fake-token',
      },
    })

    return { org, client, task }
  }

  it('envia TASK_BLOCKED quando config.taskBlocked está ligado', async () => {
    const { org, client, task } = await setupTaskBlocked(true)

    await processNotificationJob({
      data: { event: 'TASK_BLOCKED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    expect(maximizebot.sendWhatsApp).toHaveBeenCalledTimes(1)
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_BLOCKED' } })
    expect(logs.some((l) => l.channel === 'WHATSAPP' && l.status === 'SENT')).toBe(true)
  })

  it('não envia nada quando config.taskBlocked está desligado — nunca usa forceChannels pra contornar', async () => {
    const { org, client, task } = await setupTaskBlocked(false)

    await processNotificationJob({
      data: { event: 'TASK_BLOCKED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_BLOCKED' } })
    expect(logs).toHaveLength(0)
  })
})

describe('processNotificationJob — WhatsApp respeita visibleToClient (igual ao branch de EMAIL)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('não envia WhatsApp pra uma tarefa marcada como controle interno (visibleToClient=false)', async () => {
    const { org, client, task } = await setup(true)
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await processNotificationJob({
      data: {
        event: 'TASK_MOVED',
        organizationId: org.id,
        clientId: client.id,
        taskId: task.id,
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    })

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_MOVED', channel: 'WHATSAPP' } })
    expect(logs).toHaveLength(0)
  })

  it('envia WhatsApp normalmente quando visibleToClient=true (comportamento preservado)', async () => {
    const { org, client, task } = await setup(true)

    await processNotificationJob({
      data: {
        event: 'TASK_MOVED',
        organizationId: org.id,
        clientId: client.id,
        taskId: task.id,
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    })

    expect(maximizebot.sendWhatsApp).toHaveBeenCalledTimes(1)
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_MOVED', channel: 'WHATSAPP' } })
    expect(logs.some((l) => l.status === 'SENT')).toBe(true)
  })
})
