// apps/api/src/modules/protocols/protocols.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import { getSignedDownloadUrl } from '@/lib/b2'
import type { CreateProtocolBody } from './protocols.schema'
import type { ProtocolStatus } from '@prisma/client'

interface ProtocolDetail {
  id: string
  number: string
  title: string
  content: string | null
  status: ProtocolStatus
  client: { name: string }
  attachment: { filename: string } | null
  events: { type: string; actorName: string | null; actorEmail: string | null; ip: string | null; createdAt: Date }[]
}

async function nextProtocolNumber(organizationId: string): Promise<string> {
  const year = new Date().getUTCFullYear()
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
  data: Omit<CreateProtocolBody, 'dueDate'> & { dueDate?: Date },
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
  }

  const clientId = task.column.board.clientId
  const number = await nextProtocolNumber(organizationId)

  const protocol = await prisma.protocol.create({
    data: {
      organizationId,
      number,
      clientId,
      taskId,
      attachmentId: data.attachmentId,
      title: data.title,
      content: data.content,
      dueDate: data.dueDate,
      createdById: staffId,
    },
  })

  await prisma.protocolEvent.create({
    data: { protocolId: protocol.id, type: 'SENT', actorType: 'user', actorId: staffId },
  })

  await enqueueNotification({
    event: 'PROTOCOL_CREATED',
    organizationId,
    clientId,
    taskId,
    metadata: { protocolTitle: data.title },
  })

  return protocol
}

export async function listProtocolsForOrg(
  organizationId: string,
  filters: { status?: ProtocolStatus; clientId?: string; from?: Date; to?: Date },
) {
  const protocols = await prisma.protocol.findMany({
    where: {
      organizationId,
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

export async function listProtocolsForClient(
  organizationId: string,
  clientId: string,
  filters: { status?: ProtocolStatus; from?: Date; to?: Date; search?: string },
) {
  return prisma.protocol.findMany({
    where: {
      organizationId,
      clientId,
      // Um protocolo cuja Task foi marcada como visibleToClient: false depois de criado nunca
      // pode aparecer nesta lista — senão o card aparece pro cliente mas abrir/baixar (que
      // revalida isso em registerView/registerDownload) devolveria 404, uma inconsistência
      // visível pro próprio cliente.
      task: { visibleToClient: true },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
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

export async function getProtocolsSummary(organizationId: string) {
  const counts = await prisma.protocol.groupBy({
    by: ['status'],
    where: { organizationId },
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
    where: { id: protocolId, organizationId },
    include: { task: { select: { departmentId: true, visibleToClient: true } } },
  })
  if (!protocol || !protocol.task.visibleToClient) throw new AppError(404, 'Protocolo não encontrado')
  await assertClientAccess(protocol.clientId, protocol.task.departmentId, clientUserId)

  const actor = await resolveClientUserActor(clientUserId)
  await prisma.protocolEvent.create({
    data: { protocolId, type: 'VIEWED', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email, ip, userAgent },
  })

  if (protocol.status === 'SENT') {
    await prisma.protocol.updateMany({ where: { id: protocolId, status: 'SENT' }, data: { status: 'VIEWED' } })
  }

  return prisma.protocol.findUniqueOrThrow({ where: { id: protocolId } })
}

export async function registerDownload(
  protocolId: string,
  organizationId: string,
  clientUserId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, organizationId },
    include: { task: { select: { departmentId: true, visibleToClient: true } }, attachment: true },
  })
  if (!protocol || !protocol.task.visibleToClient) throw new AppError(404, 'Protocolo não encontrado')
  await assertClientAccess(protocol.clientId, protocol.task.departmentId, clientUserId)
  if (!protocol.attachment) throw new AppError(404, 'Esse protocolo não tem arquivo pra baixar')

  const actor = await resolveClientUserActor(clientUserId)
  await prisma.protocolEvent.create({
    data: { protocolId, type: 'DOWNLOADED', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email, ip, userAgent },
  })

  if (protocol.status === 'SENT' || protocol.status === 'VIEWED') {
    await prisma.protocol.updateMany({ where: { id: protocolId, status: protocol.status }, data: { status: 'DOWNLOADED' } })
  }

  return getSignedDownloadUrl(protocol.attachment.storageKey)
}

export async function expireOverdueProtocols(organizationId: string, now: Date): Promise<number> {
  const overdue = await prisma.protocol.findMany({
    where: { organizationId, status: 'SENT', dueDate: { not: null, lt: now } },
    select: { id: true },
  })

  for (const p of overdue) {
    await prisma.$transaction([
      prisma.protocol.update({ where: { id: p.id }, data: { status: 'EXPIRED' } }),
      prisma.protocolEvent.create({ data: { protocolId: p.id, type: 'EXPIRED', actorType: 'system' } }),
    ])
  }

  return overdue.length
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
  <p>${protocol.content ? escapeHtml(protocol.content) : `Arquivo: ${escapeHtml(protocol.attachment?.filename ?? '—')}`}</p>
  <table>
    <thead><tr><th>Evento</th><th>Quem</th><th>IP</th><th>Quando</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">O IP registrado é evidência de apoio do acesso à plataforma, vinculado à autenticação do usuário no momento do evento — não constitui assinatura digital certificada.</p>
</body>
</html>`
}
