import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { businessDaysBetween } from '@/lib/business-days'
import { loadHolidaySet } from '@/modules/holidays/holidays.service'
import { loadStaffScope, boardWhere, taskWhere } from '@/modules/staff-scope/staff-scope'
import { deadlineInfo, brtDay } from './os-deadline.service'
import { warnDaysFor } from './os-list.service'

const FINISHED: readonly string[] = ['DONE', 'DISREGARDED']

async function holidaysAround(organizationId: string, now: Date) {
  const y = now.getUTCFullYear()
  return loadHolidaySet(organizationId, [y - 2, y - 1, y, y + 1])
}

// Time of each OS in each column of a process (business days, from the move history) and the
// office × client days of each OS
export async function getStageTimes(boardId: string, organizationId: string, user: { id: string; role: string }, now: Date = new Date()) {
  const scope = await loadStaffScope({ sub: user.id, role: user.role, organizationId })
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId, type: 'PROCESS', AND: [boardWhere(scope)] },
    select: {
      columns: { orderBy: { position: 'asc' }, select: { id: true, title: true } },
    },
  })
  if (!board) throw new AppError(404, 'Processo não encontrado')
  const tasks = await prisma.task.findMany({
    where: { column: { boardId } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, title: true, status: true, createdAt: true, completedAt: true, releasedAt: true, targetDate: true, deadlineBusinessDays: true, osModelId: true,
      column: { select: { title: true } },
      pauses: { select: { startedAt: true, endedAt: true } },
      history: { where: { action: 'moved_to' }, orderBy: { createdAt: 'asc' }, select: { fromValue: true, toValue: true, createdAt: true } },
    },
  })
  const holidays = await holidaysAround(organizationId, now)
  const warnDays = await warnDaysFor(organizationId)
  const perColumn = new Map<string, number[]>(board.columns.map((c) => [c.title, []]))

  for (const t of tasks) {
    const end = FINISHED.includes(t.status) && t.completedAt ? t.completedAt : now
    let column = t.history[0]?.fromValue ?? t.column.title
    let start = t.createdAt
    const spent = new Map<string, number>()
    const add = (title: string, from: Date, to: Date) => spent.set(title, (spent.get(title) ?? 0) + businessDaysBetween(brtDay(from), brtDay(to < end ? to : end), holidays))
    for (const move of t.history) {
      if (column) add(column, start, move.createdAt)
      column = move.toValue ?? column
      start = move.createdAt
    }
    if (column) add(column, start, end)
    for (const [title, days] of spent) perColumn.get(title)?.push(days)
  }

  return {
    columns: board.columns.map((c) => {
      const values = perColumn.get(c.title) ?? []
      const total = values.reduce((a, b) => a + b, 0)
      return { columnId: c.id, title: c.title, totalBusinessDays: total, avgBusinessDays: values.length ? Math.round((total / values.length) * 10) / 10 : 0 }
    }),
    os: tasks.filter((t) => t.osModelId).map((t) => {
      const d = deadlineInfo(t, now, holidays, warnDays)
      return { taskId: t.id, title: t.title, officeBusinessDays: d.officeBusinessDays, clientBusinessDays: d.clientBusinessDays, state: d.state }
    }),
  }
}

const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0)

// Dashboard: delays by reason, reasons still to explain, and per model (OS and process) how long the
// office took versus how long it waited for the client (OS finished in the period)
export async function getOSDashboard(organizationId: string, user: { id: string; role: string }, period: { from: Date; to: Date }, now: Date = new Date()) {
  const scope = await loadStaffScope({ sub: user.id, role: user.role, organizationId })
  const scopedTasks = { column: { board: { organizationId } }, AND: [taskWhere(scope)] }
  const finished = await prisma.task.findMany({
    where: { ...scopedTasks, osModelId: { not: null }, status: 'DONE', completedAt: { gte: period.from, lte: period.to } },
    select: {
      status: true, completedAt: true, releasedAt: true, targetDate: true, deadlineBusinessDays: true, osModelId: true,
      delayReasonId: true, delayReasonPending: true,
      osModel: { select: { id: true, name: true } },
      delayReason: { select: { id: true, name: true } },
      pauses: { select: { startedAt: true, endedAt: true } },
    },
  })
  const boards = await prisma.board.findMany({
    where: { organizationId, type: 'PROCESS', completedAt: { gte: period.from, lte: period.to }, processTemplateId: { not: null }, AND: [boardWhere(scope)] },
    select: {
      createdAt: true, completedAt: true, delayReasonId: true, delayReasonPending: true,
      processTemplate: { select: { id: true, name: true } },
      delayReason: { select: { id: true, name: true } },
      pauses: { select: { startedAt: true, endedAt: true } },
    },
  })
  const pendingTasks = await prisma.task.count({ where: { ...scopedTasks, delayReasonPending: true } })
  const pendingBoards = await prisma.board.count({ where: { organizationId, type: 'PROCESS', delayReasonPending: true, AND: [boardWhere(scope)] } })
  const holidays = await holidaysAround(organizationId, now)

  const reasons = new Map<string, { reasonId: string; name: string; count: number }>()
  const countReason = (r: { id: string; name: string } | null) => {
    if (!r) return
    const entry = reasons.get(r.id) ?? { reasonId: r.id, name: r.name, count: 0 }
    entry.count++
    reasons.set(r.id, entry)
  }

  const models = new Map<string, { kind: 'OS' | 'PROCESS'; id: string; name: string; office: number[]; client: number[]; late: number }>()
  for (const t of finished) {
    countReason(t.delayReason)
    const d = deadlineInfo(t, now, holidays, 0)
    const key = `OS:${t.osModel!.id}`
    const m = models.get(key) ?? { kind: 'OS' as const, id: t.osModel!.id, name: t.osModel!.name, office: [], client: [], late: 0 }
    m.office.push(d.officeBusinessDays)
    m.client.push(d.clientBusinessDays)
    if (t.delayReasonId || t.delayReasonPending) m.late++
    models.set(key, m)
  }
  for (const b of boards) {
    countReason(b.delayReason)
    const client = b.pauses.reduce((sum, p) => sum + businessDaysBetween(brtDay(p.startedAt), brtDay(p.endedAt ?? b.completedAt!), holidays), 0)
    const total = businessDaysBetween(brtDay(b.createdAt), brtDay(b.completedAt!), holidays)
    const key = `PROCESS:${b.processTemplate!.id}`
    const m = models.get(key) ?? { kind: 'PROCESS' as const, id: b.processTemplate!.id, name: b.processTemplate!.name, office: [], client: [], late: 0 }
    m.office.push(Math.max(0, total - client))
    m.client.push(client)
    if (b.delayReasonId || b.delayReasonPending) m.late++
    models.set(key, m)
  }

  return {
    delaysByReason: [...reasons.values()].sort((a, b) => b.count - a.count),
    pendingReasons: pendingTasks + pendingBoards,
    byModel: [...models.values()].map((m) => ({
      kind: m.kind, id: m.id, name: m.name, count: m.office.length,
      avgOfficeBusinessDays: avg(m.office), avgClientBusinessDays: avg(m.client), lateCount: m.late,
    })).sort((a, b) => b.count - a.count),
  }
}
