import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { downloadFile, uploadFile, deleteFile, getSignedDownloadUrl } from '@/lib/b2'
import { logger } from '@/lib/logger'
import { getOrgSlug } from '@/lib/org-slug'
import { AppError } from '@/errors/AppError'
import { enqueueDocumentReader } from '@/lib/document-reader-queue'
import { createAttachment } from '@/modules/attachments/attachments.service'
import { extrairEInterpretar, decidir, type Modelo, type Base } from './engine/pipeline'
import { soDigitos } from './engine/validadores'

// Estados em que um ReceivedDocument ainda aguarda decisão humana — único momento em que o worker
// (processarDocumento) ou uma ação da fila de revisão têm permissão de mudar o status.
const AGUARDANDO_REVISAO: ('PENDING' | 'NOT_IDENTIFIED')[] = ['PENDING', 'NOT_IDENTIFIED']

export async function carregarModelosDaOrg(organizationId: string): Promise<Modelo[]> {
  const registros = await prisma.documentModel.findMany({
    where: { isActive: true, OR: [{ organizationId: null }, { organizationId }] },
  })
  // id SEMPRE por último no spread: alguns `definicao` (os 4 modelos globais semeados, herdados da
  // POC) trazem seu próprio campo "id" (ex.: "darf-rfb", um slug legível, não um cuid) — se viesse
  // antes do spread, esse "id" interno sobrescreveria o id real do DocumentModel, e
  // `prisma.documentModel.findUnique({ where: { id: resultado.modelo } })` em processarDocumento()
  // nunca encontraria o registro, deixando `documentModelId` sempre null (achado ao preparar o
  // Plano B — bug presente desde o Plano A, nunca pego pelos testes porque nenhum deles usava uma
  // `definicao` com campo "id" próprio).
  return registros.map((r) => ({ ...(r.definicao as object), id: r.id }) as Modelo)
}

