import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as b2Module from '@/lib/b2'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import { confirmarSugestao, trocarTarefa, listarFilaDeRevisao, rejeitarDocumento } from './document-reader.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

const CNPJ = '11.222.333/0001-81'
const campo = (valor: string | number, bruto = String(valor)) => ({ bruto, valor, valido: true })

async function setup(opts: { deliverables?: { name: string; requiresPayment: boolean }[]; fields?: Record<string, unknown> } = {}) {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { cnpj: CNPJ })
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, admin.id, { departmentId: dept.id })
  await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: true, competence: new Date('2026-10-01'), dueDate: new Date('2026-11-20') } })
  const deliverables = []
  for (const [i, d] of (opts.deliverables ?? [{ name: 'Guia DAS', requiresPayment: true }]).entries()) {
    deliverables.push(await prisma.taskDeliverable.create({ data: { taskId: task.id, name: d.name, requiresPayment: d.requiresPayment, position: i } }))
  }
  const doc = await prisma.receivedDocument.create({
    data: {
      organizationId: org.id, fileHash: `h-${Math.random()}`, storageKey: 'document-reader/x/123-das.pdf', uploadedById: admin.id,
      status: 'PENDING', taskId: task.id,
      extractedFields: (opts.fields ?? {
        cnpj: campo('11222333000181', CNPJ), competencia: campo('2026-10'), valor: campo(1234.56, '1.234,56'), vencimento: campo('2026-11-20', '20/11/2026'),
      }) as object,
    },
  })
  const otherClient = await createTestClient(org.id, { cnpj: '99.888.777/0001-66' })
  const otherBoard = await createTestBoard(org.id, otherClient.id)
  const otherColumn = await createTestColumn(otherBoard.id)
  const otherTask = await createTestTask(otherColumn.id, admin.id, { departmentId: dept.id })
  return { org, admin, task, deliverables, doc, otherTask, actor: { id: admin.id, role: 'ORG_ADMIN' } }
}

describe('robô preenche a entrega com barreira de CNPJ/competência', () => {
  it('confirming a guide fills the single pending deliverable and creates the protocol with the read amount and due date', async () => {
    const { org, task, deliverables, doc, actor } = await setup()

    await confirmarSugestao(doc.id, org.id, actor)

    const d = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverables[0].id }, include: { protocol: true } })
    expect(d.deliveredAt).not.toBeNull()
    expect(d.amount?.toString()).toBe('1234.56')
    expect(d.protocol?.amount?.toString()).toBe('1234.56')
    expect(d.protocol?.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-20')
    const received = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(received.status).toBe('ATTACHED')
    expect(received.attachmentId).toBe(d.attachmentId)
    expect(received.taskId).toBe(task.id)
  })

  it('CNPJ of another client is refused even when confirming the suggestion', async () => {
    const { org, doc, otherTask, actor } = await setup()
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { taskId: otherTask.id } })

    await expect(confirmarSugestao(doc.id, org.id, actor)).rejects.toMatchObject({ statusCode: 422 })
    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('PENDING')
  })

  it('competence mismatch is refused with the read and expected months', async () => {
    const { org, doc, actor } = await setup({
      fields: { cnpj: campo('11222333000181', CNPJ), competencia: campo('2026-09'), valor: campo(10, '10,00') },
    })

    await expect(confirmarSugestao(doc.id, org.id, actor)).rejects.toMatchObject({
      statusCode: 422,
      message: 'A competência lida no documento (09/2026) não bate com a da tarefa (10/2026) — confira se escolheu a tarefa certa',
    })
    expect(await prisma.attachment.count({ where: { taskId: (await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })).taskId! } })).toBe(0)
  })

  it('the amount comes from the text read in the document, not from the float', async () => {
    const { org, deliverables, doc, actor } = await setup({
      fields: { cnpj: campo('11222333000181', CNPJ), competencia: campo('2026-10'), valor: campo(10, 'R$ 12,34') },
    })

    await confirmarSugestao(doc.id, org.id, actor)

    expect((await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverables[0].id } })).amount?.toString()).toBe('12.34')
  })

  it('more than one pending deliverable requires choosing one', async () => {
    const { org, task, deliverables, doc, actor } = await setup({
      deliverables: [{ name: 'Guia DAS', requiresPayment: true }, { name: 'Extrato', requiresPayment: false }],
    })

    await expect(confirmarSugestao(doc.id, org.id, actor)).rejects.toMatchObject({
      statusCode: 422, message: 'Essa tarefa tem mais de uma entrega pendente — escolha qual este documento preenche',
    })

    await trocarTarefa(doc.id, org.id, task.id, actor, { deliverableId: deliverables[1].id })
    const extrato = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverables[1].id } })
    expect(extrato.deliveredAt).not.toBeNull()
  })

  it('payment deliverable without a read amount needs the reviewer to inform it', async () => {
    const { org, deliverables, doc, actor } = await setup({ fields: { cnpj: campo('11222333000181', CNPJ) } })

    await expect(confirmarSugestao(doc.id, org.id, actor)).rejects.toMatchObject({ statusCode: 400, message: 'Informe o valor da guia' })
    expect(b2Module.uploadFile).not.toHaveBeenCalled()

    await confirmarSugestao(doc.id, org.id, actor, { amount: '77.00', paymentDueDate: '2026-11-25' })
    const d = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverables[0].id } })
    expect(d.amount?.toString()).toBe('77')
  })

  it('task without pending deliverables keeps the old behavior: attachment only, no protocol', async () => {
    const { org, task, doc, actor } = await setup({ deliverables: [] })

    await confirmarSugestao(doc.id, org.id, actor)

    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(1)
    expect(await prisma.protocol.count({ where: { taskId: task.id } })).toBe(0)
    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('ATTACHED')
  })

  it('review queue lists the pending deliverables of the suggested task', async () => {
    const { org } = await setup({ deliverables: [{ name: 'Guia DAS', requiresPayment: true }, { name: 'Extrato', requiresPayment: false }] })

    const fila = await listarFilaDeRevisao(org.id)

    expect(fila[0].task?.pendingDeliverables.map((d) => [d.name, d.requiresPayment])).toEqual([['Guia DAS', true], ['Extrato', false]])
  })
})

