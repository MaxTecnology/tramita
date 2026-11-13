import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { utcDayLabel, todayInBRT } from '@/lib/date-only'
import { getClientAccessScope } from '@/modules/client-users/client-access'
import { approvalInclude, presentApproval } from '@/modules/approvals/approvals.service'
import { clientTaskLink } from '@/modules/inbox/inbox-events'

const OPEN_REQUEST = ['PENDING', 'REJECTED'] as const
const DAY_MS = 24 * 60 * 60 * 1000

async function departmentsInScope(clientId: string, clientUserId: string): Promise<string[]> {
  const scope = await getClientAccessScope(clientUserId)
  return [...(scope.departmentIdsByClient.get(clientId) ?? [])]
}

function unpaidGuidesWhere(organizationId: string, clientId: string, departmentIds: string[]): Prisma.ProtocolWhereInput {
  return {
    organizationId, clientId, cancelledAt: null, requiresPayment: true, paidAt: null,
    task: { departmentId: { in: departmentIds } },
  }
}

function openRequestsWhere(
  organizationId: string,
  clientId: string,
  departmentIds: string[],
  taskExtra: Prisma.TaskWhereInput = {},
  boardExtra: Prisma.BoardWhereInput = {},
): Prisma.TaskDocumentRequirementWhereInput {
  return {
    status: { in: [...OPEN_REQUEST] },
    task: {
      ...taskExtra,
      visibleToClient: true,
      departmentId: { in: departmentIds },
      column: { board: { ...boardExtra, organizationId, clientId, isActive: true } },
    },
  }
}

const toLabel = (d: Date) => utcDayLabel(d)