// Compara por dígitos (não string crua) — o cadastro de Client grava o CNPJ como o usuário digitou
// (com máscara), mas o motor extrai só dígitos; comparar string-a-string nunca bateria com um
// cliente real. Busca em ordem de prioridade (CNPJ > CPF > CEI > CAEPF > IE), conforme a spec.
async function resolverClientePorIdentificador(organizationId: string, identificador: string) {
  const alvo = soDigitos(identificador)
  if (!alvo) return null

  const clientes = await prisma.client.findMany({
    where: { organizationId },
    select: { id: true, name: true, cnpj: true, cpf: true, cei: true, caepf: true, inscricaoEstadual: true },
  })

  for (const campo of ['cnpj', 'cpf', 'cei', 'caepf', 'inscricaoEstadual'] as const) {
    const achado = clientes.find((c) => c[campo] && soDigitos(c[campo]!) === alvo)
    if (achado) return achado
  }
  return null
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
    // Guarda por status: se um humano já decidiu (ATTACHED/REJECTED) enquanto este job rodava —
    // ex.: retry do BullMQ depois de um timeout, ou uma segunda tentativa agendada — a decisão
    // humana nunca pode ser revertida por um resultado atrasado do worker.
    await prisma.receivedDocument.updateMany({
      where: { id: receivedDocumentId, status: 'PENDING' },
      data: { status: 'NOT_IDENTIFIED', extractedFields: { _erro: err instanceof Error ? err.message : String(err) } },
    })
    return
  }

  if (resultado.status === 'sem_texto' || resultado.status === 'nao_identificado') {
    await prisma.receivedDocument.updateMany({
      where: { id: receivedDocumentId, status: 'PENDING' },
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
    const cliente = await resolverClientePorIdentificador(doc.organizationId, cnpj)
    if (cliente) {
      base.clientes = [{ id: cliente.id, razao: cliente.name, cnpj }]
      // Trimestral: Task.competence guarda o mês-âncora ("2026-06"), não o rótulo "2026-T2" do
      // motor — aceitamos os dois como período válido pra não perder o casamento (regressão vs.
      // a POC original, que já passava ambos pro decidir()).
      const periodos = [resultado.periodo, resultado.competenciaCab].filter((p): p is string => !!p)
      const tarefas = await prisma.task.findMany({
        where: {
          status: { notIn: ['DONE', 'DISREGARDED'] },
          column: { board: { clientId: cliente.id, organizationId: doc.organizationId } },
          recurringTemplate: { obligationTypeId: { not: null } },
        },
        select: { id: true, competence: true, recurringTemplate: { select: { obligationType: { select: { code: true } } } } },
      })
      base.tarefas = tarefas
        .filter((t) => t.recurringTemplate?.obligationType)
        .map((t) => ({
          id: t.id,
          clienteId: cliente.id,
          tipoImposto: t.recurringTemplate!.obligationType!.code,
          competencia: competenciaParaRotulo(t.competence),
          status: 'aberta' as const,
        }))
        .filter((t) => periodos.includes(t.competencia))
    }
  }

  const decisao = decidir(
    resultado.status, resultado.tipoImposto, [resultado.periodo, resultado.competenciaCab],
    resultado.campos, resultado.avisos, base,
  )

  const atualizado = await prisma.receivedDocument.updateMany({
    where: { id: receivedDocumentId, status: 'PENDING' },
    data: {
      status: 'PENDING', // v1 modo sombra: nunca grava ATTACHED aqui, só sugere — fila de revisão decide
      documentModelId: documentModelRecord?.id,
      modelVersion: documentModelRecord?.version,
      confidence: resultado.confianca,
      // _motivo é o texto que decidir() já produz pra explicar a decisão ("cliente não
      // encontrado", "sem tarefa aberta", "conflito de modelos"...) — sem isso o revisor via o
      // card na fila sem nenhuma pista de por que o motor não anexou sozinho.
      extractedFields: { ...(resultado.campos as object), _motivo: decisao.motivo },
      documentNumber: typeof documentNumber === 'string' ? documentNumber : undefined,
      // Não bloqueia — só um aviso pra fila de revisão (ver Task 10/14). Guardamos o id do
      // possível duplicado dentro de extractedFields pra não precisar de coluna nova só pra isso.
      taskId: decisao.acao === 'anexar' ? decisao.tarefaId : undefined,
    },
  })

  if (atualizado.count > 0 && possivelDuplicata) {
    await prisma.receivedDocument.update({
      where: { id: receivedDocumentId },
      data: { extractedFields: { ...(resultado.campos as object), _motivo: decisao.motivo, _possivelDuplicataDe: possivelDuplicata.id } },
    })
  }
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
      // O upload já aconteceu antes do create — sem isso o objeto fica órfão no B2 pra sempre,
      // já que nenhum ReceivedDocument vai apontar pra ele (a requisição que ganhou a corrida tem
      // o seu próprio storageKey). Falha ao apagar não deve esconder o 409 real do cliente.
      await deleteFile(storageKey).catch((delErr) => logger.error({ err: delErr, storageKey }, 'Falha ao limpar upload órfão após P2002 de dedupe'))
      throw new AppError(409, 'Esse arquivo já foi enviado antes')
    }
    throw err
  }

  await enqueueDocumentReader(doc.id)
  return doc
}

export async function obterUrlVisualizacao(receivedDocumentId: string, organizationId: string): Promise<string> {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  if (!doc.storageKey) throw new AppError(422, 'Esse documento já foi expurgado — o arquivo não existe mais')
  return getSignedDownloadUrl(doc.storageKey)
}

export async function listarObrigacoes(organizationId: string) {
  return prisma.obligationType.findMany({
    where: { isActive: true, OR: [{ organizationId: null }, { organizationId }] },
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  })
}

// storageKey é "document-reader/<org>/<timestamp>-<nome-original>.ext" (ver ingerirDocumento) — a
// fila de revisão mostra só o nome original, nunca a chave de armazenamento inteira.
function filenameDaStorageKey(storageKey: string): string {
  const base = storageKey.split('/').pop() ?? storageKey
  return base.replace(/^\d+-/, '')
}