describe('dois revisores ao mesmo tempo', () => {
  it('only one confirmation delivers: the other gets 409 before any protocol change or notice', async () => {
    const { org, deliverables, doc, actor } = await setup()
    // Slow download: both reviewers are past the initial checks before either one delivers
    vi.mocked(b2Module.downloadFile).mockImplementation(() => new Promise((r) => setTimeout(() => r(Buffer.from('%PDF-1.4')), 80)))

    const results = await Promise.allSettled([
      confirmarSugestao(doc.id, org.id, actor),
      confirmarSugestao(doc.id, org.id, actor),
    ])

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409 })
    const protocol = await prisma.protocol.findUniqueOrThrow({ where: { deliverableId: deliverables[0].id }, include: { events: true } })
    expect(protocol.events.filter((e) => e.type === 'REPLACED')).toHaveLength(0)
    expect(vi.mocked(queue.enqueueNotification).mock.calls.filter(([n]) => n.event === 'PROTOCOL_CREATED')).toHaveLength(1)
    expect(b2Module.uploadFile).toHaveBeenCalledTimes(1) // the loser never uploads
    const deliverable = await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: deliverables[0].id } })
    expect(deliverable.attachmentId).toBe(protocol.attachmentId)
  })

  it('a failed delivery releases the document so it can be reviewed again', async () => {
    const { org, doc, actor } = await setup({ fields: { cnpj: campo('11222333000181', CNPJ) } })

    await expect(confirmarSugestao(doc.id, org.id, actor)).rejects.toMatchObject({ statusCode: 400 })
    await confirmarSugestao(doc.id, org.id, actor, { amount: '10.00' })

    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('ATTACHED')
  })

  it('rejecting while another reviewer is attaching is refused with 409', async () => {
    const { org, doc, actor } = await setup()
    vi.mocked(b2Module.downloadFile).mockImplementation(() => new Promise((r) => setTimeout(() => r(Buffer.from('%PDF-1.4')), 80)))

    const attaching = confirmarSugestao(doc.id, org.id, actor)
    await new Promise((r) => setTimeout(r, 20))
    await expect(rejeitarDocumento(doc.id, org.id, actor)).rejects.toMatchObject({ statusCode: 409 })
    await attaching

    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('ATTACHED')
  })
})

describe('isolamento entre escritórios (revisão final)', () => {
  it('task of another organization answers 404 without revealing its client name', async () => {
    const { org, doc, actor } = await setup()
    const plan = await createTestPlan()
    const otherOrg = await createTestOrg(plan.id)
    const otherAdmin = await createTestUser(otherOrg.id, { role: 'ORG_ADMIN' })
    const dept = await createTestDepartment(otherOrg.id)
    const secretClient = await createTestClient(otherOrg.id, { name: 'CLIENTE SIGILOSO LTDA', cnpj: '99.888.777/0001-66' })
    const board = await createTestBoard(otherOrg.id, secretClient.id)
    const column = await createTestColumn(board.id)
    const foreignTask = await createTestTask(column.id, otherAdmin.id, { departmentId: dept.id })

    const err = (await trocarTarefa(doc.id, org.id, foreignTask.id, actor).catch((e: unknown) => e)) as { statusCode: number; message: string }

    expect(err).toMatchObject({ statusCode: 404 })
    expect(err.message).not.toContain('SIGILOSO')
  })
})
