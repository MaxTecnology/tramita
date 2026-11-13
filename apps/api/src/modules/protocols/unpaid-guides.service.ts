import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { utcDayLabel, todayInBRT } from '@/lib/date-only'
import { actorScope, protocolWhere } from '@/modules/staff-scope/staff-scope'

export interface UnpaidGuidesFilters {
  clientId?: string
  departmentId?: string
  competence?: string // 'YYYY-MM'
  situation?: 'overdue' | 'upcoming' | 'paid'
  scope?: 'mine' | 'department' | 'all'
}

type Actor = { id: string; role: string }

async function scopeWhere(organizationId: string, actor: Actor): Promise<Prisma.ProtocolWhereInput> {
  return {
    organizationId,
    requiresPayment: true,
    cancelledAt: null,
    ...protocolWhere(await actorScope(actor, organizationId)),
  }
}

function isOverdue(dueDate: Date | null, now: Date): boolean {
  return !!dueDate && utcDayLabel(dueDate) < todayInBRT(now)
}

function competenceRange(competence: string): { gte: Date; lt: Date } {
  const [y, m] = competence.split('-').map(Number)
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }
}

// Payment guides as the office follows them: unpaid by default (overdue first, by due date), with
// the amount prominent so a high tax gets a call to the client before interest grows.
export async function listUnpaidGuides(organizationId: string, actor: Actor, filters: UnpaidGuidesFilters, now: Date = new Date()) {
  const paidView = filters.situation === 'paid'
  // Screen filter on top of the permission scope (same rules as the task list)
  const scope = await actorScope(actor, organizationId)
  const view = scope.kind === 'ALL' ? (filters.scope ?? 'all') : filters.scope === 'mine' ? 'mine' : 'department'
  if (scope.kind === 'LIMITED' && view === 'department' && filters.departmentId && !scope.departmentIds.includes(filters.departmentId)) return []
  const rows = await prisma.protocol.findMany({
    where: {
      // AND: the member scope and the department filter both constrain `task`
      AND: [
        await scopeWhere(organizationId, actor),
        ...(view === 'mine' ? [{ task: { assigneeId: actor.id } }] : []),
        { paidAt: paidView ? { not: null } : null },
        ...(filters.clientId ? [{ clientId: filters.clientId }] : []),
        ...(filters.departmentId ? [{ task: { departmentId: filters.departmentId } }] : []),
        ...(filters.competence ? [{ competence: competenceRange(filters.competence) }] : []),
      ],
    },
    select: {
      id: true, number: true, title: true, clientId: true, competence: true, dueDate: true,
      amount: true, paidAt: true, paidAmount: true,
      client: { select: { name: true } },
      paidBy: { select: { name: true } },
      task: { select: { department: { select: { name: true } }, column: { select: { boardId: true } } } },
    },
    orderBy: paidView ? { paidAt: 'desc' } : [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  })

  const items = rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    clientId: r.clientId,
    clientName: r.client.name,
    departmentName: r.task.department.name,
    competence: r.competence,
    dueDate: r.dueDate,
    amount: r.amount?.toString() ?? null,
    overdue: !r.paidAt && isOverdue(r.dueDate, now),
    paidAt: r.paidAt,
    paidAmount: r.paidAmount?.toString() ?? null,
    paidByName: r.paidBy?.name ?? null,
    boardId: r.task.column.boardId,
  }))

  if (filters.situation === 'overdue') return items.filter((i) => i.overdue)
  if (filters.situation === 'upcoming') return items.filter((i) => !i.overdue)
  return items
}

export async function getUnpaidGuidesSummary(organizationId: string, actor: Actor, now: Date = new Date()) {
  const rows = await prisma.protocol.findMany({
    where: { ...(await scopeWhere(organizationId, actor)), paidAt: null },
    select: { amount: true, dueDate: true },
  })
  let unpaidTotal = new Prisma.Decimal(0)
  let overdueTotal = new Prisma.Decimal(0)
  let overdueCount = 0
  for (const r of rows) {
    const amount = r.amount ?? new Prisma.Decimal(0)
    unpaidTotal = unpaidTotal.plus(amount)
    if (isOverdue(r.dueDate, now)) {
      overdueCount++
      overdueTotal = overdueTotal.plus(amount)
    }
  }
  return {
    unpaidCount: rows.length,
    unpaidTotal: unpaidTotal.toFixed(2),
    overdueCount,
    overdueTotal: overdueTotal.toFixed(2),
  }
}
