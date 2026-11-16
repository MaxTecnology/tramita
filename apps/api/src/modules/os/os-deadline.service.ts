import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { enqueueNotification } from '@/lib/queue'
import { AppError } from '@/errors/AppError'
import { addBusinessDays, businessDaysBetween, type HolidaySet } from '@/lib/business-days'
import { loadHolidaySet } from '@/modules/holidays/holidays.service'
import { onOSReleased } from '@/modules/inbox/inbox-events'
import { startOfTodayInBRT } from '@/lib/date-only'

// Instants (release, pauses, now) count by the office's calendar day in Brasília, not the UTC day;
// targetDate is already a calendar day (UTC midnight)
const day = (d: Date): Date => startOfTodayInBRT(d)

// Clock of an OS (spec 2026-11-15-os-processos): internal deadline in business days from its release,
// paused while the client is awaited (pending/rejected document or pending approval). The fixed due
// date (Task.dueDate) is a separate clock and never pauses.

const FINISHED: readonly string[] = ['DONE', 'DISREGARDED']
const DAY_MS = 24 * 60 * 60 * 1000

interface Period { startedAt: Date; endedAt: Date | null }

async function holidaysFrom(organizationId: string, from: Date): Promise<HolidaySet> {
  const y = from.getUTCFullYear()
  return loadHolidaySet(organizationId, [y, y + 1, y + 2])
}

function pausedDays(pauses: Period[], now: Date, holidays: HolidaySet): number {
  return pauses.reduce((sum, p) => sum + businessDaysBetween(day(p.startedAt), day(p.endedAt ?? now), holidays), 0)
}

export type DeadlineState = 'NONE' | 'ON_TIME' | 'DUE_SOON' | 'LATE' | 'PAUSED' | 'WAITING_DEPENDENCY' | 'DONE'
export interface DeadlineInfo {
  state: DeadlineState
  businessDaysLeft?: number
  businessDaysLate?: number
  pausedSinceDays?: number
  officeBusinessDays: number
  clientBusinessDays: number
}

export interface ClockInput {
  status: string
  osModelId: string | null
  releasedAt: Date | null
  deadlineBusinessDays: number | null
  targetDate: Date | null
  pauses: Period[]
  completedAt?: Date | null
}

// Pure: what the screen shows for an OS at `now`
export { day as brtDay }

export function deadlineInfo(t: ClockInput, now: Date, holidays: HolidaySet, warnDays: number): DeadlineInfo {
  const end = FINISHED.includes(t.status) && t.completedAt ? t.completedAt : now
  const clientBusinessDays = pausedDays(t.pauses, end, holidays)
  const officeBusinessDays = t.releasedAt ? Math.max(0, businessDaysBetween(day(t.releasedAt), day(end), holidays) - clientBusinessDays) : 0
  const base = { officeBusinessDays, clientBusinessDays }
  if (FINISHED.includes(t.status)) return { state: 'DONE', ...base }
  if (t.osModelId && !t.releasedAt) return { state: 'WAITING_DEPENDENCY', ...base }
  const open = t.pauses.find((p) => !p.endedAt)
  if (open) return { state: 'PAUSED', pausedSinceDays: Math.floor((now.getTime() - open.startedAt.getTime()) / DAY_MS), ...base }
  if (!t.targetDate) return { state: 'NONE', ...base }
  const late = businessDaysBetween(t.targetDate, day(now), holidays)
  if (late > 0) return { state: 'LATE', businessDaysLate: late, ...base }
  const left = businessDaysBetween(day(now), t.targetDate, holidays)
  return { state: left <= warnDays ? 'DUE_SOON' : 'ON_TIME', businessDaysLeft: left, ...base }
}

// Target = release + N business days + business days already paused (closed pauses)
export async function scheduleDeadline(taskId: string): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { releasedAt: true, deadlineBusinessDays: true, pauses: true, column: { select: { board: { select: { organizationId: true } } } } },
  })
  if (!task.releasedAt || !task.deadlineBusinessDays) return
  const holidays = await holidaysFrom(task.column.board.organizationId, task.releasedAt)
  const closed = task.pauses.filter((p) => p.endedAt)
  const targetDate = addBusinessDays(day(task.releasedAt), task.deadlineBusinessDays + pausedDays(closed, new Date(), holidays), holidays)
  await prisma.task.update({ where: { id: taskId }, data: { targetDate } })
}

