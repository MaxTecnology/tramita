// apps/api/src/modules/protocols/protocols.service.ts
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { onProtocolCreated } from '@/modules/inbox/inbox-events'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import { getSignedDownloadUrl } from '@/lib/b2'
import { utcDayLabel, todayInBRT } from '@/lib/date-only'
import { formatBRL, parseMoney } from '@/lib/money'
import { actorScope, protocolWhere } from '@/modules/staff-scope/staff-scope'
import type { CreateProtocolBody } from './protocols.schema'
import type { ProtocolStatus } from '@prisma/client'

interface ProtocolDetail {
  id: string
  number: string
  title: string
  content: string | null
  status: ProtocolStatus
  dueDate: Date | null
  client: { name: string }
  attachment: { filename: string } | null
  events: { type: string; actorName: string | null; actorEmail: string | null; ip: string | null; createdAt: Date }[]
}

async function nextProtocolNumber(organizationId: string): Promise<string> {
  // getUTCFullYear() já viraria o ano pros últimos instantes de 31/dez em BRT (21h-24h BRT =
  // 00h-03h UTC do dia 1º de janeiro) — mesma classe de bug corrigida em todo lugar date-only
  // deste módulo, aqui no ano usado pra numerar o protocolo.
  const year = new Date(todayInBRT(new Date())).getUTCFullYear()
  const counter = await prisma.protocolCounter.upsert({
    where: { organizationId_year: { organizationId, year } },
    create: { organizationId, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  })
  return `${year}-${String(counter.lastNumber).padStart(6, '0')}`
}

export async function createProtocol(
  taskId: string,
  organizationId: string,
  staffId: string,
  data: Omit<CreateProtocolBody, 'dueDate' | 'requiresPayment'> & { dueDate?: Date; requiresPayment?: boolean },
) {
  if (!data.attachmentId && !data.content) {
    throw new AppError(400, 'Informe um anexo existente ou um texto pro protocolo')
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  if (!task.visibleToClient) {
    throw new AppError(422, 'Só é possível criar protocolo numa tarefa visível ao cliente')
  }

  if (data.attachmentId) {
    const attachment = await prisma.attachment.findFirst({ where: { id: data.attachmentId, taskId } })
    if (!attachment) throw new AppError(404, 'Anexo não encontrado nesta tarefa')
    // Protocol.attachmentId é @unique no schema — sem este check, a segunda tentativa de usar o
    // mesmo anexo cairia num P2002 bruto (500) em vez de um erro de validação claro.
    const alreadyLinked = await prisma.protocol.findFirst({ where: { attachmentId: data.attachmentId } })
    if (alreadyLinked) throw new AppError(409, 'Esse anexo já está vinculado a outro protocolo')
  }

  const requiresPayment = data.requiresPayment ?? false
  return insertProtocol({
    organizationId,
    clientId: task.column.board.clientId,
    taskId,
    attachmentId: data.attachmentId,
    title: data.title,
    content: data.content,
    dueDate: data.dueDate,
    competence: task.competence,
    requiresPayment,
    amount: requiresPayment && data.amount ? parseMoney(data.amount) : null,
    createdById: staffId,
  })
}

export interface InsertProtocolInput {
  organizationId: string
  clientId: string
  taskId: string
  title: string
  createdById: string
  attachmentId?: string
  content?: string
  dueDate?: Date | null
  competence?: Date | null
  requiresPayment?: boolean
  amount?: string | null
  deliverableId?: string
}

// "Valor: R$ 1.234,56 — vencimento 20/11/2026" for payment guides, '' otherwise (template var
// {{paymentInfo}} of PROTOCOL_CREATED).
export function buildPaymentInfo(p: { requiresPayment: boolean; amount: { toString(): string } | null; dueDate: Date | null }): string {
  if (!p.requiresPayment || !p.amount) return ''
  const due = p.dueDate ? ` — vencimento ${p.dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''
  return `\nValor: ${formatBRL(p.amount)}${due}`
}

// Single writer of new protocols (manual and generated from a delivery): number, SENT event and
// PROTOCOL_CREATED notification.
export async function insertProtocol(input: InsertProtocolInput) {
  const number = await nextProtocolNumber(input.organizationId)

  let protocol
  try {
    protocol = await prisma.protocol.create({
      data: {
        organizationId: input.organizationId,
        number,
        clientId: input.clientId,
        taskId: input.taskId,
        attachmentId: input.attachmentId,
        title: input.title,
        content: input.content,
        dueDate: input.dueDate ?? undefined,
        competence: input.competence ?? undefined,
        requiresPayment: input.requiresPayment ?? false,
        amount: input.amount ?? undefined,
        deliverableId: input.deliverableId,
        createdById: input.createdById,
      },
    })
  } catch (err) {
    // A checagem de "já vinculado" em createProtocol tem uma janela de corrida (duas requisições
    // concorrentes pro mesmo anexo passam as duas pelo findFirst antes de qualquer insert) — sem
    // isso, a perdedora cairia num P2002 bruto (500) em vez do mesmo erro de validação claro.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'Esse anexo já está vinculado a outro protocolo')
    }
    throw err
  }

  const staffUser = await prisma.user.findUnique({ where: { id: input.createdById }, select: { name: true, email: true } })
  await prisma.protocolEvent.create({
    data: {
      protocolId: protocol.id,
      type: 'SENT',
      actorType: 'user',
      actorId: input.createdById,
      actorName: staffUser?.name ?? null,
      actorEmail: staffUser?.email ?? null,
    },
  })

  await enqueueNotification({
    event: 'PROTOCOL_CREATED',
    organizationId: input.organizationId,
    clientId: input.clientId,
    taskId: input.taskId,
    metadata: { protocolTitle: input.title, paymentInfo: buildPaymentInfo(protocol) },
  })
  await onProtocolCreated(protocol.id, input.taskId, input.title, { userId: input.createdById, name: staffUser?.name ?? 'Escritório' })

  return protocol
}

export async function listProtocolsForOrg(
  organizationId: string,
  actor: { id: string; role: string },
  filters: { status?: ProtocolStatus; clientId?: string; from?: Date; to?: Date },
) {
  const scope = await actorScope(actor, organizationId)
  const protocols = await prisma.protocol.findMany({
    where: {
      organizationId,
      // Staff scope (role + department): the same documents the user can open
      ...protocolWhere(scope),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      // boardId achatado abaixo — o Dashboard (Task 11) linka pro board, não existe rota de
      // task isolada no app (mesmo padrão já resolvido na feature de Solicitações).
      task: { select: { column: { select: { boardId: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return protocols.map(({ task, ...rest }) => ({ ...rest, boardId: task.column.boardId }))
}

export async function listProtocolsForTask(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, column: { board: { organizationId } } } })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  return prisma.protocol.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' } })
}

export interface ClientProtocolFilters {
  status?: ProtocolStatus
  search?: string
  competence?: string // 'YYYY-MM'
  departmentId?: string
  dueFrom?: Date
  dueTo?: Date
  paymentStatus?: 'unpaid' | 'paid'
  from?: Date
  to?: Date
}

// "Documentos recebidos" do portal. A document sent to the client never disappears when its task is
// later hidden (the client and the company owner keep the history); only a cancellation removes it.
export async function listProtocolsForClient(
  organizationId: string,
  clientId: string,
  clientUserId: string,
  filters: ClientProtocolFilters,
) {
  const scope = await getClientAccessScope(clientUserId)
  const departmentIds = scope.departmentIdsByClient.get(clientId)
  if (!departmentIds || departmentIds.size === 0) return []
  if (filters.departmentId && !departmentIds.has(filters.departmentId)) return []

  const competence = filters.competence ? (() => {
    const [y, m] = filters.competence!.split('-').map(Number)
    return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }
  })() : undefined

  const rows = await prisma.protocol.findMany({
    where: {
      organizationId,
      clientId,
      cancelledAt: null,
      task: { departmentId: filters.departmentId ?? { in: [...departmentIds] } },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
      ...(filters.dueFrom || filters.dueTo ? { dueDate: { gte: filters.dueFrom, lte: filters.dueTo } } : {}),
      ...(competence ? { competence } : {}),
      ...(filters.paymentStatus === 'unpaid' ? { requiresPayment: true, paidAt: null } : {}),
      ...(filters.paymentStatus === 'paid' ? { requiresPayment: true, paidAt: { not: null } } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: 'insensitive' } } : {}),
    },
    // Nunca inclui `content` aqui: essa lista não registra VIEWED (só GET /protocols/:id via
    // registerView faz isso) — mandar o texto completo já nesta resposta deixaria o cliente ler
    // o conteúdo todo sem nunca gerar o evento que a feature inteira existe pra garantir.
    select: {
      id: true, number: true, title: true, dueDate: true, status: true,
      attachmentId: true, taskId: true, clientId: true, createdAt: true,
      competence: true, requiresPayment: true, amount: true, paidAt: true, paidAmount: true, fileUpdatedAt: true,
      task: { select: { department: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(({ task, amount, paidAmount, ...r }) => ({
    ...r,
    amount: amount?.toString() ?? null,
    paidAmount: paidAmount?.toString() ?? null,
    departmentName: task.department.name,
  }))
}

export async function getProtocolById(id: string, organizationId: string): Promise<ProtocolDetail> {
  const protocol = await prisma.protocol.findFirst({
    where: { id, organizationId },
    include: {
      client: { select: { name: true } },
      attachment: { select: { filename: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!protocol) throw new AppError(404, 'Protocolo não encontrado')
  return protocol
}

export async function getProtocolsSummary(organizationId: string, actor: { id: string; role: string }) {
  const scope = await actorScope(actor, organizationId)
  const counts = await prisma.protocol.groupBy({
    by: ['status'],
    // Mesmo escopo de listProtocolsForOrg — sem isso, o resumo (cards do Dashboard) mostraria
    // contagem org-wide pro ORG_MEMBER mesmo com a lista abaixo restrita, uma inconsistência.
    // Cancelled documents leave every indicator (spec 7.10)
    where: { organizationId, cancelledAt: null, ...protocolWhere(scope) },
    _count: { _all: true },
  })
  const summary: Record<ProtocolStatus, number> = { SENT: 0, VIEWED: 0, DOWNLOADED: 0, EXPIRED: 0 }
  for (const row of counts) summary[row.status] = row._count._all
  return summary
}

async function assertClientAccess(protocolClientId: string, taskDepartmentId: string, clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  if (!canSeeTask(scope, protocolClientId, taskDepartmentId)) {
    throw new AppError(404, 'Protocolo não encontrado')
  }
}

async function resolveClientUserActor(clientUserId: string) {
  const clientUser = await prisma.clientUser.findUnique({ where: { id: clientUserId }, select: { name: true, email: true } })
  return { name: clientUser?.name ?? 'Cliente', email: clientUser?.email ?? null }
}

export async function registerView(
  protocolId: string,
  organizationId: string,
  clientUserId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, organizationId, cancelledAt: null },
    include: { task: { select: { departmentId: true } } },
  })
  if (!protocol) throw new AppError(404, 'Protocolo não encontrado')
  await assertClientAccess(protocol.clientId, protocol.task.departmentId, clientUserId)

  // One VIEWED per person per file version: reopening the detail (or the reload after "Marcar como
  // pago") doesn't pollute the history, but a replaced file seen again is a new view.
  const seenThisVersion = await prisma.protocolEvent.findFirst({
    where: { protocolId, type: 'VIEWED', actorId: clientUserId, createdAt: { gte: protocol.fileUpdatedAt ?? protocol.createdAt } },
    select: { id: true },
  })
  if (!seenThisVersion) {
    const actor = await resolveClientUserActor(clientUserId)
    await prisma.protocolEvent.create({
      data: { protocolId, type: 'VIEWED', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email, ip, userAgent },
    })
  }

  // Guarda pelo status atual no banco (não pela leitura anterior, que pode estar obsoleta) — e
  // inclui EXPIRED como origem válida: visualizar depois do vencimento ainda é visualizar, e a
  // regra de negócio é EXPIRED só vale pra quem nunca viu o protocolo.
  await prisma.protocol.updateMany({ where: { id: protocolId, status: { in: ['SENT', 'EXPIRED'] } }, data: { status: 'VIEWED' } })

  // Detail for the portal: history (who marked as paid and when), amounts as decimal strings.
  // Previous file versions stay in the events (REPLACED), but only the current file is downloadable.
  const detail = await prisma.protocol.findUniqueOrThrow({
    where: { id: protocolId },
    include: {
      attachment: { select: { filename: true, mimeType: true } },
      paymentProof: { select: { filename: true } },
      paidBy: { select: { name: true } },
      task: { select: { department: { select: { name: true } } } },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { type: true, actorName: true, actorType: true, detail: true, createdAt: true },
      },
    },
  })
  const { task, amount, paidAmount, ...rest } = detail
  return {
    ...rest,
    amount: amount?.toString() ?? null,
    paidAmount: paidAmount?.toString() ?? null,
    departmentName: task.department.name,
  }
}

export async function registerDownload(
  protocolId: string,
  organizationId: string,
  clientUserId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, organizationId, cancelledAt: null },
    include: { task: { select: { departmentId: true } }, attachment: true },
  })
  if (!protocol) throw new AppError(404, 'Protocolo não encontrado')
  await assertClientAccess(protocol.clientId, protocol.task.departmentId, clientUserId)
  if (!protocol.attachment || protocol.attachment.deletedAt) throw new AppError(404, 'Esse protocolo não tem arquivo pra baixar')

  const actor = await resolveClientUserActor(clientUserId)
  await prisma.protocolEvent.create({
    data: { protocolId, type: 'DOWNLOADED', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email, ip, userAgent },
  })

  // Mesma guarda por status atual no banco: baixar também conta como ter visto, então sobrepõe
  // até um EXPIRED tardio (ver comentário equivalente em registerView).
  await prisma.protocol.updateMany({ where: { id: protocolId, status: { in: ['SENT', 'VIEWED', 'EXPIRED'] } }, data: { status: 'DOWNLOADED' } })

  return getSignedDownloadUrl(protocol.attachment.storageKey)
}

export async function expireOverdueProtocols(organizationId: string, now: Date): Promise<number> {
  // `lt: now` aqui é só um pré-filtro (super-conjunto seguro): todo protocolo vencido pela regra
  // de dia-calendário também satisfaz essa comparação bruta, então nunca descarta um candidato
  // real — o filtro definitivo é a comparação de rótulos de dia abaixo.
  const candidates = await prisma.protocol.findMany({
    // Paid or cancelled documents never expire ("vencido sem visualização" no longer applies)
    where: { organizationId, status: 'SENT', dueDate: { not: null, lt: now }, paidAt: null, cancelledAt: null },
    select: { id: true, dueDate: true },
  })
  const today = todayInBRT(now)
  const overdue = candidates.filter((p) => utcDayLabel(p.dueDate!) < today)

  let expiredCount = 0
  for (const p of overdue) {
    // updateMany com guarda de status: entre o findMany acima e aqui, o cliente pode ter
    // visualizado o protocolo (SENT -> VIEWED) — sem a guarda, este update sobrescreveria
    // incondicionalmente de volta pra EXPIRED, regredindo um protocolo já visualizado.
    const { count } = await prisma.protocol.updateMany({
      where: { id: p.id, status: 'SENT', paidAt: null, cancelledAt: null },
      data: { status: 'EXPIRED' },
    })
    if (count === 0) continue
    await prisma.protocolEvent.create({ data: { protocolId: p.id, type: 'EXPIRED', actorType: 'system' } })
    expiredCount++
  }

  return expiredCount
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  SENT: 'Enviado',
  VIEWED: 'Visualizado',
  DOWNLOADED: 'Baixado',
  EXPIRED: 'Vencido sem visualização',
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildProtocolReceiptHtml(protocol: ProtocolDetail): string {
  const rows = protocol.events.map((e) => `
    <tr>
      <td>${escapeHtml(EVENT_TYPE_LABEL[e.type] ?? e.type)}</td>
      <td>${escapeHtml(e.actorName ?? '—')}${e.actorEmail ? ` (${escapeHtml(e.actorEmail)})` : ''}</td>
      <td>${escapeHtml(e.ip ?? '—')}</td>
      <td>${new Date(e.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Comprovante — Protocolo ${escapeHtml(protocol.number)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #1f2937; padding: 32px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .muted { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  th { background: #f3f4f6; }
  .footer { margin-top: 32px; font-size: 11px; color: #9ca3af; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Protocolo ${escapeHtml(protocol.number)}</h1>
  <p class="muted">${escapeHtml(protocol.title)} — ${escapeHtml(protocol.client.name)}</p>
  ${protocol.dueDate ? `<p class="muted">Vencimento: ${new Date(protocol.dueDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</p>` : ''}
  <p>${protocol.content ? escapeHtml(protocol.content) : `Arquivo: ${escapeHtml(protocol.attachment?.filename ?? '—')}`}</p>
  <table>
    <thead><tr><th>Evento</th><th>Quem</th><th>IP</th><th>Quando</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">O IP registrado é evidência de apoio do acesso à plataforma, vinculado à autenticação do usuário no momento do evento — não constitui assinatura digital certificada.</p>
</body>
</html>`
}
