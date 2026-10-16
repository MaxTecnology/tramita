// apps/api/src/modules/document-reader/document-reader.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  processarDocumento, ingerirDocumento,
  confirmarSugestao, trocarTarefa, rejeitarDocumento, reabrirDocumento, listarFilaDeRevisao,
  obterMetricas,
} from './document-reader.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestDepartment, createTestTask,
} from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

import * as b2Module from '@/lib/b2'

// ingerirDocumento sempre chama uploadFile (real, não mockado por padrão como o vi.mock fazia) —
// default aqui evita repetir o spy em todo teste que só se importa com o resto do fluxo.
beforeEach(() => {
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
})

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
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(pdf))

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
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4 sem texto algum'))

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
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(pdf))

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
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('não é um PDF de verdade, vai falhar no parse'))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('NOT_IDENTIFIED')
    expect((atualizado.extractedFields as any)._erro).toBeDefined()
  })

  it('casa DARF trimestral: Task guarda o mês-âncora (2026-06), PDF traz a linha PA trimestral (2026-T2) — tem que casar pelo competenciaCab, não só pelo periodo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id, { cnpj: '11222333000181' })
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const obrigacao = await prisma.taxObligationType.create({
      data: { code: 'TESTE-TRI', name: 'Obrigação Trimestral de Teste', organizationId: null },
    })
    const template = await prisma.recurringTaskTemplate.create({
      data: {
        organizationId: org.id, departmentId: dept.id, title: 'Teste Trimestral', periodicity: 'QUARTERLY',
        dueDayOfPeriod: 10, generationDayOfPeriod: 1, dueMonthAnchor: 2, taxObligationTypeId: obrigacao.id,
      },
    })
    const task = await prisma.task.create({
      data: {
        title: 'Obrigação Trimestral — 2026-T2', columnId: column.id, departmentId: dept.id,
        competence: new Date(Date.UTC(2026, 5, 1)), recurringTemplateId: template.id, position: 0,
      },
    })
    await prisma.documentModel.create({
      data: {
        organizationId: org.id, taxObligationTypeId: obrigacao.id, name: 'Modelo Trimestral de Teste',
        definicao: {
          tipoImposto: 'TESTE-TRI',
          ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
          zonas: [
            { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
            { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
            { campo: 'pa', pagina: 1, x: 0.1, y: 0.25, w: 0.3, h: 0.02, tipo: 'periodo_apuracao' },
          ],
        },
      },
    })

    const pdfTrimestral = await gerarPdfComDocumentoArrecadacao(
      '11.222.333/0001-81', 'junho/2026', undefined, 'PA:2º Trimestre/2026',
    )

    const receivedDoc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-trimestral', storageKey: 'k-trimestral', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(pdfTrimestral))

    await processarDocumento(receivedDoc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: receivedDoc.id } })
    expect(atualizado.taskId).toBe(task.id)
  })

  it('casa cliente mesmo quando o CNPJ foi cadastrado com máscara (como o formulário salva por padrão)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupObrigacaoETarefa(org, '11.222.333/0001-81') // com máscara, não só dígitos

    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'hash-mascara', storageKey: 'k-mascara', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.taskId).toBe(task.id)
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
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(pdf))

    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.taskId).toBeNull() // obrigação já cumprida — nenhuma tarefa aberta candidata
    expect((atualizado.extractedFields as any)._motivo).toContain('Sem tarefa aberta')
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
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(pdf))

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

