import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { isTaskLate, isBoardLate } from '@/modules/os/os-deadline.service'
import type { CreateDelayReasonBody, UpdateDelayReasonBody } from './delay-reasons.schema'

const DEFAULTS = [
  { name: 'Aguardando órgão público', requiresNote: false },
  { name: 'Retrabalho interno', requiresNote: false },
  { name: 'Volume de trabalho', requiresNote: false },
  { name: 'Outro', requiresNote: true },
]

// The office starts with the default reasons (created on its first read) and edits the list
export async function listDelayReasons(organizationId: string) {
  if ((await prisma.delayReason.count({ where: { organizationId } })) === 0) {
    await prisma.delayReason.createMany({ data: DEFAULTS.map((d, i) => ({ ...d, organizationId, position: i })), skipDuplicates: true })
  }
  return prisma.delayReason.findMany({ where: { organizationId }, orderBy: { position: 'asc' } })
}

export async function createDelayReason(organizationId: string, data: CreateDelayReasonBody) {
  const position = await prisma.delayReason.count({ where: { organizationId } })
  try {
    return await prisma.delayReason.create({ data: { ...data, organizationId, position } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'Já existe esse motivo')
    throw err
  }
}

export async function updateDelayReason(id: string, organizationId: string, data: UpdateDelayReasonBody) {
  const { count } = await prisma.delayReason.updateMany({ where: { id, organizationId }, data })
  if (count === 0) throw new AppError(404, 'Motivo não encontrado')
  return prisma.delayReason.findUniqueOrThrow({ where: { id } })
}

// Used reasons are deactivated (history keeps pointing to them)
export async function deleteDelayReason(id: string, organizationId: string) {
  const reason = await prisma.delayReason.findFirst({ where: { id, organizationId }, select: { _count: { select: { tasks: true, boards: true } } } })
  if (!reason) throw new AppError(404, 'Motivo não encontrado')
  if (reason._count.tasks + reason._count.boards > 0) {
    await prisma.delayReason.update({ where: { id }, data: { isActive: false } })
    return { id, deactivated: true }
  }
  await prisma.delayReason.delete({ where: { id } })
  return { id, deactivated: false }
}

async function resolveReason(organizationId: string, id: string, note: string | undefined) {
  const reason = await prisma.delayReason.findFirst({ where: { id, organizationId, isActive: true } })
  if (!reason) throw new AppError(404, 'Motivo não encontrado')
  if (reason.requiresNote && !note?.trim()) throw new AppError(422, 'Descreva o motivo')
  return { id: reason.id, name: reason.name, note: note?.trim() || null }
}

export interface FinishReasons {
  delayReasonId?: string
  delayNote?: string
  processDelayReasonId?: string
  processDelayNote?: string
}
export interface FinishPlan {
  task?: { id: string; name: string; note: string | null }
  process?: { boardId: string; id: string; name: string; note: string | null }
}

// Finishing (DONE) an OS after its deadline needs a reason, unless one was registered before; when
// this OS is the last open task of a late process, the process needs one too
export async function planDelayReasonsOnFinish(taskId: string, organizationId: string, input: FinishReasons, now: Date = new Date()): Promise<FinishPlan> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
    select: { delayReasonId: true, column: { select: { board: { select: { id: true, type: true, delayReasonId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  const plan: FinishPlan = {}
  if (input.delayReasonId) plan.task = await resolveReason(organizationId, input.delayReasonId, input.delayNote)
  else if (!task.delayReasonId && await isTaskLate(taskId, now)) throw new AppError(422, 'Informe o motivo do atraso')

  const board = task.column.board
  if (board.type === 'PROCESS') {
    const othersOpen = await prisma.task.count({ where: { column: { boardId: board.id }, id: { not: taskId }, status: { notIn: ['DONE', 'DISREGARDED'] } } })
    if (othersOpen === 0) {
      if (input.processDelayReasonId) {
        plan.process = { boardId: board.id, ...await resolveReason(organizationId, input.processDelayReasonId, input.processDelayNote) }
      } else if (!board.delayReasonId && await isBoardLate(board.id, now)) {
        throw new AppError(422, 'Informe o motivo do atraso do processo')
      }
    }
  }
  return plan
}

export async function applyDelayReasons(taskId: string, plan: FinishPlan, actor: { id: string; name: string }): Promise<void> {
  if (plan.task) await setTaskReason(taskId, plan.task, actor)
  if (plan.process) await setBoardReason(plan.process.boardId, taskId, plan.process, actor)
}

async function setTaskReason(taskId: string, r: { id: string; name: string; note: string | null }, actor: { id: string; name: string }) {
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { delayReasonId: r.id, delayNote: r.note, delayReasonPending: false } }),
    prisma.taskHistory.create({ data: { taskId, action: 'delay_reason_set', fromValue: r.name, toValue: r.note, actorType: 'user', actorId: actor.id, actorName: actor.name } }),
  ])
}

async function setBoardReason(boardId: string, taskId: string, r: { id: string; name: string; note: string | null }, actor: { id: string; name: string }) {
  await prisma.$transaction([
    prisma.board.update({ where: { id: boardId }, data: { delayReasonId: r.id, delayNote: r.note, delayReasonPending: false } }),
    prisma.taskHistory.create({ data: { taskId, action: 'process_delay_reason_set', fromValue: r.name, toValue: r.note, actorType: 'user', actorId: actor.id, actorName: actor.name } }),
  ])
}

// Registered before finishing, or resolving a pending one
export async function setTaskDelayReason(taskId: string, organizationId: string, body: { delayReasonId: string; delayNote?: string }, actor: { id: string; name: string }) {
  const task = await prisma.task.findFirst({ where: { id: taskId, column: { board: { organizationId } } }, select: { osModelId: true } })
  if (!task?.osModelId) throw new AppError(404, 'OS não encontrada')
  await setTaskReason(taskId, await resolveReason(organizationId, body.delayReasonId, body.delayNote), actor)
  return { id: taskId }
}

export async function setBoardDelayReason(boardId: string, organizationId: string, body: { delayReasonId: string; delayNote?: string }, actor: { id: string; name: string }) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId, type: 'PROCESS' }, select: { id: true } })
  if (!board) throw new AppError(404, 'Processo não encontrado')
  const anyTask = await prisma.task.findFirst({ where: { column: { boardId } }, select: { id: true } })
  const r = await resolveReason(organizationId, body.delayReasonId, body.delayNote)
  if (anyTask) await setBoardReason(boardId, anyTask.id, r, actor)
  else await prisma.board.update({ where: { id: boardId }, data: { delayReasonId: r.id, delayNote: r.note, delayReasonPending: false } })
  return { id: boardId }
}
