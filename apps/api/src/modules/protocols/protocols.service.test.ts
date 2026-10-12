// apps/api/src/modules/protocols/protocols.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestBoard, createTestColumn, createTestTask, createTestClientUser, grantClientAccess,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import {
  createProtocol, listProtocolsForOrg, listProtocolsForTask, listProtocolsForClient,
  getProtocolById, getProtocolsSummary, registerView, registerDownload, expireOverdueProtocols,
  buildProtocolReceiptHtml,
} from './protocols.service'

beforeEach(() => {
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

async function setupTaskWithAttachment(orgId: string, userId: string) {
  const client = await createTestClient(orgId)
  const board = await createTestBoard(orgId, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, userId)
  const attachment = await prisma.attachment.create({
    data: { taskId: task.id, filename: 'guia-darf.pdf', mimeType: 'application/pdf', size: 1024, storageKey: 'k1', uploadedBy: userId },
  })
  return { client, board, column, task, attachment }
}

describe('createProtocol', () => {
  it('cria com anexo existente, número sequencial e evento SENT', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)

    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Guia DARF Outubro', attachmentId: attachment.id })

    expect(protocol.status).toBe('SENT')
    expect(protocol.number).toMatch(/^\d{4}-\d{6}$/)
    expect(protocol.clientId).toBe(client.id)
    const events = await prisma.protocolEvent.findMany({ where: { protocolId: protocol.id } })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('SENT')
    expect(queue.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'PROTOCOL_CREATED', clientId: client.id, taskId: task.id }),
    )
  })

  it('cria só com texto (sem anexo)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)

    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Aviso formal', content: 'Lembramos que o prazo vence em breve.' })

    expect(protocol.attachmentId).toBeNull()
    expect(protocol.content).toBe('Lembramos que o prazo vence em breve.')
  })

  it('lança 400 sem anexo e sem texto', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupTaskWithAttachment(org.id, admin.id)

    await expect(
      createProtocol(task.id, org.id, admin.id, { title: 'x' } as never),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 422 numa task com visibleToClient false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupTaskWithAttachment(org.id, admin.id)
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(
      createProtocol(task.id, org.id, admin.id, { title: 'x', content: 'y' }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('lança 404 se attachmentId pertence a outra task', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: taskA } = await setupTaskWithAttachment(org.id, admin.id)
    const { attachment: attachmentB } = await setupTaskWithAttachment(org.id, admin.id)

    await expect(
      createProtocol(taskA.id, org.id, admin.id, { title: 'x', attachmentId: attachmentB.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('números não colidem sob criação concorrente na mesma org/ano', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: task1 } = await setupTaskWithAttachment(org.id, admin.id)
    const { task: task2 } = await setupTaskWithAttachment(org.id, admin.id)

    const [p1, p2] = await Promise.all([
      createProtocol(task1.id, org.id, admin.id, { title: 'A', content: 'a' }),
      createProtocol(task2.id, org.id, admin.id, { title: 'B', content: 'b' }),
    ])

    expect(p1.number).not.toBe(p2.number)
  })
})

describe('registerView / registerDownload', () => {
  it('registerView cria evento VIEWED e avança status SENT -> VIEWED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'Mozilla/5.0')

    const updated = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    expect(updated.status).toBe('VIEWED')
    const events = await prisma.protocolEvent.findMany({ where: { protocolId: protocol.id, type: 'VIEWED' } })
    expect(events).toHaveLength(1)
    expect(events[0].ip).toBe('203.0.113.5')
    expect(events[0].actorEmail).toBe(clientUser.email)
  })

  it('registerView duas vezes gera dois eventos, mas status não regride', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')
    await registerDownload(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')
    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.6', 'ua')

    const updated = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    expect(updated.status).toBe('DOWNLOADED') // não regride pra VIEWED
    const viewedEvents = await prisma.protocolEvent.findMany({ where: { protocolId: protocol.id, type: 'VIEWED' } })
    expect(viewedEvents).toHaveLength(2)
  })

  it('registerView lança 404 pra ClientUser sem acesso à empresa', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id) // sem grantClientAccess
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    await expect(
      registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('registerDownload lança 404 quando o protocolo não tem anexo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', content: 'y' })

    await expect(
      registerDownload(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('expireOverdueProtocols', () => {
  it('marca EXPIRED só os que estão SENT com dueDate vencido, gera evento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: task1, attachment: att1 } = await setupTaskWithAttachment(org.id, admin.id)
    const { task: task2, attachment: att2 } = await setupTaskWithAttachment(org.id, admin.id)
    const past = new Date(Date.now() - 86400000)
    const future = new Date(Date.now() + 86400000)

    const overdue = await createProtocol(task1.id, org.id, admin.id, { title: 'vence ontem', attachmentId: att1.id, dueDate: past })
    const notYet = await createProtocol(task2.id, org.id, admin.id, { title: 'vence amanhã', attachmentId: att2.id, dueDate: future })

    const count = await expireOverdueProtocols(org.id, new Date())

    expect(count).toBe(1)
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe('EXPIRED')
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: notYet.id } })).status).toBe('SENT')
    const event = await prisma.protocolEvent.findFirst({ where: { protocolId: overdue.id, type: 'EXPIRED' } })
    expect(event).not.toBeNull()
  })

  it('nunca marca EXPIRED um protocolo que já foi visualizado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const past = new Date(Date.now() - 86400000)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id, dueDate: past })
    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')

    await expireOverdueProtocols(org.id, new Date())

    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).status).toBe('VIEWED')
  })
})

describe('listProtocolsForOrg / listProtocolsForClient / getProtocolById / getProtocolsSummary', () => {
  it('lista da org filtra por status e cliente vê só os próprios', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: taskA, attachment: attA, client: clientA } = await setupTaskWithAttachment(org.id, admin.id)
    const { task: taskB, attachment: attB } = await setupTaskWithAttachment(org.id, admin.id)
    await createProtocol(taskA.id, org.id, admin.id, { title: 'Da A', attachmentId: attA.id })
    await createProtocol(taskB.id, org.id, admin.id, { title: 'Da B', attachmentId: attB.id })

    const all = await listProtocolsForOrg(org.id, {})
    expect(all).toHaveLength(2)
    expect(all.every((p) => typeof p.boardId === 'string')).toBe(true)

    const onlyA = await listProtocolsForClient(org.id, clientA.id, {})
    expect(onlyA).toHaveLength(1)
    expect(onlyA[0].title).toBe('Da A')
  })

  it('listProtocolsForClient esconde protocolo cuja task deixou de ser visível ao cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    await createProtocol(task.id, org.id, admin.id, { title: 'Vira interno', attachmentId: attachment.id })
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    const list = await listProtocolsForClient(org.id, client.id, {})

    expect(list).toHaveLength(0)
  })

  it('getProtocolById inclui a timeline de eventos ordenada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })
    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')

    const detail = await getProtocolById(protocol.id, org.id)

    expect(detail.events.map((e) => e.type)).toEqual(['SENT', 'VIEWED'])
  })

  it('getProtocolsSummary conta por status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    const summary = await getProtocolsSummary(org.id)

    expect(summary.SENT).toBe(1)
    expect(summary.VIEWED).toBe(0)
  })
})

describe('buildProtocolReceiptHtml', () => {
  it('monta HTML com número, timeline e o aviso sobre o IP', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Guia DARF', attachmentId: attachment.id })
    const detail = await getProtocolById(protocol.id, org.id)

    const html = buildProtocolReceiptHtml(detail)

    expect(html).toContain(detail.number)
    expect(html).toContain('Guia DARF')
    expect(html).toContain('evidência de apoio')
  })
})
