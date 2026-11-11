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
  createTestPortalRecipient,
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
    await createTestPortalRecipient(org.id, client.id, task.departmentId, '5582999990002')

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

  it('TASK_MOVED de tarefa do deptPessoal não envia email pra ClientUser escopado só ao deptFiscal', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id, { name: 'Cliente Departamentos' })
    const deptFiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const deptPessoal = await createTestDepartment(org.id, { name: 'Pessoal' })
    const { clientUser: fiscalUser } = await createTestClientUser(org.id, { email: 'fiscal@test.com' })
    const { clientUser: pessoalUser } = await createTestClientUser(org.id, { email: 'pessoal@test.com' })
    await grantClientAccess(fiscalUser.id, client.id, deptFiscal.id)
    await grantClientAccess(pessoalUser.id, client.id, deptPessoal.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: deptPessoal.id })

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

    expect(mailer.sendEmail).toHaveBeenCalledTimes(1)
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      pessoalUser.email,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it('não envia email quando a tarefa tem visibleToClient=false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id, { name: 'Cliente Tarefa Oculta' })
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

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

    expect(mailer.sendEmail).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id } })
    expect(logs).toHaveLength(0)
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

describe('notificação ao cliente por departamento (e-mail e WhatsApp)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(encryption, 'decrypt').mockImplementation((encoded) => encoded)
    vi.spyOn(maximizebot, 'sendWhatsApp').mockResolvedValue(undefined)
    vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined)
  })

  async function setup(visibleToClient = true) {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const staff = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    await prisma.client.update({ where: { id: client.id }, data: { whatsapp: '5511900000000' } })
    const folha = await createTestDepartment(org.id)
    const fiscal = await createTestDepartment(org.id)

    const { clientUser: folhaComTelefone } = await createTestClientUser(org.id, { email: `folha1-${Date.now()}@t.com` })
    await prisma.clientUser.update({ where: { id: folhaComTelefone.id }, data: { phone: '5582911111111' } })
    await grantClientAccess(folhaComTelefone.id, client.id, folha.id)
    const { clientUser: folhaSemTelefone } = await createTestClientUser(org.id, { email: `folha2-${Date.now()}@t.com` })
    await grantClientAccess(folhaSemTelefone.id, client.id, folha.id)
    const { clientUser: fiscalUser } = await createTestClientUser(org.id, { email: `fiscal-${Date.now()}@t.com` })
    await prisma.clientUser.update({ where: { id: fiscalUser.id }, data: { phone: '5582922222222' } })
    await grantClientAccess(fiscalUser.id, client.id, fiscal.id)

    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, staff.id, { departmentId: folha.id })
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient } })

    await prisma.notificationConfig.create({
      data: { organizationId: org.id, whatsappEnabled: true, emailEnabled: true, taskMoved: true, requestApproved: true, maximizebotToken: 'Bearer t' },
    })
    return { org, client, task, folha, folhaComTelefone, folhaSemTelefone }
  }

  it('envia WhatsApp só pro telefone dos usuários do departamento e e-mail pra todos eles', async () => {
    const { org, client, task, folhaComTelefone, folhaSemTelefone } = await setup()

    await processNotificationJob({
      data: { event: 'TASK_MOVED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    const whatsappNumbers = vi.mocked(maximizebot.sendWhatsApp).mock.calls.map((c) => c[1].number)
    expect(whatsappNumbers).toEqual(['5582911111111'])
    const emails = vi.mocked(mailer.sendEmail).mock.calls.map((c) => c[0]).sort()
    expect(emails).toEqual([folhaComTelefone.email, folhaSemTelefone.email].sort())
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id }, orderBy: { recipient: 'asc' } })
    expect(logs.map((l) => `${l.channel}:${l.recipient}`).sort()).toEqual(
      [`WHATSAPP:5582911111111`, `EMAIL:${folhaComTelefone.email}`, `EMAIL:${folhaSemTelefone.email}`].sort(),
    )
  })

  it('o número da empresa (client.whatsapp) não recebe nada', async () => {
    const { org, client, task } = await setup()

    await processNotificationJob({
      data: { event: 'TASK_MOVED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    const numbers = vi.mocked(maximizebot.sendWhatsApp).mock.calls.map((c) => c[1].number)
    expect(numbers).not.toContain('5511900000000')
  })

  it('tarefa interna (visibleToClient=false) não notifica ninguém', async () => {
    const { org, client, task } = await setup(false)

    await processNotificationJob({
      data: { event: 'TASK_MOVED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    expect(mailer.sendEmail).not.toHaveBeenCalled()
  })

  it('evento de solicitação usa o departamento da solicitação', async () => {
    const { org, client, folha, folhaComTelefone } = await setup()
    const request = await prisma.request.create({
      data: { organizationId: org.id, clientId: client.id, title: 'Pedido', departmentId: folha.id },
    })

    await processNotificationJob({
      data: { event: 'REQUEST_APPROVED', organizationId: org.id, clientId: client.id, requestId: request.id, metadata: { requestTitle: 'Pedido' } },
    })

    expect(vi.mocked(maximizebot.sendWhatsApp).mock.calls.map((c) => c[1].number)).toEqual(['5582911111111'])
    expect(vi.mocked(mailer.sendEmail).mock.calls.map((c) => c[0])).toContain(folhaComTelefone.email)
    expect(vi.mocked(mailer.sendEmail).mock.calls).toHaveLength(2)
  })
})
