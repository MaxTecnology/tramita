import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { multipartBody } from '@/test/multipart'
import { deliverDocument } from '@/modules/task-documents/task-documents.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  serveClientDepartment, createTestBoard, createTestColumn, createTestTask, getAuthHeader,
} from '@/test/helpers'

const pdf = (name: string) => ({ filename: name, mimeType: 'application/pdf', size: 10, buffer: Buffer.from('x') })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'deleteFile').mockResolvedValue(undefined)
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// Runs `change` while the file is being uploaded: the window between the early check and the
// guarded write, where a client payment or an office cancellation can land.
function duringUpload(change: () => Promise<unknown>) {
  vi.mocked(b2Module.uploadFile).mockImplementation(async () => { await change() })
}

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const client = await createTestClient(org.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, admin.id)
  await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: true, dueDate: new Date('2026-11-20'), competence: new Date('2026-10-01') } })
  const deliverable = await prisma.taskDeliverable.create({ data: { taskId: task.id, name: 'Guia DAS', position: 0, requiresPayment: true } })
  await deliverDocument(task.id, deliverable.id, org.id, { id: admin.id }, pdf('v1.pdf'), { amount: '10' })
  const protocol = await prisma.protocol.findFirstOrThrow({ where: { taskId: task.id } })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  vi.mocked(queue.enqueueNotification).mockClear()
  return { org, admin, client, board, task, deliverable, protocol, auth }
}

describe('corridas com pagamento/cancelamento durante o envio', () => {
  it('re-delivery loses to a payment made during upload: 409, delivery untouched, uploaded file removed', async () => {
    const { org, admin, task, deliverable, protocol } = await setup()
    const before = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverable.id } })
    duringUpload(() => prisma.protocol.update({ where: { id: protocol.id }, data: { paidAt: new Date(), paidAmount: '10' } }))

    await expect(deliverDocument(task.id, deliverable.id, org.id, { id: admin.id }, pdf('v2.pdf'), { amount: '99' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Essa guia já foi marcada como paga pelo cliente. Peça para ele desfazer o pagamento antes de substituir.' })

    const after = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverable.id } })
    expect([after.attachmentId, after.amount?.toString()]).toEqual([before.attachmentId, before.amount?.toString()])
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(1)
    expect(b2Module.deleteFile).toHaveBeenCalledTimes(1)
  })

  it('replace loses to a cancellation made during upload: 409 says cancelled and the file is removed', async () => {
    const { protocol, task, auth } = await setup()
    duringUpload(() => prisma.protocol.update({ where: { id: protocol.id }, data: { cancelledAt: new Date(), cancellationReason: 'erro' } }))
    const mp = multipartBody({}, { filename: 'v2.pdf' })

    const res = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/replace`, headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).message).toBe('Protocolo cancelado não pode ser alterado')
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(1)
    expect(b2Module.deleteFile).toHaveBeenCalledTimes(1)
  })

  it('replace ignores an amount sent for a document that is not a guide', async () => {
    const { protocol, auth } = await setup()
    await prisma.protocol.update({ where: { id: protocol.id }, data: { requiresPayment: false, amount: null } })
    const mp = multipartBody({ amount: '50.00' }, { filename: 'v2.pdf' })

    const res = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/replace`, headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(200)
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).amount).toBeNull()
  })
})

