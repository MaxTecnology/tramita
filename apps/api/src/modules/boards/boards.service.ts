import { onBoardAssigned, staffActor } from '@/modules/inbox/inbox-events'
import { prisma } from '@/lib/prisma'
import { loadHolidaySet } from '@/modules/holidays/holidays.service'
import { deadlineInfo } from '@/modules/os/os-deadline.service'
import { warnDaysFor } from '@/modules/os/os-list.service'
import { AppError } from '@/errors/AppError'
import type { CreateBoardBody, UpdateBoardBody, SearchQuery } from './boards.schema'
import { todayInBRT, startOfTodayInBRT } from '@/lib/date-only'
import { boardWhere, clientWhere, loadStaffScope, type StaffScope } from '@/modules/staff-scope/staff-scope'

const DEFAULT_COLUMNS = [
  { title: 'Pendente', position: 0, color: '#6B7280', statusEffect: 'NONE' as const },
  { title: 'Em andamento', position: 1, color: '#3B82F6', statusEffect: 'NONE' as const },
  { title: 'Concluído', position: 2, color: '#10B981', statusEffect: 'DONE' as const },
]

export async function listBoards(
  organizationId: string,
  query: {
    clientId?: string | string[]
    responsibleUserId?: string
    columnTitle?: string
    overdue?: boolean
    dueSoon?: boolean
    staffScope?: StaffScope
  } = {},
  now: Date = new Date(),
) {
  // dueDate é um rótulo de dia-calendário (meia-noite UTC), não instante real — comparar contra
  // `now` bruto marcava "vencida"/"vence em breve" até ~3h adiantado (ver apps/api/src/lib/date-only.ts).
  const todayBRT = startOfTodayInBRT(now)
  const in7days = new Date(todayInBRT(now) + 7 * 24 * 60 * 60 * 1000)

  const boards = await prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      type: 'PROCESS',
      ...(query.staffScope ? { AND: [boardWhere(query.staffScope)] } : {}),
      ...(query.clientId
        ? { clientId: Array.isArray(query.clientId) ? { in: query.clientId } : query.clientId }
        : {}),
      ...(query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {}),
      ...(query.columnTitle
        ? {
            columns: {
              some: {
                title: { contains: query.columnTitle, mode: 'insensitive' },
                tasks: { some: { status: { notIn: ['DONE', 'DISREGARDED'] } } },
              },
            },
          }
        : {}),
      ...(query.overdue
        ? {
            columns: {
              some: {
                tasks: {
                  some: { dueDate: { lt: todayBRT }, status: { notIn: ['DONE', 'DISREGARDED'] } },
                },
              },
            },
          }
        : {}),
      ...(query.dueSoon
        ? {
            columns: {
              some: {
                tasks: {
                  some: {
                    dueDate: { gte: todayBRT, lte: in7days },
                    status: { notIn: ['DONE', 'DISREGARDED'] },
                  },
                },
              },
            },
          }
        : {}),
    },
    include: {
      client: { select: { id: true, name: true, codigo: true } },
      responsibleUser: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { orderBy: { position: 'asc' } } },
      },
      pauses: { select: { startedAt: true, endedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return withProcessDeadline(boards, organizationId, now)
}

type ClockBoard = { createdAt: Date; completedAt: Date | null; deadlineBusinessDays: number | null; targetDate: Date | null; pauses: { startedAt: Date; endedAt: Date | null }[] }

// Process clock: business days from its opening, paused while every open OS waits for the client
async function withProcessDeadline<B extends ClockBoard>(boards: B[], organizationId: string, now: Date) {
  const y = now.getUTCFullYear()
  const holidays = await loadHolidaySet(organizationId, [y - 1, y, y + 1])
  const warnDays = await warnDaysFor(organizationId)
  return boards.map(({ pauses, ...b }) => ({
    ...b,
    deadline: deadlineInfo({
      status: b.completedAt ? 'DONE' : 'OPEN', osModelId: null, releasedAt: b.createdAt, deadlineBusinessDays: b.deadlineBusinessDays,
      targetDate: b.targetDate, completedAt: b.completedAt, pauses,
    }, now, holidays, warnDays),
  }))
}

export async function getBoardById(
  id: string,
  organizationId: string,
  hideInvisibleTasks = false,
  clientId?: string | string[],
  staffScope?: StaffScope,
) {
  const board = await prisma.board.findFirst({
    where: {
      id,
      organizationId,
      isActive: true,
      type: 'PROCESS',
      ...(staffScope ? { AND: [boardWhere(staffScope)] } : {}),
      ...(clientId ? { clientId: Array.isArray(clientId) ? { in: clientId } : clientId } : {}),
    },
    include: {
      client: { select: { id: true, name: true, codigo: true } },
      responsibleUser: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: {
          tasks: {
            where: hideInvisibleTasks ? { visibleToClient: true } : undefined,
            orderBy: { position: 'asc' },
          },
        },
      },
      pauses: { select: { startedAt: true, endedAt: true } },
    },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')
  const [withDeadline] = await withProcessDeadline([board], organizationId, new Date())
  return withDeadline
}

export async function createBoard(
  organizationId: string,
  userId: string,
  userRole: string,
  data: CreateBoardBody,
) {
  const scope = await loadStaffScope({ sub: userId, role: userRole, organizationId })
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, organizationId, isActive: true, ...clientWhere(scope) },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const responsibleUserId =
    userRole === 'ORG_MEMBER' ? userId : (data.responsibleUserId ?? null)

  const columns = data.processTemplateId
    ? await buildColumnsFromTemplate(data.processTemplateId, organizationId)
    : DEFAULT_COLUMNS

  const board = await prisma.board.create({
    data: {
      title: data.title,
      description: data.description,
      clientId: data.clientId,
      organizationId,
      responsibleUserId,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      type: 'PROCESS',
      processTemplateId: data.processTemplateId,
      columns: { create: columns },
    },
    include: {
      client: { select: { id: true, name: true, codigo: true } },
      columns: { orderBy: { position: 'asc' } },
    },
  })
  if (responsibleUserId && responsibleUserId !== userId) await onBoardAssigned(board.id, await staffActor(userId))
  return board
}

async function buildColumnsFromTemplate(processTemplateId: string, organizationId: string) {
  const template = await prisma.processTemplate.findFirst({
    where: { id: processTemplateId, organizationId, isActive: true },
    include: { columns: { orderBy: { position: 'asc' }, include: { documents: { orderBy: { position: 'asc' } } } } },
  })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')

  return template.columns.map((col) => ({
    title: col.title,
    position: col.position,
    statusEffect: col.statusEffect,
    notifyClient: col.notifyClient,
    documents: { create: col.documents.map((d) => ({ name: d.name, position: d.position })) },
  }))
}

export async function updateBoard(id: string, organizationId: string, data: UpdateBoardBody) {
  const board = await prisma.board.findFirst({ where: { id, organizationId, isActive: true, type: 'PROCESS' } })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.board.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      responsibleUserId: data.responsibleUserId,
      dueDate: data.dueDate !== undefined
        ? (data.dueDate ? new Date(data.dueDate) : null)
        : undefined,
    },
    include: { client: { select: { id: true, name: true, codigo: true } } },
  })
}

export async function searchTasks(boardId: string, organizationId: string, filters: SearchQuery) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId, isActive: true, type: 'PROCESS' },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.task.findMany({
    where: {
      column: { boardId },
      ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' } } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.dueBefore ? { dueDate: { lte: new Date(filters.dueBefore) } } : {}),
      ...(filters.dueAfter ? { dueDate: { gte: new Date(filters.dueAfter) } } : {}),
      ...(filters.competence ? { competence: new Date(filters.competence) } : {}),
      ...(filters.targetBefore ? { targetDate: { lte: new Date(filters.targetBefore) } } : {}),
      ...(filters.targetAfter ? { targetDate: { gte: new Date(filters.targetAfter) } } : {}),
    },
    orderBy: { position: 'asc' },
  })
}
