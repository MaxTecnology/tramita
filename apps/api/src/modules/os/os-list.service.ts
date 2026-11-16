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
  const rows = await prisma.task.findMany({
    where,
    take: 1000,
    select: {
      id: true, title: true, status: true, competence: true, dueDate: true, targetDate: true, releasedAt: true, completedAt: true,
      deadlineBusinessDays: true, osModelId: true, delayReasonPending: true,
      osModel: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      pauses: { select: { startedAt: true, endedAt: true } },
      column: { select: { board: { select: { id: true, type: true, title: true, client: { select: { id: true, name: true, codigo: true } } } } } },
    },
  })
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
  return items
    .filter((i) => !q.situation || i.deadline.state === q.situation)
    .sort((a, b) => ORDER[a.deadline.state] - ORDER[b.deadline.state]
      || (a.targetDate?.getTime() ?? Infinity) - (b.targetDate?.getTime() ?? Infinity))
}
