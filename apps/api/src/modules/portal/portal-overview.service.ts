import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { utcDayLabel, todayInBRT } from '@/lib/date-only'
import { getClientAccessScope } from '@/modules/client-users/client-access'

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
): Prisma.TaskDocumentRequirementWhereInput {
  return {
    status: { in: [...OPEN_REQUEST] },
    task: {
      ...taskExtra,
      visibleToClient: true,
      departmentId: { in: departmentIds },
      column: { board: { organizationId, clientId, isActive: true } },
    },
  }
}

const toLabel = (d: Date) => utcDayLabel(d)

export async function getPortalHome(organizationId: string, clientId: string, clientUserId: string, now: Date = new Date()) {
  const departmentIds = await departmentsInScope(clientId, clientUserId)
  if (departmentIds.length === 0) {
    return { unpaidGuides: { count: 0, overdueCount: 0 }, documentsToSend: 0, processesInProgress: 0, dueThisWeek: [] }
  }
  const today = todayInBRT(now)
  const weekEnd = new Date(today + 7 * DAY_MS)

  const [guides, documentsToSend, processesInProgress, requestsDue] = await Promise.all([
    prisma.protocol.findMany({
      where: unpaidGuidesWhere(organizationId, clientId, departmentIds),
      select: { id: true, title: true, dueDate: true, amount: true },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.taskDocumentRequirement.count({ where: openRequestsWhere(organizationId, clientId, departmentIds) }),
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
  ])

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
    processesInProgress,
    dueThisWeek,
  }
}

function competenceRange(competence: string) {
  const [y, m] = competence.split('-').map(Number)
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }
}

// Monthly requests come only from recurring tasks (board RECURRING_SYSTEM); requests of a process
// (OS) live inside the process screen.
function recurringRequestsWhere(
  organizationId: string,
  clientId: string,
  departmentIds: string[],
  competence: Prisma.DateTimeNullableFilter = { not: null },
): Prisma.TaskDocumentRequirementWhereInput {
  return {
    task: {
      visibleToClient: true,
      departmentId: { in: departmentIds },
      competence,
      column: { board: { organizationId, clientId, isActive: true, type: 'RECURRING_SYSTEM' } },
    },
  }
}

export async function listDocumentRequestsByMonth(organizationId: string, clientId: string, clientUserId: string, competence: string) {
  const departmentIds = await departmentsInScope(clientId, clientUserId)
  const rows = departmentIds.length === 0 ? [] : await prisma.taskDocumentRequirement.findMany({
    where: recurringRequestsWhere(organizationId, clientId, departmentIds, competenceRange(competence)),
    select: {
      id: true, taskId: true, name: true, status: true, rejectionReason: true,
      task: { select: { title: true, department: { select: { name: true } } } },
    },
    orderBy: [{ task: { title: 'asc' } }, { position: 'asc' }],
  })
  return {
    competence,
    requests: rows.map((r) => ({
      id: r.id, taskId: r.taskId, name: r.name, status: r.status, rejectionReason: r.rejectionReason,
      taskTitle: r.task.title, departmentName: r.task.department.name,
    })),
  }
}

export async function listDocumentRequestMonths(organizationId: string, clientId: string, clientUserId: string) {
  const departmentIds = await departmentsInScope(clientId, clientUserId)
  if (departmentIds.length === 0) return []
  const rows = await prisma.taskDocumentRequirement.findMany({
    where: recurringRequestsWhere(organizationId, clientId, departmentIds),
    select: { status: true, task: { select: { competence: true } } },
  })
  const months = new Map<string, { pending: number; total: number }>()
  for (const r of rows) {
    const key = r.task.competence!.toISOString().slice(0, 7)
    const m = months.get(key) ?? { pending: 0, total: 0 }
    m.total++
    if (r.status === 'PENDING' || r.status === 'REJECTED') m.pending++
    months.set(key, m)
  }
  return [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([competence, m]) => ({ competence, ...m }))
}