export async function getPortalHome(organizationId: string, clientId: string, clientUserId: string, now: Date = new Date()) {
  const departmentIds = await departmentsInScope(clientId, clientUserId)
  if (departmentIds.length === 0) {
    return {
      unpaidGuides: { count: 0, overdueCount: 0 }, documentsToSend: 0, documentsToSendInProcesses: 0, processesInProgress: 0, dueThisWeek: [],
      unreadMessages: { count: 0, link: null }, pendingApprovals: 0, pendingApprovalLink: null,
    }
  }
  const today = todayInBRT(now)
  const weekEnd = new Date(today + 7 * DAY_MS)

  const [guides, documentsToSend, documentsToSendInProcesses, processesInProgress, requestsDue, unreadComments, pendingApprovals] = await Promise.all([
    prisma.protocol.findMany({
      where: unpaidGuidesWhere(organizationId, clientId, departmentIds),
      select: { id: true, title: true, dueDate: true, amount: true },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.taskDocumentRequirement.count({ where: openRequestsWhere(organizationId, clientId, departmentIds) }),
    // Requests of a process (OS) are answered inside the process, not in "Enviar documentos"
    prisma.taskDocumentRequirement.count({
      where: openRequestsWhere(organizationId, clientId, departmentIds, {}, { type: 'OS' }),
    }),
    prisma.board.count({
      where: {
        organizationId, clientId, isActive: true, type: 'OS',
        columns: { some: { tasks: { some: { visibleToClient: true, departmentId: { in: departmentIds }, status: { notIn: ['DONE', 'DISREGARDED'] } } } } },
      },
    }),
    prisma.taskDocumentRequirement.findMany({
      where: openRequestsWhere(organizationId, clientId, departmentIds, { dueDate: { not: null, lte: weekEnd } }),
      select: { id: true, name: true, task: { select: { dueDate: true } } },
    }),
    // Office messages not read yet: one entry per conversation (task), oldest first
    prisma.inAppNotification.findMany({
      where: { recipientClientUserId: clientUserId, clientId, type: 'TASK_COMMENT', readAt: null, taskId: { not: null } },
      select: { taskId: true, link: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.taskApproval.findMany({
      where: {
        status: 'PENDING',
        task: { visibleToClient: true, departmentId: { in: departmentIds }, column: { board: { organizationId, clientId, isActive: true } } },
      },
      select: { task: { select: { id: true, competence: true, column: { select: { board: { select: { id: true, type: true } } } } } } },
      orderBy: { requestedAt: 'asc' },
    }),
  ])
  const oldestApproval = pendingApprovals[0]?.task
  const conversations = new Map<string, string>()
  for (const n of unreadComments) if (n.taskId && !conversations.has(n.taskId)) conversations.set(n.taskId, n.link)

  const overdueCount = guides.filter((g) => g.dueDate && toLabel(g.dueDate) < today).length
  const dueThisWeek = [
    ...guides
      .filter((g) => g.dueDate && toLabel(g.dueDate) <= toLabel(weekEnd))
      .map((g) => ({ kind: 'guide' as const, id: g.id, title: g.title, dueDate: g.dueDate!.toISOString(), amount: g.amount?.toString() })),
    ...requestsDue.map((r) => ({ kind: 'request' as const, id: r.id, title: r.name, dueDate: r.task.dueDate!.toISOString() })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  return {
    unpaidGuides: { count: guides.length, overdueCount },
    documentsToSend,
    documentsToSendInProcesses,
    processesInProgress,
    dueThisWeek,
    unreadMessages: { count: conversations.size, link: conversations.values().next().value ?? null },
    pendingApprovals: pendingApprovals.length,
    // Card "Aguardando sua aprovação" opens the oldest one
    pendingApprovalLink: oldestApproval
      ? clientTaskLink({ id: oldestApproval.id, competence: oldestApproval.competence, boardId: oldestApproval.column.board.id, boardType: oldestApproval.column.board.type })
      : null,
  }
}

// Month view of "Enviar documentos": one group per recurring task visible to the client that has
// something for them — a document request, a conversation or an approval. Nothing → not shown.
function monthTasksWhere(
  organizationId: string,
  clientId: string,
  departmentIds: string[],
  competence: Prisma.DateTimeNullableFilter = { not: null },
): Prisma.TaskWhereInput {
  return {
    visibleToClient: true,
    departmentId: { in: departmentIds },
    competence,
    column: { board: { organizationId, clientId, isActive: true, type: 'RECURRING_SYSTEM' } },
    OR: [{ documentRequirements: { some: {} } }, { comments: { some: { deletedAt: null } } }, { approvals: { some: {} } }],
  }
}

// Unread office comments per task for this client user (the bell is the source of "unread")
async function unreadByTask(clientUserId: string, taskIds: string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map()
  const rows = await prisma.inAppNotification.groupBy({
    by: ['taskId'],
    where: { recipientClientUserId: clientUserId, type: 'TASK_COMMENT', readAt: null, taskId: { in: taskIds } },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.taskId ?? '', r._count._all]))
}

export async function listDocumentRequestsByMonth(organizationId: string, clientId: string, clientUserId: string, competence: string) {
  const departmentIds = await departmentsInScope(clientId, clientUserId)
  const tasks = departmentIds.length === 0 ? [] : await prisma.task.findMany({
    where: monthTasksWhere(organizationId, clientId, departmentIds, competenceRange(competence)),
    select: {
      id: true, title: true,
      department: { select: { name: true } },
      documentRequirements: {
        select: { id: true, name: true, status: true, rejectionReason: true },
        orderBy: { position: 'asc' },
      },
      approvals: { include: approvalInclude, orderBy: { requestedAt: 'desc' } },
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
  })
  const unread = await unreadByTask(clientUserId, tasks.map((t) => t.id))
  return {
    competence,
    tasks: await Promise.all(tasks.map(async (t) => ({
      taskId: t.id,
      title: t.title,
      departmentName: t.department.name,
      requests: t.documentRequirements.map((r) => ({ ...r, taskId: t.id, taskTitle: t.title, departmentName: t.department.name })),
      approvals: await Promise.all(t.approvals.map(presentApproval)),
      unreadMessages: unread.get(t.id) ?? 0,
    }))),
  }
}

export async function listDocumentRequestMonths(organizationId: string, clientId: string, clientUserId: string) {
  const departmentIds = await departmentsInScope(clientId, clientUserId)
  if (departmentIds.length === 0) return []
  const rows = await prisma.task.findMany({
    where: monthTasksWhere(organizationId, clientId, departmentIds),
    select: { competence: true, documentRequirements: { select: { status: true } } },
  })
  const months = new Map<string, { pending: number; total: number }>()
  for (const t of rows) {
    const key = t.competence!.toISOString().slice(0, 7)
    const m = months.get(key) ?? { pending: 0, total: 0 }
    for (const r of t.documentRequirements) {
      m.total++
      if (r.status === 'PENDING' || r.status === 'REJECTED') m.pending++
    }
    months.set(key, m)
  }
  return [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([competence, m]) => ({ competence, ...m }))
}

function competenceRange(competence: string) {
  const [y, m] = competence.split('-').map(Number)
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }
}
