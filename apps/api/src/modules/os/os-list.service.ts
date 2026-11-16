import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadStaffScope, taskWhere } from '@/modules/staff-scope/staff-scope'
import { loadHolidaySet } from '@/modules/holidays/holidays.service'
import { staffTaskLink } from '@/modules/inbox/inbox-events'
import { deadlineInfo, type DeadlineState } from './os-deadline.service'
import type { ListOSQuery } from './os.schema'

const ORDER: Record<DeadlineState, number> = { LATE: 0, DUE_SOON: 1, PAUSED: 2, ON_TIME: 3, NONE: 4, WAITING_DEPENDENCY: 5, DONE: 6 }

export async function warnDaysFor(organizationId: string): Promise<number> {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId }, select: { slaTargetWarningDays: true } })
  return config?.slaTargetWarningDays ?? 3
}

// "Ordens de Serviço": every task opened from an OS model (standalone or in a process), with the
// situation of its internal deadline; same visibility as the Tarefas screen
export async function listOS(organizationId: string, user: { id: string; role: string }, q: ListOSQuery, now: Date = new Date()) {
  const scope = await loadStaffScope({ sub: user.id, role: user.role, organizationId })
  const where: Prisma.TaskWhereInput = {
    osModelId: q.osModelId ?? { not: null },
    column: { board: { organizationId, isActive: true, ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.boardId ? { id: q.boardId } : {}) } },
    ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { column: { board: { client: { name: { contains: q.search, mode: 'insensitive' } } } } }] } : {}),
    AND: [taskWhere(scope)],
  }
  // Every open OS comes (lateness is computed from it); finished ones are only the last 30 days by
  // default, or the newest 300 in "Concluídas"
  const finishedOnly = q.situation === 'DONE'
  const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const select = {
      id: true, title: true, status: true, competence: true, dueDate: true, targetDate: true, releasedAt: true, completedAt: true,
      deadlineBusinessDays: true, osModelId: true, delayReasonPending: true,
      osModel: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      pauses: { select: { startedAt: true, endedAt: true } },
      column: { select: { board: { select: { id: true, type: true, title: true, client: { select: { id: true, name: true, codigo: true } } } } } },
  } satisfies Prisma.TaskSelect
  const [open, finished] = await Promise.all([
    finishedOnly ? [] : prisma.task.findMany({ where: { AND: [where, { status: { notIn: ['DONE', 'DISREGARDED'] } }] }, select, orderBy: { targetDate: 'asc' } }),
    prisma.task.findMany({
      where: { AND: [where, { status: { in: ['DONE', 'DISREGARDED'] } }, ...(finishedOnly ? [] : [{ completedAt: { gte: recent } }])] },
      select, orderBy: { completedAt: 'desc' }, take: 300,
    }),
  ])
  const rows = [...open, ...finished]
  const holidays = await loadHolidaySet(organizationId, [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1])
  const warnDays = await warnDaysFor(organizationId)
  const items = rows.map((t) => {
    const board = t.column.board
    return {
      id: t.id, title: t.title, status: t.status, competence: t.competence, dueDate: t.dueDate, targetDate: t.targetDate,
      client: board.client, osModel: t.osModel, assignee: t.assignee, department: t.department,
      process: board.type === 'PROCESS' ? { id: board.id, title: board.title } : null,
      deadline: deadlineInfo(t, now, holidays, warnDays),
      delayReasonPending: t.delayReasonPending,
      link: staffTaskLink({ id: t.id, boardId: board.id, boardType: board.type }),
    }
  })
  const filtered = items.filter((i) => !q.situation || i.deadline.state === q.situation)
  // Finished: newest first (already ordered); the rest by situation, then target
  if (finishedOnly) return filtered
  return filtered.sort((a, b) => ORDER[a.deadline.state] - ORDER[b.deadline.state]
    || (a.targetDate?.getTime() ?? Infinity) - (b.targetDate?.getTime() ?? Infinity))
}
