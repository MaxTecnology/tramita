import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { downloadFile, uploadFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'
import { enqueueDocumentReader } from '@/lib/document-reader-queue'
import { createAttachment } from '@/modules/attachments/attachments.service'
import { extrairEInterpretar, decidir, type Modelo, type Base } from './engine/pipeline'

async function carregarModelosDaOrg(organizationId: string): Promise<Modelo[]> {
  const registros = await prisma.documentModel.findMany({
    where: { isActive: true, OR: [{ organizationId: null }, { organizationId }] },
  })
  return registros.map((r) => ({ id: r.id, ...(r.definicao as object) }) as Modelo)
}

export async function processarDocumento(receivedDocumentId: string): Promise<void> {
  const doc = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: receivedDocumentId } })
  // downloadFile fora do try: falha de infra (B2 fora do ar) é transiente, vale a pena o retry do
  // BullMQ (attempts: 3, ver Task 8). Já a extração/interpretação do PDF em si é determinística —
  // um PDF corrompido ou grande demais nunca vai "dar certo" numa segunda tentativa, então captura
  // aqui e marca NOT_IDENTIFIED com o motivo, em vez de deixar o job se esgotar silenciosamente e o
  // documento ficar PENDING pra sempre sem nenhum sinal do que aconteceu.
  const buffer = await downloadFile(doc.storageKey)
  const modelos = await carregarModelosDaOrg(doc.organizationId)
  // pdf.js rejeita Buffer (Node) mesmo sendo subclasse de Uint8Array — exige o construtor exato.
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  let resultado
  try {
    resultado = await extrairEInterpretar(bytes, modelos)
  } catch (err) {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { status: 'NOT_IDENTIFIED', extractedFields: { _erro: err instanceof Error ? err.message : String(err) } },
    })
    return
  }

  if (resultado.status === 'sem_texto' || resultado.status === 'nao_identificado') {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { status: 'NOT_IDENTIFIED', confidence: resultado.confianca, extractedFields: resultado.campos as object },
    })
    return
  }

  const documentModelRecord = resultado.modelo
    ? await prisma.documentModel.findUnique({ where: { id: resultado.modelo } })
    : null

  const documentNumber = resultado.campos['numero_documento']?.valor
  const possivelDuplicata = typeof documentNumber === 'string' && documentNumber
    ? await prisma.receivedDocument.findFirst({
        where: { organizationId: doc.organizationId, documentNumber, id: { not: receivedDocumentId } },
        select: { id: true },
      })
    : null

  const cnpj = resultado.campos['cnpj']?.valor
  const base: Base = { clientes: [], tarefas: [] }
  if (typeof cnpj === 'string') {
    const cliente = await prisma.client.findFirst({
      where: {
        organizationId: doc.organizationId,
        OR: [{ cnpj }, { cpf: cnpj }, { cei: cnpj }, { caepf: cnpj }, { inscricaoEstadual: cnpj }],
      },
    })
    if (cliente) {
      base.clientes = [{ id: cliente.id, razao: cliente.name, cnpj }]
      const periodos = [resultado.periodo].filter((p): p is string => !!p)
      const tarefas = await prisma.task.findMany({
        where: {
          status: { notIn: ['DONE', 'DISREGARDED'] },
          column: { board: { clientId: cliente.id, organizationId: doc.organizationId } },
          recurringTemplate: { taxObligationTypeId: { not: null } },
        },
        select: { id: true, competence: true, recurringTemplate: { select: { taxObligationType: { select: { code: true } } } } },
      })
      base.tarefas = tarefas
        .filter((t) => t.recurringTemplate?.taxObligationType)
        .map((t) => ({
          id: t.id,
          clienteId: cliente.id,
          tipoImposto: t.recurringTemplate!.taxObligationType!.code,
          competencia: competenciaParaRotulo(t.competence),
          status: 'aberta' as const,
        }))
        .filter((t) => periodos.includes(t.competencia))
    }
  }

  const decisao = decidir(resultado.status, resultado.tipoImposto, [resultado.periodo], resultado.campos, resultado.avisos, base)

  await prisma.receivedDocument.update({
    where: { id: receivedDocumentId },
    data: {
      status: 'PENDING', // v1 modo sombra: nunca grava ATTACHED aqui, só sugere — fila de revisão decide
      documentModelId: documentModelRecord?.id,
      modelVersion: documentModelRecord?.version,
      confidence: resultado.confianca,
      extractedFields: resultado.campos as object,
      documentNumber: typeof documentNumber === 'string' ? documentNumber : undefined,
      // Não bloqueia — só um aviso pra fila de revisão (ver Task 10/14). Guardamos o id do
      // possível duplicado dentro de extractedFields pra não precisar de coluna nova só pra isso.
      taskId: decisao.acao === 'anexar' ? decisao.tarefaId : undefined,
    },
  })

  if (possivelDuplicata) {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { extractedFields: { ...(resultado.campos as object), _possivelDuplicataDe: possivelDuplicata.id } },
    })
  }
}

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
  return org?.slug ?? organizationId
}