describe('ações da fila de revisão', () => {
  async function docComSugestao() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id, { departmentId: dept.id })
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'h', storageKey: 'k', uploadedById: admin.id, status: 'PENDING', taskId: task.id },
    })
    return { org, admin, task, doc }
  }

  it('confirmarSugestao anexa via createAttachment e marca ATTACHED', async () => {
    const { org, admin, task, doc } = await docComSugestao()
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)

    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('ATTACHED')
    expect(atualizado.how).toBe('confirmado')
    expect(atualizado.attachmentId).not.toBeNull()
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: atualizado.attachmentId! } })
    expect(attachment.taskId).toBe(task.id)
  })

  it('o Attachment criado usa o nome original do arquivo, sem o prefixo de timestamp da storageKey', async () => {
    const { org, admin, doc } = await docComSugestao()
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { storageKey: `document-reader/x/${Date.now()}-guia-das-agosto.pdf` } })
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)

    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: atualizado.attachmentId! } })
    expect(attachment.filename).toBe('guia-das-agosto.pdf')
  })

  it('trocarTarefa anexa na tarefa escolhida pelo revisor, não na sugerida', async () => {
    const { org, admin, doc } = await docComSugestao()
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const outraTask = await createTestTask(column.id, admin.id, { departmentId: dept.id })
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)

    await trocarTarefa(doc.id, org.id, outraTask.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.how).toBe('trocado')
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: atualizado.attachmentId! } })
    expect(attachment.taskId).toBe(outraTask.id)
  })

  it('rejeitarDocumento marca REJECTED sem criar anexo', async () => {
    const { org, admin, doc } = await docComSugestao()

    await rejeitarDocumento(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('REJECTED')
    expect(atualizado.attachmentId).toBeNull()
  })

  it('reabrirDocumento volta REJECTED pra PENDING', async () => {
    const { org, admin, doc } = await docComSugestao()
    await rejeitarDocumento(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    await reabrirDocumento(doc.id, org.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('PENDING')
  })

  it('confirmarSugestao num documento já ATTACHED lança 409 e não cria um segundo anexo (duplo clique / duas abas)', async () => {
    const { org, admin, task, doc } = await docComSugestao()
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    await expect(confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })).rejects.toMatchObject({ statusCode: 409 })

    const anexos = await prisma.attachment.findMany({ where: { taskId: task.id } })
    expect(anexos).toHaveLength(1)
  })

  it('rejeitarDocumento num documento já ATTACHED lança 409 — não pode rejeitar o que já foi anexado', async () => {
    const { org, admin, doc } = await docComSugestao()
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    await expect(rejeitarDocumento(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('reabrirDocumento num documento que não está REJECTED lança 409', async () => {
    const { org, doc } = await docComSugestao()

    await expect(reabrirDocumento(doc.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('reabrirDocumento recusa reabrir um documento já expurgado pelo cron LGPD (arquivo não existe mais no B2)', async () => {
    const { org, admin, doc } = await docComSugestao()
    await rejeitarDocumento(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })
    // Simula o expurgo do cron: storageKey vazia é como ele marca "arquivo apagado do B2".
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { storageKey: '' } })

    await expect(reabrirDocumento(doc.id, org.id)).rejects.toMatchObject({ statusCode: 422 })
  })

  it('processarDocumento não reverte um documento que um humano já confirmou enquanto o job rodava', async () => {
    const { org, admin, doc } = await docComSugestao()
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
    await confirmarSugestao(doc.id, org.id, { id: admin.id, role: 'ORG_ADMIN' })

    // simula o worker rodando de novo (ex.: retry do BullMQ) sobre um documento já decidido por humano
    await processarDocumento(doc.id)

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('ATTACHED')
  })

  it('listarFilaDeRevisao só mostra PENDING/NOT_IDENTIFIED da própria org', async () => {
    const { org, doc } = await docComSugestao()
    const plan = await createTestPlan()
    const outraOrg = await createTestOrg(plan.id)
    const outroAdmin = await createTestUser(outraOrg.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: { organizationId: outraOrg.id, fileHash: 'h2', storageKey: 'k2', uploadedById: outroAdmin.id, status: 'PENDING' },
    })

    const fila = await listarFilaDeRevisao(org.id)

    expect(fila.map((d) => d.id)).toEqual([doc.id])
  })

  it('listarFilaDeRevisao inclui o nome do arquivo original e, quando há sugestão, a tarefa e o cliente', async () => {
    const { org, task, doc } = await docComSugestao()
    // storageKey tem o padrão document-reader/<org>/<timestamp>-<nome-original>.pdf — a fila
    // precisa mostrar só o nome original, não a chave de armazenamento inteira.
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { storageKey: `document-reader/x/${Date.now()}-guia-das-agosto.pdf` } })

    const fila = await listarFilaDeRevisao(org.id)

    expect(fila[0].filename).toBe('guia-das-agosto.pdf')
    expect(fila[0].task?.id).toBe(task.id)
    expect(fila[0].task?.client.name).toBeDefined()
  })
})

describe('obterUrlVisualizacao', () => {
  it('devolve uma URL assinada pro PDF, pro revisor conferir o documento antes de decidir', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'h-view', storageKey: 'k-view', uploadedById: admin.id, status: 'PENDING' },
    })
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://b2.example.com/signed-url')

    const { obterUrlVisualizacao } = await import('./document-reader.service')
    const url = await obterUrlVisualizacao(doc.id, org.id)

    expect(url).toBe('https://b2.example.com/signed-url')
    expect(b2Module.getSignedDownloadUrl).toHaveBeenCalledWith('k-view')
  })

  it('lança 404 pra documento de outra org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-view' })
    const admin = await createTestUser(outraOrg.id, { role: 'ORG_ADMIN' })
    const doc = await prisma.receivedDocument.create({
      data: { organizationId: outraOrg.id, fileHash: 'h-view-2', storageKey: 'k-view-2', uploadedById: admin.id, status: 'PENDING' },
    })

    const { obterUrlVisualizacao } = await import('./document-reader.service')
    await expect(obterUrlVisualizacao(doc.id, org.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('listarObrigacoesFiscais', () => {
  it('lista obrigações globais e privadas da org, não as de outras orgs', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-obrigacoes' })
    const global = await prisma.taxObligationType.create({ data: { code: 'GLOBAL-TESTE', name: 'Global', organizationId: null } })
    const privada = await prisma.taxObligationType.create({ data: { code: 'PRIVADA-TESTE', name: 'Privada', organizationId: org.id } })
    await prisma.taxObligationType.create({ data: { code: 'OUTRA-ORG-TESTE', name: 'De outra org', organizationId: outraOrg.id } })

    const { listarObrigacoesFiscais } = await import('./document-reader.service')
    const obrigacoes = await listarObrigacoesFiscais(org.id)

    expect(obrigacoes.map((o) => o.id).sort()).toEqual([global.id, privada.id].sort())
  })
})

describe('obterMetricas', () => {
  it('conta só decisão humana (how), por modelo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await prisma.taxObligationType.create({ data: { code: 'T', name: 'T', organizationId: null } })
    const modelo = await prisma.documentModel.create({ data: { organizationId: null, taxObligationTypeId: obrigacao.id, name: 'Modelo X', definicao: {} } })
    await prisma.receivedDocument.createMany({
      data: [
        { organizationId: org.id, fileHash: 'h1', storageKey: 'k1', uploadedById: admin.id, status: 'ATTACHED', how: 'confirmado', documentModelId: modelo.id },
        { organizationId: org.id, fileHash: 'h2', storageKey: 'k2', uploadedById: admin.id, status: 'ATTACHED', how: 'trocado', documentModelId: modelo.id },
        { organizationId: org.id, fileHash: 'h3', storageKey: 'k3', uploadedById: admin.id, status: 'REJECTED', how: 'rejeitado', documentModelId: modelo.id },
        { organizationId: org.id, fileHash: 'h4', storageKey: 'k4', uploadedById: admin.id, status: 'PENDING' }, // ainda não é decisão humana
      ],
    })

    const metricas = await obterMetricas(org.id)

    expect(metricas.porModelo).toEqual([
      { documentModelId: modelo.id, nome: 'Modelo X', confirmados: 1, trocados: 1, rejeitados: 1 },
    ])
  })
})
