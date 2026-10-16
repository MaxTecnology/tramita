// apps/api/src/modules/document-reader/document-reader.service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { processarDocumento, ingerirDocumento } from './document-reader.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestDepartment,
} from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

vi.mock('@/lib/b2', () => ({
  uploadFile: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  downloadFile: vi.fn(),
}))

async function setupObrigacaoETarefa(org: { id: string }, cnpj: string) {
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { cnpj })
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const obrigacao = await prisma.taxObligationType.create({
    data: { code: 'TESTE', name: 'Obrigação de Teste', organizationId: null },
  })
  const template = await prisma.recurringTaskTemplate.create({
    data: {
      organizationId: org.id, departmentId: dept.id, title: 'Teste', periodicity: 'MONTHLY',
      dueDayOfPeriod: 10, generationDayOfPeriod: 1, taxObligationTypeId: obrigacao.id,
    },
  })
  const task = await prisma.task.create({
    data: {
      title: 'Obrigação de Teste — 2026-08', columnId: column.id, departmentId: dept.id,
      competence: new Date(Date.UTC(2026, 7, 1)), recurringTemplateId: template.id, position: 0,
    },
  })
  const modelo = await prisma.documentModel.create({
    data: {
      // Escopado à própria org (não global) — necessário pro teste de isolamento por organização
      // ter sentido: um modelo global seria visível pra qualquer org e nunca provaria isolamento.
      organizationId: org.id, taxObligationTypeId: obrigacao.id, name: `Modelo de Teste ${org.id}`,
      definicao: {
        tipoImposto: 'TESTE', // bate com obrigacao.code — decidir() casa pelo tipoImposto extraído
        ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
        zonas: [
          { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
          { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
          { campo: 'numero_documento', pagina: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.02, tipo: 'texto', opcional: true },
        ],
      },
    },
  })
  return { task, modelo, client }
}

describe('processarDocumento', () => {
  it('anexa automaticamente a sugestão quando confiança alta e única tarefa candidata — mas fica PENDING (modo sombra v1 não anexa sozinho)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupObrigacaoETarefa(org, '11222333000181')

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'hash-1', storageKey: 'k1',
        uploadedById: admin.id, status: 'PENDING',
      },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('PENDING') // v1: nunca ATTACHED sozinho, só sugere
    expect(atualizado.taskId).toBe(task.id)
    expect(atualizado.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('status NOT_IDENTIFIED quando nenhum modelo reconhece o PDF', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const pdf = await gerarPdfComDocumentoArrecadacao('', '') // sem âncora nenhuma reconhecível
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-2', storageKey: 'k2', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4 sem texto algum'))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('NOT_IDENTIFIED')
  })

  it('isola modelos por organização — não reconhece com DocumentModel de outra org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-document-reader' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { modelo } = await setupObrigacaoETarefa(outraOrg, '11222333000181') // modelo pertence a OUTRA org

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-3', storageKey: 'k3', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.documentModelId).not.toBe(modelo.id)
    expect(atualizado.status).toBe('NOT_IDENTIFIED') // org atual não tem nenhum modelo que reconheça
  })

  it('PDF corrompido/com erro de parsing vira NOT_IDENTIFIED com o motivo registrado, não fica preso em PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-corrompido', storageKey: 'k-corrompido', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from('não é um PDF de verdade, vai falhar no parse'))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('NOT_IDENTIFIED')
    expect((atualizado.extractedFields as any)._erro).toBeDefined()
  })

  it('não sugere uma Task já DONE pra mesma competência — fica sem tarefa candidata', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupObrigacaoETarefa(org, '11222333000181')
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE' } })

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-4', storageKey: 'k4', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.taskId).toBeNull() // obrigação já cumprida — nenhuma tarefa aberta candidata
  })

  it('marca aviso de possível duplicata quando outro ReceivedDocument da mesma org já tem o mesmo numero_documento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await setupObrigacaoETarefa(org, '11222333000181')
    await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-anterior', storageKey: 'k-anterior', uploadedById: admin.id, status: 'ATTACHED', documentNumber: '12345678901' },
    })

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026', '12345678901')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-5', storageKey: 'k5', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(await import('@/lib/b2'), 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.documentNumber).toBe('12345678901')
    expect((atualizado.extractedFields as any)._possivelDuplicataDe).toBeDefined()
  })
})

describe('ingerirDocumento', () => {
  it('cria ReceivedDocument PENDING e enfileira o processamento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const enqueueSpy = vi.spyOn(await import('@/lib/document-reader-queue'), 'enqueueDocumentReader').mockResolvedValue()

    const doc = await ingerirDocumento(org.id, { id: admin.id }, {
      filename: 'guia.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('%PDF-1.4'),
    })

    expect(doc.status).toBe('PENDING')
    expect(doc.uploadedById).toBe(admin.id)
    expect(enqueueSpy).toHaveBeenCalledWith(doc.id)
  })

  it('lança 409 (não 500 de constraint bruta) ao reenviar o mesmo arquivo duas vezes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    vi.spyOn(await import('@/lib/document-reader-queue'), 'enqueueDocumentReader').mockResolvedValue()
    const payload = { filename: 'guia.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('conteúdo idêntico') }

    await ingerirDocumento(org.id, { id: admin.id }, payload)

    await expect(ingerirDocumento(org.id, { id: admin.id }, payload)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('mesmo arquivo em orgs diferentes não colide (hash é por organização)', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id, { slug: 'org-b-document-reader' })
    const adminA = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const adminB = await createTestUser(orgB.id, { role: 'ORG_ADMIN' })
    vi.spyOn(await import('@/lib/document-reader-queue'), 'enqueueDocumentReader').mockResolvedValue()
    const payload = { filename: 'guia.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('mesmo conteúdo') }

    await expect(ingerirDocumento(orgA.id, { id: adminA.id }, payload)).resolves.toBeDefined()
    await expect(ingerirDocumento(orgB.id, { id: adminB.id }, payload)).resolves.toBeDefined()
  })
})
