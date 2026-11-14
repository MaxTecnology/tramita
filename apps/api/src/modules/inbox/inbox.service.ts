import type { InAppType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishInboxEvent } from '@/lib/sse'
import type { ListNotificationsQuery } from './inbox.schema'

// Whose inbox: an office user or a client user (from the token role)
export type Recipient = { kind: 'user' | 'clientUser'; id: string }

const recipientWhere = (r: Recipient): Prisma.InAppNotificationWhereInput =>
  r.kind === 'user' ? { recipientUserId: r.id } : { recipientClientUserId: r.id }

export interface NotifyInput {
  organizationId: string
  type: InAppType
  title: string
  body: string
  link: string
  refs?: { taskId?: string; boardId?: string; requestId?: string; approvalId?: string; protocolId?: string; clientId?: string }
  actorName?: string
  to: { userIds?: string[]; clientUserIds?: string[] }
  exclude?: { userId?: string; clientUserId?: string }
}

// One row per recipient, always written (independent of the WhatsApp/e-mail toggles). Whoever caused
// the event is never notified about it.
export async function notifyInApp(input: NotifyInput): Promise<number> {
  const wanted = [...new Set(input.to.userIds ?? [])].filter((id) => id && id !== input.exclude?.userId)
  // Former staff (deactivated) never get new notifications
  const userIds = wanted.length === 0 ? [] : (await prisma.user.findMany({
    where: { id: { in: wanted }, organizationId: input.organizationId, isActive: true },
    select: { id: true },
  })).map((u) => u.id)
  const clientUserIds = [...new Set(input.to.clientUserIds ?? [])].filter((id) => id && id !== input.exclude?.clientUserId)
  const common = {
    organizationId: input.organizationId, type: input.type, title: input.title, body: input.body, link: input.link,
    actorName: input.actorName ?? null, ...input.refs,
  }
  const data = [
    ...userIds.map((recipientUserId) => ({ ...common, recipientUserId })),
    ...clientUserIds.map((recipientClientUserId) => ({ ...common, recipientClientUserId })),
  ]
  if (data.length === 0) return 0
  const { count } = await prisma.inAppNotification.createMany({ data })
  // Bell updates in real time for whoever has the app open
  await Promise.all([
    ...userIds.map((id) => publishInboxEvent({ kind: 'user', id })),
    ...clientUserIds.map((id) => publishInboxEvent({ kind: 'clientUser', id })),
  ])
  return count
}

// Active client users with access to the company AND the department of the item
export async function clientUsersFor(clientId: string, departmentId: string | null): Promise<string[]> {
  if (!departmentId) return []
  const rows = await prisma.clientUserAccess.findMany({
    where: { clientId, departmentId, clientUser: { isActive: true } },
    select: { clientUserId: true },
  })
  return [...new Set(rows.map((r) => r.clientUserId))]
}

export async function listNotifications(recipient: Recipient, query: ListNotificationsQuery) {
  const limit = query.limit ?? 20
  const q = query.q?.trim()
  const rows = await prisma.inAppNotification.findMany({
    where: {
      ...recipientWhere(recipient),
      ...(query.status === 'read' ? { readAt: { not: null } } : query.status === 'unread' ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}), ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) } }
        : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}

export async function countUnread(recipient: Recipient): Promise<number> {
  return prisma.inAppNotification.count({ where: { ...recipientWhere(recipient), readAt: null } })
}

export async function setRead(recipient: Recipient, id: string, read: boolean) {
  const { count } = await prisma.inAppNotification.updateMany({
    where: { id, ...recipientWhere(recipient) },
    data: { readAt: read ? new Date() : null },
  })
  if (count === 0) throw new AppError(404, 'Notificação não encontrada')
  await publishInboxEvent(recipient) // other open tabs of the same person
}

export async function readAll(recipient: Recipient): Promise<number> {
  const { count } = await prisma.inAppNotification.updateMany({ where: { ...recipientWhere(recipient), readAt: null }, data: { readAt: new Date() } })
  await publishInboxEvent(recipient)
  return count
}

export async function readByTask(recipient: Recipient, taskId: string): Promise<number> {
  // Opening a conversation reads its messages — not the approval/document notices of that task
  const { count } = await prisma.inAppNotification.updateMany({
    where: { ...recipientWhere(recipient), taskId, type: 'TASK_COMMENT', readAt: null },
    data: { readAt: new Date() },
  })
  if (count > 0) await publishInboxEvent(recipient)
  return count
}
