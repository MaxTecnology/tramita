import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishBoardEvent } from '@/lib/sse'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import { Prisma } from '@prisma/client'
import type { CreateTaskBody, UpdateTaskBody, MoveTaskBody, ReorderTasksBody, ListTasksQuery } from './tasks.schema'

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

// Task.departmentId is required at the DB level. createTask itself always
// receives a real departmentId now (Zod enforces it), so the only remaining
// caller of this fallback is approveRequest, for a Request that was opened
// without a department — it resolves to the org's first department, or
// auto-creates a generic "Geral" one if the org has none yet.
export async function defaultDepartmentForOrg(organizationId: string): Promise<string> {
  const existing = await prisma.department.findFirst({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing.id

  try {
    const created = await prisma.department.create({ data: { organizationId, name: 'Geral' } })
    return created.id
  } catch (err) {
    // Two concurrent calls can both see "no department yet" and race to create "Geral" —
    // the loser hits the @@unique([organizationId, name]) constraint. Re-query instead of
    // failing the whole task creation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.department.findFirst({ where: { organizationId, name: 'Geral' } })
      if (winner) return winner.id
    }
    throw err
  }
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
  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  const departmentId = data.departmentId
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
        departmentId,
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

  const nextStatus = toColumn.statusEffect !== 'NONE' ? toColumn.statusEffect : task.status

  const updatedTask = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { columnId: data.columnId, position: data.position, status: nextStatus },
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

  // Coluna configurada pra notificar (via Template de OS) manda mesmo se o toggle global
  // "Tarefa movida" da org estiver desligado — é uma escolha explícita por coluna, não o
  // aviso genérico de qualquer movimentação.
  await enqueueNotification({
    event: 'TASK_MOVED',
    taskId,
    organizationId,
    clientId: toColumn.board.clientId,
    channels: toColumn.notifyClient ? ['WHATSAPP', 'EMAIL'] : undefined,
    metadata: { taskTitle: task.title, fromColumn: fromColumn.title, toColumn: toColumn.title },
  })

  if (toColumn.statusEffect === 'DONE') {
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

  // Documentos configurados na coluna de destino (via Template de OS) — cria os
  // TaskDocumentRequirement que ainda não existem pra essa tarefa (evita duplicar se ela
  // passar pela mesma coluna mais de uma vez).
  const columnDocs = await prisma.columnDocument.findMany({ where: { columnId: data.columnId } })
  if (columnDocs.length > 0) {
    const existingNames = new Set(
      (await prisma.taskDocumentRequirement.findMany({ where: { taskId }, select: { name: true } }))
        .map((d) => d.name),
    )
    const toCreate = columnDocs.filter((d) => !existingNames.has(d.name))
    if (toCreate.length > 0) {
      const basePosition = await prisma.taskDocumentRequirement.count({ where: { taskId } })
      await prisma.taskDocumentRequirement.createMany({
        data: toCreate.map((d, i) => ({ taskId, name: d.name, position: basePosition + i })),
      })
    }
  }

  return updatedTask
}

// Todo cliente com pelo menos uma Tarefa Recorrente vinculada precisa de uma "casa" pra essas
// tarefas existirem no banco — não porque o usuário vê ou gerencia esse board (ele nunca aparece
// em nenhuma tela), mas porque toda a lógica de escopo por departamento do portal do cliente
// (comments/attachments/task-documents/notification worker) resolve a empresa de uma tarefa via
// task.column.board.clientId. Criar essa cadeia uma vez por cliente é mais barato do que refatorar
// essa cadeia inteira pra aceitar Task sem coluna.
export async function ensureRecurringSystemBoard(clientId: string, organizationId: string) {
  const existing = await prisma.board.findFirst({
    where: { clientId, organizationId, type: 'RECURRING_SYSTEM' },
    include: { columns: true },
  })
  if (existing && existing.columns[0]) return existing

  return prisma.board.create({
    data: {
      title: 'Tarefas Recorrentes (sistema)',
      organizationId,
      clientId,
      type: 'RECURRING_SYSTEM',
      isActive: true,
      columns: { create: [{ title: 'Recorrentes', position: 0, statusEffect: 'NONE' }] },
    },
    include: { columns: true },
  })
}

export async function updateTask(
  id: string,
  organizationId: string,
  data: UpdateTaskBody,
  actor: Actor,
) {
  const task = await verifyTaskBelongsToOrg(id, organizationId)
  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  const actorName = await resolveActorName(actor.id, actor.type)

  const historyEntries: Array<{ action: string; fromValue?: string; toValue?: string }> = []

  if (data.priority !== undefined && data.priority !== task.priority) {
    historyEntries.push({
      action: 'priority_changed',
      fromValue: task.priority,
      toValue: data.priority,
    })
  }
  if (data.status !== undefined && data.status !== task.status) {
    historyEntries.push({
      action: 'status_changed',
      fromValue: task.status,
      toValue: data.status,
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
        status: data.status,
        assigneeId: data.assigneeId,
        dueDate:
          data.dueDate === null ? null
          : data.dueDate !== undefined ? new Date(data.dueDate)
          : undefined,
        tags: data.tags,
        departmentId: data.departmentId,
        visibleToClient: data.visibleToClient,
        targetDate:
          data.targetDate === null ? null
          : data.targetDate !== undefined ? new Date(data.targetDate)
          : undefined,
        competence:
          data.competence === null ? null
          : data.competence !== undefined ? new Date(data.competence)
          : undefined,
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

// Lista tarefas de forma flat, atravessando todos os boards da org (inclusive o board de
// sistema RECURRING_SYSTEM, que é onde moram as tarefas recorrentes) — ver nota em
// tasks.schema.ts / brief da Task 4 sobre por que não filtramos Board.type aqui.
export async function listTasks(
  organizationId: string,
  actor: { id: string; role: string },
  query: ListTasksQuery,
) {
  const where: Prisma.TaskWhereInput = {
    column: {
      board: {
        organizationId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
      },
    },
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.recurringTemplateId ? { recurringTemplateId: query.recurringTemplateId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          targetDate: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        }
      : {}),
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
  }

  if (actor.role === 'ORG_MEMBER') where.assigneeId = actor.id

  return prisma.task.findMany({
    where,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      targetDate: true,
      dueDate: true,
      recurringTemplateId: true,
      department: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      column: { select: { board: { select: { id: true, clientId: true, client: { select: { id: true, name: true, codigo: true } } } } } },
    },
    orderBy: { targetDate: 'asc' },
  })
}

export async function getTaskHistory(taskId: string, organizationId: string) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  })
}
