import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishBoardEvent } from '@/lib/sse'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import { recalculateTaskStatus, notifyIfBlocked } from '@/modules/task-documents/task-documents.service'
import { Prisma } from '@prisma/client'
import { resolveCompletedAt } from '@/lib/task-completion'
import type { CreateTaskBody, UpdateTaskBody, MoveTaskBody, ReorderTasksBody, ListTasksQuery } from './tasks.schema'
import { assertDepartmentServesClient, lockClients } from '@/modules/clients/client-coverage'
import { syncProtocolsForTask } from '@/modules/protocols/protocol-from-deliverable'
import { actorScope, taskWhere, mineTaskWhere } from '@/modules/staff-scope/staff-scope'

export interface Actor {
  id: string
  type: 'user' | 'client'
}

const DEFAULT_LIST_TASKS_LIMIT = 200
const MAX_LIST_TASKS_LIMIT = 500

// Called BEFORE $transaction to avoid incompatible tx type
async function resolveActorName(actorId: string, actorType: 'user' | 'client'): Promise<string> {
  if (actorType === 'user') {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
    return u?.name ?? 'Unknown'
  }
  const c = await prisma.client.findUnique({ where: { id: actorId }, select: { name: true } })
  return c?.name ?? 'Unknown'
}

const CLOSED_STATUSES = ['DONE', 'DISREGARDED']

function isReopening(from: string, to: string): boolean {
  return CLOSED_STATUSES.includes(from) && !CLOSED_STATUSES.includes(to)
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
    // Coverage checked under the client lock: an admin unserving this department at the same
    // instant either commits first (this is refused) or waits for this task to exist (and is refused)
    await lockClients(tx, [column.board.clientId])
    const departmentResponsibleId = await assertDepartmentServesClient(tx, column.board.clientId, data.departmentId)
    const position = await tx.task.count({ where: { columnId } })

    const created = await tx.task.create({
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        // No assignee chosen → the department's responsible for this client (never orphaned)
        assigneeId: data.assigneeId ?? departmentResponsibleId,
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
  if (toColumn.board.id !== task.column.board.id) {
    throw new AppError(400, 'A tarefa só pode ser movida dentro do mesmo processo')
  }
  const actorName = await resolveActorName(actor.id, actor.type)

  const nextStatus = toColumn.statusEffect !== 'NONE' ? toColumn.statusEffect : task.status
  // Tarefa concluída pode ter ficado num departamento que deixou de atender o cliente — reabrir ali
  // criaria uma tarefa aberta invisível pro cliente (I5).
  if (isReopening(task.status, nextStatus)) {
    await assertDepartmentServesClient(prisma, task.column.board.clientId, task.departmentId)
  }
  const completedAt = resolveCompletedAt(task.status, nextStatus, new Date())

  const updatedTask = await prisma.$transaction(async (tx) => {
    if (isReopening(task.status, nextStatus)) {
      await lockClients(tx, [task.column.board.clientId])
      await assertDepartmentServesClient(tx, task.column.board.clientId, task.departmentId)
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { columnId: data.columnId, position: data.position, status: nextStatus, completedAt },
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

    // Correção: moveTask mudava status via Column.statusEffect sem nunca gravar status_changed,
    // só moved_to — reconstruir "quando ficou DONE/BLOCKED" a partir disso exigiria saber o
    // statusEffect da coluna NO MOMENTO (pode ter sido reconfigurado depois). Unifica com
    // updateTask: toda mudança de status real grava status_changed, independente do caminho.
    if (nextStatus !== task.status) {
      await tx.taskHistory.create({
        data: {
          taskId,
          action: 'status_changed',
          fromValue: task.status,
          toValue: nextStatus,
          actorType: actor.type,
          actorId: actor.id,
          actorName,
        },
      })
    }

    return updated
  })

  // Coluna configurada pra notificar (via Template de OS) manda mesmo se o toggle global
  // "Tarefa movida" da org estiver desligado — é uma escolha explícita por coluna, não o
  // aviso genérico de qualquer movimentação. forceChannels bypassa o gate de evento no worker
  // (channels sozinho só restringe, nunca força — ver notification.worker.ts).
  await enqueueNotification({
    event: 'TASK_MOVED',
    taskId,
    organizationId,
    clientId: toColumn.board.clientId,
    forceChannels: toColumn.notifyClient ? ['WHATSAPP', 'EMAIL'] : undefined,
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

  await notifyIfBlocked(taskId, task.status, nextStatus, toColumn.board.clientId, organizationId, task.visibleToClient)

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
      // Recalcula DEPOIS do statusEffect da coluna já ter sido aplicado acima — um conjunto de
      // documentos genuinamente bloqueante precisa vencer um status como STARTED, não o contrário.
      await recalculateTaskStatus(taskId)
      return prisma.task.findUniqueOrThrow({ where: { id: taskId } })
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
  if (data.departmentId && data.departmentId !== task.departmentId) {
    await assertDepartmentServesClient(prisma, task.column.board.clientId, data.departmentId)
  } else if (data.status && isReopening(task.status, data.status)) {
    await assertDepartmentServesClient(prisma, task.column.board.clientId, task.departmentId)
  }

  // Tarefa recorrente: vencimento e meta são o prazo legal/interno que o motor de recorrência
  // calculou — editar aqui corromperia o controle que a tarefa existe pra garantir. Travado pra
  // todo mundo, sem exceção; quem precisar corrigir ajusta o template e gera de novo.
  if (task.recurringTemplateId && (data.dueDate !== undefined || data.targetDate !== undefined)) {
    throw new AppError(400, 'Vencimento e meta de uma tarefa recorrente não podem ser editados diretamente — ajuste o template de recorrência')
  }

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
  if (data.departmentId !== undefined && data.departmentId !== task.departmentId) {
    historyEntries.push({
      action: 'department_changed',
      fromValue: task.departmentId,
      toValue: data.departmentId,
    })
  }

  const completedAt = data.status !== undefined
    ? resolveCompletedAt(task.status, data.status, new Date())
    : undefined

  const updated = await prisma.$transaction(async (tx) => {
    // Same checks as above, now under the client lock (the early ones only fail fast)
    if (data.departmentId && data.departmentId !== task.departmentId) {
      await lockClients(tx, [task.column.board.clientId])
      await assertDepartmentServesClient(tx, task.column.board.clientId, data.departmentId)
    } else if (data.status && isReopening(task.status, data.status)) {
      await lockClients(tx, [task.column.board.clientId])
      await assertDepartmentServesClient(tx, task.column.board.clientId, task.departmentId)
    }
    const result = await tx.task.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        completedAt,
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

  if (data.status !== undefined) {
    await notifyIfBlocked(id, task.status, data.status, task.column.board.clientId, organizationId, updated.visibleToClient)
  }

  // Task became visible to the client: deliveries already done turn into documents in the portal
  if (!task.visibleToClient && updated.visibleToClient) {
    await syncProtocolsForTask(id, { id: actor.id })
  }

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
    select: { id: true, column: { select: { boardId: true } } },
  })
  if (tasks.length !== items.length) throw new AppError(403, 'Acesso negado')

  // Reordenar nunca pode tirar a tarefa do processo dela (outro cliente, outra organização) — mesma
  // regra do moveTask.
  const boardByTask = new Map(tasks.map((t) => [t.id, t.column.boardId]))
  const targetColumns = await prisma.column.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.columnId))] } },
    select: { id: true, boardId: true },
  })
  const boardByColumn = new Map(targetColumns.map((c) => [c.id, c.boardId]))
  if (items.some((i) => boardByColumn.get(i.columnId) !== boardByTask.get(i.id))) {
    throw new AppError(400, 'A tarefa só pode ser movida dentro do mesmo processo')
  }

  await prisma.$transaction(
    items.map((i) =>
      prisma.task.update({ where: { id: i.id }, data: { position: i.position, columnId: i.columnId } }),
    ),
  )
  return { ok: true }
}