export async function listarFilaDeRevisao(organizationId: string) {
  const docs = await prisma.receivedDocument.findMany({
    where: { organizationId, status: { in: ['PENDING', 'NOT_IDENTIFIED'] } },
    orderBy: { createdAt: 'asc' },
    include: {
      task: {
        select: {
          id: true, title: true, competence: true,
          column: { select: { board: { select: { client: { select: { name: true } } } } } },
        },
      },
    },
  })

  return docs.map((doc) => {
    const { task, ...rest } = doc
    return {
      ...rest,
      filename: filenameDaStorageKey(doc.storageKey),
      task: task ? { id: task.id, title: task.title, competence: task.competence, client: task.column.board.client } : null,
    }
  })
}

export async function listarRejeitados(organizationId: string) {
  const docs = await prisma.receivedDocument.findMany({
    where: { organizationId, status: 'REJECTED' },
    orderBy: { reviewedAt: 'desc' },
    include: { reviewedBy: { select: { id: true, name: true } } },
  })

  return docs.map((doc) => ({
    ...doc,
    filename: filenameDaStorageKey(doc.storageKey),
  }))
}

async function buscarDocumentoRevisavel(receivedDocumentId: string, organizationId: string) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  if (!AGUARDANDO_REVISAO.includes(doc.status as 'PENDING' | 'NOT_IDENTIFIED')) {
    throw new AppError(409, `Documento não está mais aguardando revisão (status atual: ${doc.status})`)
  }
  return doc
}

// Só vale pra 'trocado' (trocarTarefa) — a tarefa de 'confirmado' já veio do casamento automático
// por CNPJ (resolverClientePorIdentificador), então já está validada; 'trocado' é justamente o
// caminho onde um humano escolhe a tarefa livremente na fila de revisão, sem nenhuma garantia de
// que bate com o cliente do documento. Se o documento não tem CNPJ extraído com `valido: true`
// (upload manual, ou o motor não achou o campo), não há o que validar — segue sem bloquear.
async function assertCnpjBateComTarefa(doc: { organizationId: string; extractedFields: unknown }, taskId: string) {
  const campos = doc.extractedFields as Record<string, { bruto: string; valor: string | number | null; valido: boolean }> | null
  const cnpjExtraido = campos?.cnpj
  if (!cnpjExtraido?.valido || !cnpjExtraido.valor) return

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { column: { select: { board: { select: { client: { select: { name: true, cnpj: true, cpf: true, cei: true, caepf: true, inscricaoEstadual: true } } } } } } },
  })
  if (!task) return // taskId inválido — createAttachment logo abaixo lança o erro certo

  const alvo = soDigitos(String(cnpjExtraido.valor))
  const cliente = task.column.board.client
  const bate = (['cnpj', 'cpf', 'cei', 'caepf', 'inscricaoEstadual'] as const).some(
    (campo) => cliente[campo] && soDigitos(cliente[campo]!) === alvo,
  )
  if (!bate) {
    throw new AppError(
      422,
      `O CNPJ lido no documento (${cnpjExtraido.bruto}) não bate com o cliente "${cliente.name}" dessa tarefa — confirme se escolheu a tarefa certa`,
    )
  }
}

async function anexarDocumento(
  receivedDocumentId: string,
  organizationId: string,
  taskId: string,
  actor: { id: string; role: string },
  how: 'confirmado' | 'trocado' | 'criado',
) {
  const doc = await buscarDocumentoRevisavel(receivedDocumentId, organizationId)
  if (how === 'trocado') await assertCnpjBateComTarefa(doc, taskId)

  const buffer = await downloadFile(doc.storageKey)
  const filename = filenameDaStorageKey(doc.storageKey)
  const attachment = await createAttachment(taskId, organizationId, actor, {
    filename, mimeType: 'application/pdf', size: buffer.length, buffer,
  })

  // Guarda de novo no update final (não só no findFirst inicial) — fecha a janela entre o check e
  // o createAttachment acima: se outra revisão venceu a corrida nesse meio-tempo, não sobrescreve.
  const finalizado = await prisma.receivedDocument.updateMany({
    where: { id: receivedDocumentId, status: { in: AGUARDANDO_REVISAO } },
    data: { status: 'ATTACHED', taskId, attachmentId: attachment.id, how, reviewedById: actor.id, reviewedAt: new Date() },
  })
  if (finalizado.count === 0) {
    throw new AppError(409, 'Documento foi revisado por outra pessoa enquanto este anexo era criado')
  }
  return attachment
}

