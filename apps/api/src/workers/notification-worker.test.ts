// apps/api/src/workers/notification-worker.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { processNotificationJob } from '@/workers/notification.worker'
import * as maximizebot from '@/lib/maximizebot'
import * as mailer from '@/lib/mailer'
import * as encryption from '@/lib/encryption'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import type { NotificationJob } from '@/lib/queue'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/maximizebot')
vi.mock('@/lib/mailer')
vi.mock('@/lib/encryption')

type JobInput = { data: NotificationJob }

describe('processNotificationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(encryption.decrypt).mockImplementation((encoded) => encoded)
  })

  it('does not send and creates no log when event is disabled in config', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Teste',
        email: `worker-client-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pass', 4),
        whatsapp: '5582999990001',
        organizationId: org.id,
      },
    })
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        taskMoved: false,
        whatsappEnabled: true,
        maximizebotToken: 'Bearer token',
      },
    })

    const job: JobInput = {
      data: {
        event: 'TASK_MOVED',
        taskId: task.id,
        organizationId: org.id,
        clientId: client.id,
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    }

    await processNotificationJob(job)

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(0)
  })

  it('creates NotificationLog with status FAILED when sendWhatsApp throws', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Falha',
        email: `worker-fail-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pass', 4),
        whatsapp: '5582999990002',
        organizationId: org.id,
      },
    })
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        taskMoved: true,
        whatsappEnabled: true,
        maximizebotToken: 'Bearer token',
      },
    })

    vi.mocked(maximizebot.sendWhatsApp).mockRejectedValue(new Error('API error'))

    const job: JobInput = {
      data: {
        event: 'TASK_MOVED',
        taskId: task.id,
        organizationId: org.id,
        clientId: client.id,
        metadata: { taskTitle: task.title, fromColumn: 'Backlog', toColumn: 'Em Revisão' },
      },
    }

    await processNotificationJob(job)

    const log = await prisma.notificationLog.findFirst()
    expect(log?.status).toBe('FAILED')
    expect(log?.error).toBe('API error')
  })

  it('finishes silently when org has no NotificationConfig', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Sem Config',
        email: `worker-noconf-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pass', 4),
        organizationId: org.id,
      },
    })
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const job: JobInput = {
      data: {
        event: 'TASK_MOVED',
        taskId: task.id,
        organizationId: org.id,
        clientId: client.id,
        metadata: { taskTitle: task.title },
      },
    }

    await expect(processNotificationJob(job)).resolves.toBeUndefined()
    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
  })

  it('REQUEST_CREATED envia email para destinatário USER e grava log sem clientId', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        requestCreated: true,
        emailEnabled: true,
        smtpHost: 'smtp.test.com',
        smtpPort: 587,
        smtpUser: 'test@test.com',
        smtpPass: 'encrypted-or-plain-for-test',
        emailFrom: 'Escritório <noreply@test.com>',
      },
    })

    const job: JobInput = {
      data: {
        event: 'REQUEST_CREATED',
        organizationId: org.id,
        recipientType: 'USER',
        userId: admin.id,
        metadata: { clientName: 'João Silva', requestTitle: 'Abertura de empresa' },
      },
    }

    await processNotificationJob(job)

    expect(mailer.sendEmail).toHaveBeenCalledTimes(1)
    const log = await prisma.notificationLog.findFirst()
    expect(log?.channel).toBe('EMAIL')
    expect(log?.recipient).toBe(admin.email)
    expect(log?.clientId).toBeNull()
  })

  it('REQUEST_CREATED não envia quando requestCreated está desabilitado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    await prisma.notificationConfig.create({
      data: { organizationId: org.id, requestCreated: false, emailEnabled: true },
    })

    const job: JobInput = {
      data: {
        event: 'REQUEST_CREATED',
        organizationId: org.id,
        recipientType: 'USER',
        userId: admin.id,
        metadata: { clientName: 'João Silva', requestTitle: 'Abertura de empresa' },
      },
    }

    await processNotificationJob(job)

    expect(mailer.sendEmail).not.toHaveBeenCalled()
  })
})