export async function deleteTask(id: string, organizationId: string) {
  await verifyTaskBelongsToOrg(id, organizationId)
  const protocolCount = await prisma.protocol.count({ where: { taskId: id } })
  if (protocolCount > 0) {
    throw new AppError(409, 'Essa tarefa tem protocolos — eles são evidência legal e não podem ser apagados junto com a tarefa')
  }
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
        ...(query.boardType ? { type: query.boardType } : {}),
      },
    },
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.status
      ? { status: query.status }
      : query.openOnly
        ? { status: { notIn: ['DONE', 'DISREGARDED'] } }
        : {}),
    ...(query.recurringTemplateId ? { recurringTemplateId: query.recurringTemplateId } : {}),
    ...(query.dateFrom || query.dateTo
      ? query.dateField === 'effective'
        ? {
            OR: [
              {
                targetDate: {
                  ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                  ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
                },
              },
              {
                targetDate: null,
                dueDate: {
                  ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                  ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
                },
              },
            ],
          }
        : {
            targetDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
      : {}),
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
  }

  // Permission (staff scope) + the screen filter (Minhas · Meu departamento · Todas)
  const scope = await actorScope(actor, organizationId)
  const view = scope.kind === 'ALL' ? (query.scope ?? 'all') : query.scope === 'mine' ? 'mine' : 'department'
  // A department filter outside my departments shows nothing (never another department's work)
  if (scope.kind === 'LIMITED' && view === 'department' && query.departmentId && !scope.departmentIds.includes(query.departmentId)) {
    return { items: [], nextCursor: null }
  }
  where.AND = [taskWhere(scope), ...(view === 'mine' ? [mineTaskWhere(actor.id)] : [])]

  const limit = Math.min(query.limit ?? DEFAULT_LIST_TASKS_LIMIT, MAX_LIST_TASKS_LIMIT)

  // targetDate não é único — duas tarefas podem compartilhar a mesma data (ou ambas serem null).
  // orderBy só por targetDate tornaria o cursor ambíguo entre linhas empatadas (poderia pular ou
  // repetir uma tarefa ao virar a página); id como critério secundário garante uma ordem total
  // estável, que é o que o cursor em si (um id único) exige pra funcionar corretamente.
  const rows = await prisma.task.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      position: true,
      columnId: true,
      assigneeId: true,
      creatorId: true,
      sourceRequestId: true,
      departmentId: true,
      tags: true,
      competence: true,
      targetDate: true,
      dueDate: true,
      recurringTemplateId: true,
      visibleToClient: true,
      createdAt: true,
      updatedAt: true,
      department: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      column: { select: { board: { select: { id: true, clientId: true, client: { select: { id: true, name: true, codigo: true } } } } } },
    },
    orderBy: [{ targetDate: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1].id : null

  return { items, nextCursor }
}

export async function getTaskHistory(taskId: string, organizationId: string) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  })
}
