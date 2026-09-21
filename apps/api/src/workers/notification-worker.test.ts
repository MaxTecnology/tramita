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
  createTestClient,
  createTestClientUser,
  grantClientAccess,
  createTestDepartment,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import type { NotificationJob } from '@/lib/queue'

type JobInput = { data: NotificationJob }

describe('processNotificationJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(encryption, 'decrypt').mockImplementation((encoded) => encoded)
    vi.spyOn(maximizebot, 'sendWhatsApp').mockResolvedValue(undefined)
    vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined)
  })

  it('does not send and creates no log when event is disabled in config', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id, { name: 'Cliente Teste' })
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
    const client = await createTestClient(org.id, { name: 'Cliente Falha' })
    await prisma.client.update({ where: { id: client.id }, data: { whatsapp: '5582999990002' } })
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
    const client = await createTestClient(org.id, { name: 'Cliente Sem Config' })
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

  it('TASK_MOVED envia email para cada ClientUser com acesso à empresa, não pro e-mail único antigo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id, { name: 'Cliente Multi-usuário' })
    const department = await createTestDepartment(org.id)
    const { clientUser: clientUserA } = await createTestClientUser(org.id, { email: 'a@test.com' })
    const { clientUser: clientUserB } = await createTestClientUser(org.id, { email: 'b@test.com' })
    await grantClientAccess(clientUserA.id, client.id, department.id)
    await grantClientAccess(clientUserB.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })

    await prisma.notificationConfig.create({
      data: { organizationId: org.id, taskMoved: true, emailEnabled: true },
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

    expect(mailer.sendEmail).toHaveBeenCalledTimes(2)
    const recipients = vi.mocked(mailer.sendEmail).mock.calls.map((call) => call[0]).sort()
    expect(recipients).toEqual([clientUserA.email, clientUserB.email].sort())

    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id } })
    expect(logs).toHaveLength(2)
    expect(logs.every((l) => l.status === 'SENT')).toBe(true)
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