export async function isWaitingClient(taskId: string): Promise<boolean> {
  const [docs, approvals] = await Promise.all([
    prisma.taskDocumentRequirement.count({ where: { taskId, status: { in: ['PENDING', 'REJECTED'] } } }),
    prisma.taskApproval.count({ where: { taskId, status: 'PENDING' } }),
  ])
  return docs + approvals > 0
}

// Opens or closes the OS pause to match "waiting for the client"; finished or unreleased OS never pause
export async function syncPause(taskId: string, now: Date = new Date()): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { osModelId: true, releasedAt: true, status: true, column: { select: { board: { select: { id: true, type: true } } } } },
  })
  if (!task?.osModelId) return
  const open = await prisma.taskPause.findFirst({ where: { taskId, endedAt: null } })
  const shouldPause = !!task.releasedAt && !FINISHED.includes(task.status) && await isWaitingClient(taskId)
  if (shouldPause && !open) {
    await prisma.taskPause.create({ data: { taskId, startedAt: now } })
    await prisma.taskHistory.create({ data: { taskId, action: 'os_paused', toValue: 'Aguardando o cliente', actorType: 'system', actorId: 'system', actorName: 'Sistema' } })
  } else if (!shouldPause && open) {
    const { count } = await prisma.taskPause.updateMany({ where: { id: open.id, endedAt: null }, data: { endedAt: now } })
    if (count > 0) {
      await prisma.taskHistory.create({ data: { taskId, action: 'os_resumed', toValue: 'Prazo voltou a contar', actorType: 'system', actorId: 'system', actorName: 'Sistema' } })
      await scheduleDeadline(taskId)
    }
  }
  if (task.column.board.type === 'PROCESS') await syncBoardPause(task.column.board.id, now)
}

async function pendingDependencies(taskId: string) {
  return prisma.taskDependency.findMany({
    where: { taskId, dependsOn: { status: { notIn: ['DONE', 'DISREGARDED'] } } },
    select: { dependsOn: { select: { title: true } } },
  })
}

// An OS waiting for others cannot start, move or finish
export async function assertReleased(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { osModelId: true, releasedAt: true } })
  if (!task?.osModelId || task.releasedAt) return
  const pending = await pendingDependencies(taskId)
  throw new AppError(409, `Esta OS aguarda: ${pending.map((p) => p.dependsOn.title).join(', ') || 'liberação'}`)
}

async function release(taskId: string, actor: { id: string; name: string } | null, early?: string): Promise<boolean> {
  // Guarded write: two dependencies finishing at the same instant release it only once
  const { count } = await prisma.task.updateMany({ where: { id: taskId, releasedAt: null }, data: { releasedAt: new Date() } })
  if (count === 0) return false
  await prisma.taskHistory.create({
    data: {
      taskId, action: early ? 'os_released_early' : 'os_released', toValue: early ?? 'Liberada',
      actorType: actor ? 'user' : 'system', actorId: actor?.id ?? 'system', actorName: actor?.name ?? 'Sistema',
    },
  })
  await scheduleDeadline(taskId)
  // Now its documents count: pending ones block it (and pause the clock)
  const { recalculateTaskStatus } = await import('@/modules/task-documents/task-documents.service')
  await recalculateTaskStatus(taskId)
  await onOSReleased(taskId, actor)
  // The client hears of an OS that waited for another one only now (not when it was created)
  // Already released and committed: a queue failure must not stop the other dependents
  try {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { title: true, column: { select: { board: { select: { organizationId: true, clientId: true } } } } } })
    await enqueueNotification({ event: 'TASK_CREATED', taskId, organizationId: t.column.board.organizationId, clientId: t.column.board.clientId, metadata: { taskTitle: t.title } })
  } catch (err) {
    logger.warn({ taskId, reason: err instanceof Error ? err.message : String(err) }, 'Falha ao avisar o cliente da OS liberada')
  }
  return true
}

