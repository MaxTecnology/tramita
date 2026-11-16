import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as b2Module from '@/lib/b2'
import * as queue from '@/lib/queue'
import { processarDocumento, confirmarSugestao, listarFilaDeRevisao } from './document-reader.service'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn, createTestDepartment } from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// ACME, task of 08/2026 with "Guia" (robot: TESTE) and "Holerites" (no robot)
async function setup(deliverables: { name: string; robot?: boolean; requiresPayment?: boolean }[] = [{ name: 'Guia', robot: true }, { name: 'Holerites' }]) {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { cnpj: '11222333000181' })
  const column = await createTestColumn((await createTestBoard(org.id, client.id)).id)
  const obrigacao = await prisma.obligationType.create({ data: { code: `TESTE-${org.id}`, name: 'Teste', organizationId: org.id } })
  const task = await prisma.task.create({
    data: {
      title: 'Apuração', columnId: column.id, departmentId: dept.id, position: 0, competence: new Date(Date.UTC(2026, 7, 1)),
      deliverables: { create: deliverables.map((d, i) => ({ name: d.name, position: i, requiresPayment: !!d.requiresPayment, obligationTypeId: d.robot ? obrigacao.id : null })) },
    },
    include: { deliverables: { orderBy: { position: 'asc' } } },
  })
  await prisma.documentModel.create({
    data: {
      organizationId: org.id, obligationTypeId: obrigacao.id, name: `Modelo ${org.id}`,
      definicao: {
        tipoImposto: `TESTE-${org.id}`,
        ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
        zonas: [
          { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
          { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
        ],
      },
    },
  })
  const doc = await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: `h-${org.id}`, storageKey: `k/${org.id}/123-guia.pdf`, uploadedById: admin.id, status: 'PENDING' } })
  vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')))
  return { org, admin, task, doc, guia: task.deliverables[0] }
}

describe('robô casa por entrega', () => {
  it('suggests the task and the exact delivery the document fills', async () => {
    const { task, doc, guia } = await setup()
    await processarDocumento(doc.id)
    const d = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect([d.taskId, d.deliverableId]).toEqual([task.id, guia.id])
  })

  it('two pending deliveries of the same obligation in a task: ambiguous, goes to the queue without a suggestion', async () => {
    const { doc } = await setup([{ name: 'Guia 1', robot: true }, { name: 'Guia 2', robot: true }])
    await processarDocumento(doc.id)
    const d = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(d.taskId).toBeNull()
    expect(d.deliverableId).toBeNull()
  })

  it('confirming fills the suggested delivery even with other pending deliveries, and the history says the robot checked it', async () => {
    const { org, admin, task, doc, guia } = await setup()
    await processarDocumento(doc.id)
    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })
    expect((await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: guia.id } })).deliveredAt).not.toBeNull()
    const h = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: task.id, action: 'deliverable_delivered_robot' } })
    expect([h.actorName, h.fromValue, h.toValue]).toEqual(['Bruna', 'Guia', 'guia.pdf'])
  })

  it('the suggested delivery was filled in the meantime: 409, nothing delivered twice', async () => {
    const { org, admin, doc, guia } = await setup()
    await processarDocumento(doc.id)
    await prisma.taskDeliverable.update({ where: { id: guia.id }, data: { deliveredAt: new Date() } })
    await expect(confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })).rejects.toMatchObject({ statusCode: 409, message: 'Essa entrega já foi feita' })
    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('PENDING')
  })
})

describe('fila com conferências', () => {
  it('each document carries the checks and whether it is ready to confirm', async () => {
    const { org, doc } = await setup([{ name: 'Guia DAS', robot: true, requiresPayment: true }])
    await processarDocumento(doc.id)
    const [item] = await listarFilaDeRevisao(org.id)
    expect(item.suggestion).toMatchObject({ deliverableName: 'Guia DAS', clientName: expect.any(String), competence: '2026-08', requiresPayment: true })
    expect(item.checks).toMatchObject({ cnpj: true, competence: true, payment: false })
    expect(item.ready).toBe(false) // guide without amount/due date read

    await prisma.receivedDocument.update({
      where: { id: doc.id },
      data: { extractedFields: { ...(item.extractedFields as object), valor: { bruto: '1.234,56', valor: 1234.56, valido: true }, vencimento: { bruto: '20/09/2026', valor: '2026-09-20', valido: true } } },
    })
    const [again] = await listarFilaDeRevisao(org.id)
    expect(again.checks.payment).toBe(true)
    expect(again.ready).toBe(true)
  })
})
