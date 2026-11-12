import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { deliverDocument } from '@/modules/task-documents/task-documents.service'
import { updateTask } from '@/modules/tasks/tasks.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

const pdf = (name: string) => ({ filename: name, mimeType: 'application/pdf', size: 10, buffer: Buffer.from('x') })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup(opts: { visible?: boolean; requiresPayment?: boolean } = {}) {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const client = await createTestClient(org.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, user.id)
  await prisma.task.update({
    where: { id: task.id },
    data: { visibleToClient: opts.visible ?? true, dueDate: new Date('2026-11-20'), competence: new Date('2026-10-01') },
  })
  const deliverable = await prisma.taskDeliverable.create({
    data: { taskId: task.id, name: opts.requiresPayment === false ? 'Extrato' : 'Guia DAS', position: 0, requiresPayment: opts.requiresPayment ?? true },
  })
  return { org, user, client, task, deliverable }
}

describe('entrega concluída gera o protocolo', () => {
  it('delivering a payment deliverable on a visible task creates one protocol with amount, due date and competence', async () => {
    const { org, user, task, deliverable } = await setup()

    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('das.pdf'), { amount: '1234.56', paymentDueDate: '2026-11-25' })

    const protocols = await prisma.protocol.findMany({ where: { taskId: task.id }, include: { events: true } })
    expect(protocols).toHaveLength(1)
    const p = protocols[0]
    expect(p.deliverableId).toBe(deliverable.id)
    expect(p.title).toBe('Guia DAS')
    expect(p.requiresPayment).toBe(true)
    expect(p.amount?.toString()).toBe('1234.56')
    expect(p.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-25')
    expect(p.competence?.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(p.events.map((e) => e.type)).toEqual(['SENT'])
    expect(queue.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROTOCOL_CREATED',
      metadata: expect.objectContaining({ protocolTitle: 'Guia DAS', paymentInfo: expect.stringContaining('R$ 1.234,56') }),
    }))
  })

  it('uses the task due date when no payment due date is informed', async () => {
    const { org, user, task, deliverable } = await setup()
    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('das.pdf'), { amount: '10' })
    const p = await prisma.protocol.findFirstOrThrow({ where: { taskId: task.id } })
    expect(p.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-20')
    expect(p.amount?.toString()).toBe('10')
  })

  it('rejects payment deliverable without amount', async () => {
    const { org, user, task, deliverable } = await setup()

    await expect(deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('das.pdf')))
      .rejects.toMatchObject({ statusCode: 400, message: 'Informe o valor da guia' })

    const d = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverable.id } })
    expect(d.deliveredAt).toBeNull()
    expect(await prisma.protocol.count({ where: { taskId: task.id } })).toBe(0)
  })

  it('non-payment deliverable creates protocol without amount and paymentInfo empty', async () => {
    const { org, user, task, deliverable } = await setup({ requiresPayment: false })

    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('extrato.pdf'))

    const p = await prisma.protocol.findFirstOrThrow({ where: { taskId: task.id } })
    expect(p.requiresPayment).toBe(false)
    expect(p.amount).toBeNull()
    expect(queue.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ paymentInfo: '' }),
    }))
  })

  it('task not visible to client: no protocol; making it visible generates exactly one with the latest file', async () => {
    const { org, user, task, deliverable } = await setup({ visible: false })

    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('v1.pdf'), { amount: '10' })
    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('v2.pdf'), { amount: '12' })
    expect(await prisma.protocol.count({ where: { taskId: task.id } })).toBe(0)

    await updateTask(task.id, org.id, { visibleToClient: true }, { id: user.id, type: 'user' })

    const protocols = await prisma.protocol.findMany({ where: { taskId: task.id }, include: { attachment: true } })
    expect(protocols).toHaveLength(1)
    expect(protocols[0].attachment?.filename).toBe('v2.pdf')
    expect(protocols[0].amount?.toString()).toBe('12')
  })

  it('re-delivering on a visible task keeps one protocol and swaps the file (REPLACED)', async () => {
    const { org, user, task, deliverable } = await setup()

    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('v1.pdf'), { amount: '10' })
    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('v2.pdf'), { amount: '12' })

    const protocols = await prisma.protocol.findMany({ where: { taskId: task.id }, include: { attachment: true, events: true } })
    expect(protocols).toHaveLength(1)
    expect(protocols[0].attachment?.filename).toBe('v2.pdf')
    expect(protocols[0].amount?.toString()).toBe('12')
    expect(protocols[0].fileUpdatedAt).not.toBeNull()
    const replaced = protocols[0].events.find((e) => e.type === 'REPLACED')
    expect(replaced?.previousAttachmentId).toBeTruthy()
  })

  it('re-delivering a guide the client already paid is refused before uploading', async () => {
    const { org, user, task, deliverable } = await setup()
    await deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('v1.pdf'), { amount: '10' })
    await prisma.protocol.updateMany({ where: { taskId: task.id }, data: { paidAt: new Date(), paidAmount: '10' } })

    await expect(deliverDocument(task.id, deliverable.id, org.id, { id: user.id }, pdf('v2.pdf'), { amount: '12' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Essa guia já foi marcada como paga pelo cliente. Peça para ele desfazer o pagamento antes de substituir.' })
    expect(b2Module.uploadFile).toHaveBeenCalledTimes(1)
  })
})

describe('POST /tasks/:id/documents/deliveries/:reqId/upload com valor', () => {
  it('reads amount and paymentDueDate from the multipart fields', async () => {
    const { app } = await import('@/test/setup')
    const { getAuthHeader } = await import('@/test/helpers')
    const { multipartBody } = await import('@/test/multipart')
    const { org, user, task, deliverable } = await setup()
    void org
    const mp = multipartBody({ amount: '1234.56', paymentDueDate: '2026-11-25' }, { filename: 'das.pdf' })

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/documents/deliveries/${deliverable.id}/upload`,
      headers: { authorization: await getAuthHeader(user.email, 'Test@1234'), ...mp.headers },
      body: mp.body,
    })

    expect(res.statusCode).toBe(201)
    const p = await prisma.protocol.findFirstOrThrow({ where: { taskId: task.id } })
    expect(p.amount?.toString()).toBe('1234.56')
    expect(p.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-25')
  })

  it('Brazilian-formatted amount is refused with 400', async () => {
    const { app } = await import('@/test/setup')
    const { getAuthHeader } = await import('@/test/helpers')
    const { multipartBody } = await import('@/test/multipart')
    const { user, task, deliverable } = await setup()
    const mp = multipartBody({ amount: '1.234,56' }, { filename: 'das.pdf' })

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/documents/deliveries/${deliverable.id}/upload`,
      headers: { authorization: await getAuthHeader(user.email, 'Test@1234'), ...mp.headers },
      body: mp.body,
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toBe('Valor inválido: use até 2 casas decimais')
  })
})