// Releases an OS left with no pending dependency (its dependency was deleted, disregarded or done)
export async function releaseIfFree(taskId: string, actor: { id: string; name: string } | null): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { osModelId: true, releasedAt: true } })
  if (!task?.osModelId || task.releasedAt) return
  if ((await pendingDependencies(taskId)).length === 0) await release(taskId, actor)
}

// After an OS is done or disregarded: release the ones that only waited for it, close its pause and
// update the process
export async function onOSFinished(taskId: string, actor: { id: string; name: string } | null): Promise<void> {
  // The last pause (waiting for the client until now) moves the target before anyone judges lateness
  const { count: closed } = await prisma.taskPause.updateMany({ where: { taskId, endedAt: null }, data: { endedAt: new Date() } })
  if (closed > 0) await scheduleDeadline(taskId)
  const dependents = await prisma.taskDependency.findMany({ where: { dependsOnTaskId: taskId }, select: { taskId: true } })
  for (const { taskId: dependentId } of dependents) {
    if ((await pendingDependencies(dependentId)).length === 0) await release(dependentId, actor)
  }
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { column: { select: { board: { select: { id: true, type: true } } } } } })
  if (task?.column.board.type === 'PROCESS') {
    await syncProcessCompletion(task.column.board.id)
    await syncBoardPause(task.column.board.id)
  }
}

export async function releaseEarly(taskId: string, organizationId: string, actor: { id: string; name: string; role: string }, reason: string): Promise<void> {
  if (actor.role !== 'ORG_ADMIN' && actor.role !== 'ORG_MANAGER') throw new AppError(403, 'Só gerente ou administrador libera uma OS antes')
  const task = await prisma.task.findFirst({ where: { id: taskId, column: { board: { organizationId } } }, select: { osModelId: true, releasedAt: true } })
  if (!task?.osModelId) throw new AppError(404, 'OS não encontrada')
  if (task.releasedAt || !(await release(taskId, actor, reason))) throw new AppError(409, 'Esta OS já foi liberada')
}

// A process is waiting for the client when every released, unfinished task of it is paused
export async function syncBoardPause(boardId: string, now: Date = new Date()): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { column: { boardId }, status: { notIn: ['DONE', 'DISREGARDED'] }, OR: [{ osModelId: null }, { releasedAt: { not: null } }] },
    select: { id: true, osModelId: true, pauses: { where: { endedAt: null }, select: { id: true } } },
  })
  const paused = tasks.length > 0 && tasks.every((t) => t.osModelId && t.pauses.length > 0)
  const open = await prisma.boardPause.findFirst({ where: { boardId, endedAt: null } })
  if (paused && !open) await prisma.boardPause.create({ data: { boardId, startedAt: now } })
  if (!paused && open) {
    await prisma.boardPause.updateMany({ where: { id: open.id, endedAt: null }, data: { endedAt: now } })
    await scheduleBoardDeadline(boardId)
  }
}

// Process clock: N business days from its opening plus the business days it waited for the client
export async function scheduleBoardDeadline(boardId: string): Promise<void> {
  const board = await prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { createdAt: true, deadlineBusinessDays: true, organizationId: true, pauses: true } })
  if (!board.deadlineBusinessDays) return
  const holidays = await holidaysFrom(board.organizationId, board.createdAt)
  const closed = board.pauses.filter((p) => p.endedAt)
  const targetDate = addBusinessDays(day(board.createdAt), board.deadlineBusinessDays + pausedDays(closed, new Date(), holidays), holidays)
  await prisma.board.update({ where: { id: boardId }, data: { targetDate } })
}