export async function ingerirDocumento(
  organizationId: string,
  actor: { id: string },
  payload: { filename: string; mimeType: string; size: number; buffer: Buffer },
) {
  const fileHash = createHash('sha256').update(payload.buffer).digest('hex')

  const existente = await prisma.receivedDocument.findUnique({
    where: { organizationId_fileHash: { organizationId, fileHash } },
  })
  if (existente) throw new AppError(409, 'Esse arquivo já foi enviado antes')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `document-reader/${orgSlug}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  let doc
  try {
    doc = await prisma.receivedDocument.create({
      data: { organizationId, fileHash, storageKey, uploadedById: actor.id, status: 'PENDING' },
    })
  } catch (err) {
    // Janela de corrida: duas requisições concorrentes com o mesmo arquivo passam juntas pelo
    // findUnique acima — mesma classe de proteção já usada em protocols.service.ts::createProtocol.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Esse arquivo já foi enviado antes')
    }
    throw err
  }

  await enqueueDocumentReader(doc.id)
  return doc
}

export async function listarFilaDeRevisao(organizationId: string) {
  return prisma.receivedDocument.findMany({
    where: { organizationId, status: { in: ['PENDING', 'NOT_IDENTIFIED'] } },
    orderBy: { createdAt: 'asc' },
  })
}

async function anexarDocumento(
  receivedDocumentId: string,
  organizationId: string,
  taskId: string,
  actor: { id: string; role: string },
  how: 'confirmado' | 'trocado' | 'criado',
) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')

  const buffer = await downloadFile(doc.storageKey)
  const filename = doc.storageKey.split('/').pop() ?? 'documento.pdf'
  const attachment = await createAttachment(taskId, organizationId, actor, {
    filename, mimeType: 'application/pdf', size: buffer.length, buffer,
  })

  await prisma.receivedDocument.update({
    where: { id: receivedDocumentId },
    data: { status: 'ATTACHED', taskId, attachmentId: attachment.id, how, reviewedById: actor.id, reviewedAt: new Date() },
  })
  return attachment
}

export async function confirmarSugestao(receivedDocumentId: string, organizationId: string, actor: { id: string; role: string }) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  if (!doc.taskId) throw new AppError(422, 'Esse documento não tem tarefa sugerida — use trocarTarefa')
  return anexarDocumento(receivedDocumentId, organizationId, doc.taskId, actor, 'confirmado')
}

export async function trocarTarefa(receivedDocumentId: string, organizationId: string, taskId: string, actor: { id: string; role: string }) {
  return anexarDocumento(receivedDocumentId, organizationId, taskId, actor, 'trocado')
}

export async function rejeitarDocumento(receivedDocumentId: string, organizationId: string, actor: { id: string; role: string }) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  await prisma.receivedDocument.update({
    where: { id: receivedDocumentId },
    data: { status: 'REJECTED', how: 'rejeitado', reviewedById: actor.id, reviewedAt: new Date() },
  })
}

export async function reabrirDocumento(receivedDocumentId: string, organizationId: string) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  await prisma.receivedDocument.update({ where: { id: receivedDocumentId }, data: { status: 'PENDING' } })
}

// Task.competence é um mês-âncora (DateTime, UTC) — converte pro rótulo "2026-08" que o motor usa
// no casamento. Trimestral/anual também guardam um único mês-âncora (sem campo de cota — ver spec).
function competenciaParaRotulo(competence: Date | null): string {
  if (!competence) return ''
  return `${competence.getUTCFullYear()}-${String(competence.getUTCMonth() + 1).padStart(2, '0')}`
}
