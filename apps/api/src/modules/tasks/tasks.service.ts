import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishBoardEvent } from '@/lib/sse'
import type { CreateTaskBody, UpdateTaskBody, MoveTaskBody, ReorderTasksBody } from './tasks.schema'

export interface Actor {
  id: string
  type: 'user' | 'client'
}

// Called BEFORE $transaction to avoid incompatible tx type
async function resolveActorName(actorId: string, actorType: 'user' | 'client'): Promise<string> {
  if (actorType === 'user') {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
    return u?.name ?? 'Unknown'
  }
  const c = await prisma.client.findUnique({ where: { id: actorId }, select: { name: true } })
  return c?.name ?? 'Unknown'
}

async function verifyColumnBelongsToOrg(columnId: string, organizationId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId },
    include: { board: { select: { id: true, organizationId: true, clientId: true } } },
  })
  if (!column || column.board.organizationId !== organizationId) {
    throw new AppError(404, 'Coluna não encontrada')
  }
  return column
}

async function verifyTaskBelongsToOrg(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    include: {
      column: {
        include: { board: { select: { id: true, organizationId: true, clientId: true } } },
      },
    },
  })
  if (!task || task.column.board.organizationId !== organizationId) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task
}

export async function createTask(
  columnId: string,
  organizationId: string,
  data: CreateTaskBody,
  actor: Actor,
) {
  const column = await verifyColumnBelongsToOrg(columnId, organizationId)
  const actorName = await resolveActorName(actor.id, actor.type)

  const task = await prisma.$transaction(async (tx) => {
    const position = await tx.task.count({ where: { columnId } })

    const created = await tx.task.create({
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        tags: data.tags,
        position,
        columnId,
        creatorId: actor.id,
      },
    })

    await tx.taskHistory.create({
      data: {
        taskId: created.id,
        action: 'created',
        toValue: data.title,
        actorType: actor.type,
        actorId: actor.id,
        actorName,
      },
    })

    return created
  })

  await enqueueNotification({
    event: 'TASK_CREATED',
    taskId: task.id,
    organizationId,
    clientId: column.board.clientId,
    metadata: { taskTitle: task.title },
  })

  await publishBoardEvent(column.board.id, {
    event: 'task:created',
    data: { taskId: task.id, columnId, title: task.title },
  })

  return task
}

export async function moveTask(
  taskId: string,
  organizationId: string,
  data: MoveTaskBody,
  actor: Actor,
) {
  const task = await verifyTaskBelongsToOrg(taskId, organizationId)
  const fromColumn = task.column
  const toColumn = await verifyColumnBelongsToOrg(data.columnId, organizationId)
  const actorName = await resolveActorName(actor.id, actor.type)

  const updatedTask = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: data.columnId,
        position: data.position,
        ...(toColumn.isFinal ? { status: 'DONE' } : {}),
      },
    })

    await tx.taskHistory.create({
      data: {
        taskId,
        action: 'moved_to',
        fromValue: fromColumn.title,
        toValue: toColumn.title,
        actorType: actor.type,
        actorId: actor.id,
        actorName,
      },
    })

    return updated
  })

  await enqueueNotification({
    event: 'TASK_MOVED',
    taskId,
    organizationId,
    clientId: toColumn.board.clientId,
    metadata: {
      taskTitle: task.title,
      fromColumn: fromColumn.title,
      toColumn: toColumn.title,
    },
  })

  if (toColumn.isFinal) {
    await enqueueNotification({
      event: 'TASK_COMPLETED',
      taskId,
      organizationId,
      clientId: toColumn.board.clientId,
      metadata: { taskTitle: task.title },
    })
  }

  await publishBoardEvent(toColumn.board.id, {
    event: 'task:moved',
    data: { taskId, fromColumn: fromColumn.id, toColumn: data.columnId, position: data.position },
  })

  return updatedTask
}

export async function updateTask(
  id: string,
  organizationId: string,
  data: UpdateTaskBody,
  actor: Actor,
) {
  const task = await verifyTaskBelongsToOrg(id, organizationId)
  const actorName = await resolveActorName(actor.id, actor.type)

  const historyEntries: Array<{ action: string; fromValue?: string; toValue?: string }> = []

  if (data.priority !== undefined && data.priority !== task.priority) {
    historyEntries.push({
      action: 'priority_changed',
      fromValue: task.priority,
      toValue: data.priority,
    })
  }
  if (data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) {
    historyEntries.push({
      action: 'assigned_to',
      fromValue: task.assigneeId ?? undefined,
      toValue: data.assigneeId ?? undefined,
    })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.task.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        assigneeId: data.assigneeId,
        dueDate:
          data.dueDate === null ? null
          : data.dueDate !== undefined ? new Date(data.dueDate)
          : undefined,
        tags: data.tags,
      },
    })

    for (const entry of historyEntries) {
      await tx.taskHistory.create({
        data: {
          taskId: id,
          action: entry.action,
          fromValue: entry.fromValue,
          toValue: entry.toValue,
          actorType: actor.type,
          actorId: actor.id,
          actorName,
        },
      })
    }

    return result
  })

  await publishBoardEvent(task.column.board.id, {
    event: 'task:updated',
    data: { taskId: id },
  })

  return updated
}

export async function reorderTasks(items: ReorderTasksBody, organizationId: string) {
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: items.map((i) => i.id) },
      column: { board: { organizationId } },
    },
  })
  if (tasks.length !== items.length) throw new AppError(403, 'Acesso negado')

  await prisma.$transaction(
    items.map((i) =>
      prisma.task.update({ where: { id: i.id }, data: { position: i.position, columnId: i.columnId } }),
    ),
  )
  return { ok: true }
}

export async function deleteTask(id: string, organizationId: string) {
  await verifyTaskBelongsToOrg(id, organizationId)
  await prisma.task.delete({ where: { id } })
  return { ok: true }
}