describe('ações do escritório no protocolo', () => {
  it('manual protocol with requiresPayment requires amount and stores competence from the task', async () => {
    const { task, auth } = await setup()

    const missing = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia avulsa', content: 'segue', requiresPayment: true },
    })
    expect(missing.statusCode).toBe(400)
    expect(JSON.parse(missing.body).message).toBe('Informe o valor da guia')

    const ok = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia avulsa', content: 'segue', requiresPayment: true, amount: '99.90' },
    })
    expect(ok.statusCode).toBe(201)
    const created = await prisma.protocol.findUniqueOrThrow({ where: { id: JSON.parse(ok.body).id } })
    expect(created.amount?.toString()).toBe('99.9')
    expect(created.competence?.toISOString().slice(0, 10)).toBe('2026-10-01')
  })

  it('replace keeps one protocol, swaps file, logs REPLACED with previous attachment and notifies again', async () => {
    const { protocol, deliverable, auth } = await setup()
    const mp = multipartBody({ amount: '12.50' }, { filename: 'v2.pdf' })

    const res = await app.inject({
      method: 'POST', url: `/protocols/${protocol.id}/replace`,
      headers: { authorization: auth, ...mp.headers }, body: mp.body,
    })

    expect(res.statusCode).toBe(200)
    const after = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id }, include: { attachment: true, events: true } })
    expect(after.attachment?.filename).toBe('v2.pdf')
    expect(after.amount?.toString()).toBe('12.5')
    expect(after.events.find((e) => e.type === 'REPLACED')?.previousAttachmentId).toBe(protocol.attachmentId)
    const d = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverable.id } })
    expect(d.attachmentId).toBe(after.attachmentId)
    expect(queue.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({ event: 'PROTOCOL_CREATED' }))
  })

  it('replace and delivery refuse a forbidden file type before uploading anything', async () => {
    const { protocol, task, deliverable, auth } = await setup()
    const html = () => multipartBody({}, { filename: 'pagina.html', contentType: 'application/pdf', content: '<script>' })
    vi.mocked(b2Module.uploadFile).mockClear() // setup already uploaded v1

    const replaceMp = html()
    const replace = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/replace`, headers: { authorization: auth, ...replaceMp.headers }, body: replaceMp.body })
    const deliverMp = html()
    const deliver = await app.inject({ method: 'POST', url: `/tasks/${task.id}/documents/deliveries/${deliverable.id}/upload`, headers: { authorization: auth, ...deliverMp.headers }, body: deliverMp.body })

    expect([replace.statusCode, deliver.statusCode]).toEqual([422, 422])
    expect(b2Module.uploadFile).not.toHaveBeenCalled()
  })

  it('XML delivery is stored with the type decided by the extension', async () => {
    const { task, deliverable, auth } = await setup()
    await prisma.taskDeliverable.update({ where: { id: deliverable.id }, data: { requiresPayment: false } })
    const mp = multipartBody({}, { filename: 'nfe.xml', contentType: 'text/html', content: '<nfe/>' })

    const res = await app.inject({ method: 'POST', url: `/tasks/${task.id}/documents/deliveries/${deliverable.id}/upload`, headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(201)
    expect(b2Module.uploadFile).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), 'application/xml')
  })

  it('replace and payment edit are refused with 409 once the client marked it paid', async () => {
    const { protocol, auth } = await setup()
    await prisma.protocol.update({ where: { id: protocol.id }, data: { paidAt: new Date(), paidAmount: '10' } })
    const mp = multipartBody({}, { filename: 'v2.pdf' })

    const replace = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/replace`, headers: { authorization: auth, ...mp.headers }, body: mp.body })
    const edit = await app.inject({ method: 'PATCH', url: `/protocols/${protocol.id}/payment`, headers: { authorization: auth }, payload: { amount: '11.00' } })

    expect(replace.statusCode).toBe(409)
    expect(edit.statusCode).toBe(409)
    expect(JSON.parse(edit.body).message).toBe('Essa guia já foi marcada como paga pelo cliente. Peça para ele desfazer o pagamento antes de substituir.')
  })

  it('payment edit logs AMOUNT_CHANGED with before → after', async () => {
    const { protocol, auth } = await setup()

    const res = await app.inject({
      method: 'PATCH', url: `/protocols/${protocol.id}/payment`, headers: { authorization: auth },
      payload: { amount: '12.00', dueDate: '2026-11-25' },
    })

    expect(res.statusCode).toBe(200)
    const ev = await prisma.protocolEvent.findFirstOrThrow({ where: { protocolId: protocol.id, type: 'AMOUNT_CHANGED' } })
    expect(ev.detail).toBe('R$ 10,00 → R$ 12,00; vencimento 20/11/2026 → 25/11/2026')
  })

  it('cancel requires reason, records CANCELLED and refuses a second cancel', async () => {
    const { protocol, auth } = await setup()

    const noReason = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/cancel`, headers: { authorization: auth }, payload: { reason: '' } })
    expect(noReason.statusCode).toBe(400)

    const ok = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/cancel`, headers: { authorization: auth }, payload: { reason: 'Enviado ao cliente errado' } })
    expect(ok.statusCode).toBe(200)
    const after = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    expect(after.cancelledAt).not.toBeNull()
    expect(after.cancellationReason).toBe('Enviado ao cliente errado')
    expect((await prisma.protocolEvent.findFirstOrThrow({ where: { protocolId: protocol.id, type: 'CANCELLED' } })).detail).toBe('Enviado ao cliente errado')

    const again = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/cancel`, headers: { authorization: auth }, payload: { reason: 'de novo' } })
    expect(again.statusCode).toBe(409)
  })

  it('ORG_MEMBER gets 404 acting on a protocol of a process not visible to them', async () => {
    const { org, protocol } = await setup()
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/cancel`, headers: { authorization: auth }, payload: { reason: 'Enviado errado' } })

    expect(res.statusCode).toBe(404)
  })

  it('ORG_MEMBER responsible for the client department can act', async () => {
    const { org, client, protocol } = await setup()
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const dept = await createTestDepartment(org.id)
    await serveClientDepartment(client.id, dept.id, member.id)

    const res = await app.inject({
      method: 'PATCH', url: `/protocols/${protocol.id}/payment`,
      headers: { authorization: await getAuthHeader(member.email, 'Test@1234') }, payload: { amount: '11.00' },
    })

    expect(res.statusCode).toBe(200)
  })
})
