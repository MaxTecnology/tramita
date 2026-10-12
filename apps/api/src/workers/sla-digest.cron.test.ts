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
  createTestDepartment,
  createTestClientUser,
  grantClientAccess,
} from '@/test/helpers'
import { runSlaDigest } from './sla-digest.cron'
import { createProtocol, registerView } from '@/modules/protocols/protocols.service'

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

  it('não enfileira pro assignee desativado — cai pro fallback de admins ativos', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const inactiveAssignee = await createTestUser(org.id, { role: 'ORG_MEMBER', isActive: false })
    const activeAdmin = await createTestUser(org.id, { role: 'ORG_ADMIN', isActive: true })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, activeAdmin.id)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date(), assigneeId: inactiveAssignee.id } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: inactiveAssignee.id }),
    )
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SLA_DIGEST', userId: activeAdmin.id }),
    )
  })

  it('não usa admin desativado no fallback', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const inactiveAdmin = await createTestUser(org.id, { role: 'ORG_ADMIN', isActive: false })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, inactiveAdmin.id) // sem assignee

    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date() } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('não enfileira nada pra organização inativa ou com assinatura suspensa', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const suspendedOrg = await createTestOrg(plan.id, { subscriptionStatus: 'SUSPENDED' })
    const user = await createTestUser(suspendedOrg.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(suspendedOrg.id)
    const board = await createTestBoard(suspendedOrg.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date() } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('provisiona NotificationConfig com defaults pra org que nunca configurou nada, garantindo que o worker de envio não descarte o job por falta de config', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date() } })

    const before = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(before).toBeNull()

    await runSlaDigest(new Date())

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SLA_DIGEST', userId: user.id }),
    )
    const after = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(after).not.toBeNull()
    expect(after?.slaDigestEnabled).toBe(true)
  })
})

describe('runSlaDigest — protocolos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inclui protocolo sem visualização dentro da janela de aviso no digest do assignee da task', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const assignee = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, assignee.id)
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: assignee.id } })
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: assignee.id },
    })
    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + 1)
    await createProtocol(task.id, org.id, assignee.id, { title: 'Guia DARF', attachmentId: attachment.id, dueDate })

    await runSlaDigest(new Date())

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'SLA_DIGEST',
        userId: assignee.id,
        metadata: expect.objectContaining({ taskListText: expect.stringContaining('Guia DARF') }),
      }),
    )
  })

  it('marca protocolo vencido como EXPIRED e inclui no digest com a tag de vencido', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: admin.id },
    })
    const past = new Date(Date.now() - 86400000)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Guia vencida', attachmentId: attachment.id, dueDate: past })

    await runSlaDigest(new Date())

    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).status).toBe('EXPIRED')
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ taskListText: expect.stringContaining('vencido sem visualização') }),
      }),
    )
  })

  it('dateLabel do protocolo no digest não sofre off-by-one de fuso (rótulo UTC, não BRT)', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const assignee = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, assignee.id)
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: assignee.id } })
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: assignee.id },
    })
    // dueDate = rótulo "20/10/2026" (meia-noite UTC); formatar com fuso BRT mostraria "19/10/2026".
    const dueDate = new Date(Date.UTC(2026, 9, 20))
    await createProtocol(task.id, org.id, assignee.id, { title: 'Guia DARF', attachmentId: attachment.id, dueDate })

    await runSlaDigest(new Date(Date.UTC(2026, 9, 19, 11, 0, 0)))

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ taskListText: expect.stringContaining('20/10/2026') }),
      }),
    )
  })

  it('não inclui protocolo já visualizado no digest', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id, { departmentId: department.id })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: admin.id },
    })
    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + 1)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Já visto', attachmentId: attachment.id, dueDate })
    await registerView(protocol.id, org.id, clientUser.id, '1.2.3.4', 'ua')

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ taskListText: expect.stringContaining('Já visto') }) }),
    )
  })

  it('expira protocolo vencido mesmo com slaDigestEnabled desligado — expiração não é uma função do email', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.notificationConfig.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, slaDigestEnabled: false },
      update: { slaDigestEnabled: false },
    })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: admin.id },
    })
    const past = new Date(Date.now() - 86400000)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id, dueDate: past })

    await runSlaDigest(new Date())

    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).status).toBe('EXPIRED')
    expect(enqueueNotification).not.toHaveBeenCalled() // digest desligado, mas expiração aconteceu
  })
})