export async function confirmarSugestao(receivedDocumentId: string, organizationId: string, actor: { id: string; role: string }) {
  const doc = await buscarDocumentoRevisavel(receivedDocumentId, organizationId)
  if (!doc.taskId) throw new AppError(422, 'Esse documento não tem tarefa sugerida — use trocarTarefa')
  return anexarDocumento(receivedDocumentId, organizationId, doc.taskId, actor, 'confirmado')
}

export async function trocarTarefa(receivedDocumentId: string, organizationId: string, taskId: string, actor: { id: string; role: string }) {
  return anexarDocumento(receivedDocumentId, organizationId, taskId, actor, 'trocado')
}

export async function rejeitarDocumento(receivedDocumentId: string, organizationId: string, actor: { id: string; role: string }) {
  await buscarDocumentoRevisavel(receivedDocumentId, organizationId)
  const resultado = await prisma.receivedDocument.updateMany({
    where: { id: receivedDocumentId, organizationId, status: { in: AGUARDANDO_REVISAO } },
    data: { status: 'REJECTED', how: 'rejeitado', reviewedById: actor.id, reviewedAt: new Date() },
  })
  if (resultado.count === 0) throw new AppError(409, 'Documento foi revisado por outra pessoa')
}

export async function reabrirDocumento(receivedDocumentId: string, organizationId: string) {
  const doc = await prisma.receivedDocument.findFirst({ where: { id: receivedDocumentId, organizationId } })
  if (!doc) throw new AppError(404, 'Documento não encontrado')
  if (!doc.storageKey) {
    throw new AppError(422, 'Esse documento já foi expurgado (LGPD, 30 dias) — o arquivo não existe mais, não é possível reabrir')
  }
  const resultado = await prisma.receivedDocument.updateMany({
    where: { id: receivedDocumentId, organizationId, status: 'REJECTED' },
    data: { status: 'PENDING', how: null, reviewedById: null, reviewedAt: null },
  })
  if (resultado.count === 0) throw new AppError(409, `Só é possível reabrir um documento REJECTED (status atual: ${doc.status})`)
}

export async function obterMetricas(organizationId: string) {
  const docs = await prisma.receivedDocument.findMany({
    where: { organizationId, how: { in: ['confirmado', 'trocado', 'rejeitado'] }, documentModelId: { not: null } },
    select: { how: true, documentModel: { select: { id: true, name: true } } },
  })

  const porModeloMap = new Map<string, { documentModelId: string; nome: string; confirmados: number; trocados: number; rejeitados: number }>()
  for (const d of docs) {
    if (!d.documentModel) continue
    const entry = porModeloMap.get(d.documentModel.id) ?? {
      documentModelId: d.documentModel.id, nome: d.documentModel.name, confirmados: 0, trocados: 0, rejeitados: 0,
    }
    if (d.how === 'confirmado') entry.confirmados++
    else if (d.how === 'trocado') entry.trocados++
    else if (d.how === 'rejeitado') entry.rejeitados++
    porModeloMap.set(d.documentModel.id, entry)
  }

  return { porModelo: [...porModeloMap.values()] }
}

// Task.competence é um mês-âncora (DateTime, UTC) — converte pro rótulo "2026-08" que o motor usa
// no casamento. Trimestral/anual também guardam um único mês-âncora (sem campo de cota — ver spec).
function competenciaParaRotulo(competence: Date | null): string {
  if (!competence) return ''
  return `${competence.getUTCFullYear()}-${String(competence.getUTCMonth() + 1).padStart(2, '0')}`
}