// A holiday registered or removed later: recompute the targets of the open OS and processes whose
// window (release or opening → target) covers that day. Finished ones keep the target they had.
export async function rescheduleAroundHoliday(organizationId: string, date: Date): Promise<void> {
  // Superset by a day on each side (release instants count by the Brasília day); recomputing is idempotent
  const startedBy = new Date(date.getTime() + 2 * 86_400_000)
  const reaches = new Date(date.getTime() - 86_400_000)
  const tasks = await prisma.task.findMany({
    where: {
      column: { board: { organizationId } }, osModelId: { not: null }, deadlineBusinessDays: { not: null },
      status: { notIn: ['DONE', 'DISREGARDED'] }, releasedAt: { lt: startedBy }, targetDate: { gte: reaches },
    },
    select: { id: true },
  })
  for (const t of tasks) await scheduleDeadline(t.id)
  const boards = await prisma.board.findMany({
    where: { organizationId, type: 'PROCESS', deadlineBusinessDays: { not: null }, completedAt: null, createdAt: { lt: startedBy }, targetDate: { gte: reaches } },
    select: { id: true },
  })
  for (const b of boards) await scheduleBoardDeadline(b.id)
}

// Done when every task finished; an added or reopened task puts it back in progress
export async function syncProcessCompletion(boardId: string): Promise<void> {
  const [total, open] = await Promise.all([
    prisma.task.count({ where: { column: { boardId } } }),
    prisma.task.count({ where: { column: { boardId }, status: { notIn: ['DONE', 'DISREGARDED'] } } }),
  ])
  if (total > 0 && open === 0) {
    await prisma.board.updateMany({ where: { id: boardId, completedAt: null }, data: { completedAt: new Date() } })
  } else {
    await prisma.board.updateMany({ where: { id: boardId, completedAt: { not: null } }, data: { completedAt: null } })
  }
}

// Late = internal target passed (pauses already pushed it) and not waiting for the client right now
export async function isTaskLate(taskId: string, now: Date = new Date()): Promise<boolean> {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: { osModelId: true, targetDate: true, pauses: { where: { endedAt: null }, select: { id: true } }, column: { select: { board: { select: { organizationId: true } } } } },
  })
  if (!t?.osModelId || !t.targetDate || t.pauses.length > 0) return false
  return businessDaysBetween(t.targetDate, day(now), await holidaysFrom(t.column.board.organizationId, t.targetDate)) > 0
}

export async function isBoardLate(boardId: string, now: Date = new Date()): Promise<boolean> {
  const b = await prisma.board.findUnique({ where: { id: boardId }, select: { targetDate: true, organizationId: true, pauses: { where: { endedAt: null }, select: { id: true } } } })
  if (!b?.targetDate || b.pauses.length > 0) return false
  return businessDaysBetween(b.targetDate, day(now), await holidaysFrom(b.organizationId, b.targetDate)) > 0
}

// Finished without anyone giving a reason (automatic completion): flag it to be explained later
async function flagMissingDelayReason(taskId: string): Promise<void> {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true, delayReasonId: true, column: { select: { board: { select: { id: true, type: true, completedAt: true, delayReasonId: true } } } } } })
  if (!t || t.status !== 'DONE') return
  if (!t.delayReasonId && await isTaskLate(taskId, new Date())) {
    await prisma.task.update({ where: { id: taskId }, data: { delayReasonPending: true } })
  }
  const board = t.column.board
  if (board.type === 'PROCESS' && board.completedAt && !board.delayReasonId && await isBoardLate(board.id, new Date())) {
    await prisma.board.update({ where: { id: board.id }, data: { delayReasonPending: true } })
  }
}

// Every status change of a task goes through here: finishing releases dependents and closes the
// pause; reopening restarts the pause check and puts the process back in progress
export async function afterStatusChange(taskId: string, previous: string, next: string, actor: { id: string; name: string } | null): Promise<void> {
  if (previous === next) return
  if (FINISHED.includes(next) && !FINISHED.includes(previous)) {
    // Late check before the pause closes (a paused OS is not late)
    if (next === 'DONE') await flagMissingDelayReason(taskId)
    await onOSFinished(taskId, actor)
    if (next === 'DONE') await flagMissingDelayReason(taskId)
    return
  }
  if (FINISHED.includes(previous) && !FINISHED.includes(next)) {
    await syncPause(taskId)
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { column: { select: { board: { select: { id: true, type: true } } } } } })
    if (task?.column.board.type === 'PROCESS') await syncProcessCompletion(task.column.board.id)
  }
}
