import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishBoardEvent } from '@/lib/sse'
import { onTaskAssigned } from '@/modules/inbox/inbox-events'
import { assertDepartmentServesClient, lockClients } from '@/modules/clients/client-coverage'
import { loadStaffScope, clientWhere } from '@/modules/staff-scope/staff-scope'
import { createBoard } from '@/modules/boards/boards.service'
import type { CreateBoardBody } from '@/modules/boards/boards.schema'
import { ensureServiceSystemBoard } from '@/modules/tasks/tasks.service'
import { scheduleDeadline, scheduleBoardDeadline } from './os-deadline.service'
import { competenceToDate, type OpenOSBody, type AddOSToProcessBody } from './os.schema'
import { startOfMonthInBRT } from '@/lib/date-only'

export interface OSActor { id: string; role: string }

const MODEL_INCLUDE = {
  documentRequests: { orderBy: { position: 'asc' as const } },
  documentDeliveries: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.OSModelInclude
type ModelWithDocs = Prisma.OSModelGetPayload<{ include: typeof MODEL_INCLUDE }>

const FINISHED = ['DONE', 'DISREGARDED'] as const

async function loadModel(osModelId: string, organizationId: string): Promise<ModelWithDocs> {
  const model = await prisma.oSModel.findFirst({ where: { id: osModelId, organizationId }, include: MODEL_INCLUDE })
  if (!model) throw new AppError(404, 'Modelo de OS não encontrado')
  if (!model.isActive) throw new AppError(422, 'Modelo de OS inativo')
  return model
}

async function assertClientInScope(organizationId: string, actor: OSActor, clientId: string) {
  const scope = await loadStaffScope({ sub: actor.id, role: actor.role, organizationId })
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId, isActive: true, ...clientWhere(scope) }, select: { id: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')
}

async function assertAssignee(organizationId: string, assigneeId: string | undefined) {
  if (!assigneeId) return
  const found = await prisma.user.count({ where: { id: assigneeId, organizationId, isActive: true } })
  if (!found) throw new AppError(404, 'Usuário não encontrado')
}

function osTitle(model: { name: string }, competence: Date | null): string {
  if (!competence) return model.name
  const mm = String(competence.getUTCMonth() + 1).padStart(2, '0')
  return `${model.name} — ${mm}/${competence.getUTCFullYear()}`
}

interface NewOS {
  organizationId: string
  clientId: string
  boardId: string
  columnId: string
  model: ModelWithDocs
  competence: Date | null
  assigneeId?: string
  dueDate?: Date
  released: boolean
  sourceRequestId?: string
  actorId: string
}

// One OS = one task copied from its model (documents, robot per delivery, deadline). The department
// must serve the client (same rule as any task); without an assignee it goes to the department's
// responsible for the client.
async function insertOSTask(tx: Prisma.TransactionClient, os: NewOS, actorName: string) {
  const responsibleId = await assertDepartmentServesClient(tx, os.clientId, os.model.departmentId)
  const position = await tx.task.count({ where: { columnId: os.columnId } })
  const task = await tx.task.create({
    data: {
      title: osTitle(os.model, os.model.requiresCompetence ? os.competence : null),
      description: os.model.description,
      priority: os.model.priority,
      // Waiting for another OS: open until released (then documents may block it)
      status: os.released && os.model.documentRequests.length > 0 ? 'BLOCKED' : 'OPEN',
      columnId: os.columnId,
      departmentId: os.model.departmentId,
      assigneeId: os.assigneeId ?? responsibleId,
      creatorId: os.actorId,
      competence: os.competence,
      dueDate: os.dueDate,
      visibleToClient: os.model.visibleToClient,
      osModelId: os.model.id,
      deadlineBusinessDays: os.model.deadlineBusinessDays,
      releasedAt: os.released ? new Date() : null,
      sourceRequestId: os.sourceRequestId,
      position,
      tags: [],
    },
  })
  if (os.model.documentRequests.length > 0) {
    await tx.taskDocumentRequirement.createMany({ data: os.model.documentRequests.map((d, i) => ({ taskId: task.id, name: d.name, position: i })) })
  }
  if (os.model.documentDeliveries.length > 0) {
    await tx.taskDeliverable.createMany({
      data: os.model.documentDeliveries.map((d, i) => ({ taskId: task.id, name: d.name, requiresPayment: d.requiresPayment, obligationTypeId: d.obligationTypeId, position: i })),
    })
  }
  await tx.taskHistory.create({ data: { taskId: task.id, action: 'created', toValue: task.title, actorType: 'user', actorId: os.actorId, actorName } })
  return task
}

async function actorName(actorId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  return user?.name ?? 'Escritório'
}

async function afterOSCreated(taskId: string, organizationId: string, clientId: string, boardId: string, columnId: string, title: string, actor: { id: string; name: string }) {
  await scheduleDeadline(taskId)
  await enqueueNotification({ event: 'TASK_CREATED', taskId, organizationId, clientId, metadata: { taskTitle: title } })
  await onTaskAssigned(taskId, { userId: actor.id, name: actor.name })
  await publishBoardEvent(boardId, { event: 'task:created', data: { taskId, columnId, title } })
}

// Standalone OS: lives in the client's services board (one per client, like the recurring one)
export async function openOS(organizationId: string, actor: OSActor, body: OpenOSBody, opts: { sourceRequestId?: string } = {}) {
  const model = await loadModel(body.osModelId, organizationId)
  if (!model.usableStandalone) throw new AppError(422, 'Essa OS é só de processo')
  if (model.requiresCompetence && !body.competence) throw new AppError(422, 'Informe a competência')
  await assertClientInScope(organizationId, actor, body.clientId)
  await assertAssignee(organizationId, body.assigneeId)

  const board = await ensureServiceSystemBoard(body.clientId, organizationId)
  const columnId = board.columns.sort((a, b) => a.position - b.position)[0].id
  const name = await actorName(actor.id)
  const task = await prisma.$transaction(async (tx) => {
    await lockClients(tx, [body.clientId])
    return insertOSTask(tx, {
      organizationId, clientId: body.clientId, boardId: board.id, columnId, model,
      // Without a competence of its own, the opening month is the reference (the portal groups the
      // client's documents by month in "Enviar documentos")
      competence: body.competence ? competenceToDate(body.competence) : startOfMonthInBRT(new Date()),
      assigneeId: body.assigneeId, dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      released: true, sourceRequestId: opts.sourceRequestId, actorId: actor.id,
    }, name)
  })
  await afterOSCreated(task.id, organizationId, body.clientId, board.id, columnId, task.title, { id: actor.id, name })
  return prisma.task.findUniqueOrThrow({ where: { id: task.id } })
}

// OS added to an existing process, optionally waiting for other OS of the same process
export async function addOSToProcess(organizationId: string, actor: OSActor, boardId: string, body: AddOSToProcessBody, opts: { sourceRequestId?: string } = {}) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId, isActive: true, type: 'PROCESS' }, select: { id: true, clientId: true, competence: true } })
  if (!board) throw new AppError(404, 'Processo não encontrado')
  await assertClientInScope(organizationId, actor, board.clientId)
  const model = await loadModel(body.osModelId, organizationId)
  if (!model.usableInProcess) throw new AppError(422, 'Essa OS não é usada em processos')
  const competence = body.competence ? competenceToDate(body.competence) : board.competence
  if (model.requiresCompetence && !competence) throw new AppError(422, 'Informe a competência')
  const column = await prisma.column.findFirst({ where: { id: body.columnId, boardId }, select: { id: true } })
  if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
  await assertAssignee(organizationId, body.assigneeId)
  const deps = await prisma.task.findMany({ where: { id: { in: body.dependsOnTaskIds }, column: { boardId } }, select: { id: true, status: true } })
  if (deps.length !== new Set(body.dependsOnTaskIds).size) throw new AppError(404, 'OS de que ela depende não encontrada neste processo')

  const name = await actorName(actor.id)
  const task = await prisma.$transaction(async (tx) => {
    await lockClients(tx, [board.clientId])
    const created = await insertOSTask(tx, {
      organizationId, clientId: board.clientId, boardId, columnId: column.id, model, competence,
      assigneeId: body.assigneeId, dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      released: deps.every((d) => (FINISHED as readonly string[]).includes(d.status)),
      sourceRequestId: opts.sourceRequestId, actorId: actor.id,
    }, name)
    if (deps.length > 0) await tx.taskDependency.createMany({ data: deps.map((d) => ({ taskId: created.id, dependsOnTaskId: d.id })) })
    // A process that was complete is in progress again
    await tx.board.update({ where: { id: boardId }, data: { completedAt: null } })
    return created
  })
  await afterOSCreated(task.id, organizationId, board.clientId, boardId, column.id, task.title, { id: actor.id, name })
  return prisma.task.findUniqueOrThrow({ where: { id: task.id } })
}

export type OpenProcessBody = CreateBoardBody & { competence?: string }

// Process: the board with the template columns plus one OS per template item, in its column, waiting
// for the items it depends on. Without a template it is a plain board (default columns), as before.
export async function openProcess(organizationId: string, actor: OSActor, body: OpenProcessBody, opts: { sourceRequestId?: string } = {}) {
  if (!body.processTemplateId) return createBoard(organizationId, actor.id, actor.role, body)

  const template = await prisma.processTemplate.findFirst({
    where: { id: body.processTemplateId, organizationId, isActive: true },
    include: { items: { orderBy: { position: 'asc' }, include: { osModel: { include: MODEL_INCLUDE }, dependsOn: true } } },
  })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  if (template.items.some((it) => !it.osModel.isActive)) throw new AppError(422, 'Modelo de OS inativo')
  const competence = body.competence ? competenceToDate(body.competence) : null
  if (!competence && template.items.some((it) => it.osModel.requiresCompetence)) throw new AppError(422, 'Informe a competência')

  // Every OS department must serve the client before anything is created (fails fast, no empty board)
  for (const departmentId of new Set(template.items.map((it) => it.osModel.departmentId))) {
    await assertDepartmentServesClient(prisma, body.clientId, departmentId)
  }

  const board = await createBoard(organizationId, actor.id, actor.role, body)
  try {
    await createProcessOS(board)
  } catch (err) {
    // Refused by a business rule (e.g. coverage changed meanwhile, checked again under the client
    // lock): the OS transaction rolled back, so the board goes too. Other failures keep what exists.
    if (err instanceof AppError) await prisma.board.delete({ where: { id: board.id } })
    throw err
  }
  await scheduleBoardDeadline(board.id)
  return prisma.board.findUniqueOrThrow({
    where: { id: board.id },
    include: { client: { select: { id: true, name: true, codigo: true } }, columns: { orderBy: { position: 'asc' } } },
  })

  async function createProcessOS(board: Awaited<ReturnType<typeof createBoard>>) {
  if (!template) return
  await prisma.board.update({ where: { id: board.id }, data: { deadlineBusinessDays: template.deadlineBusinessDays, competence } })
  if (template.items.length > 0) {
    const columnsByPosition = new Map(board.columns.map((c) => [c.position, c.id]))
    const name = await actorName(actor.id)
    const created = await prisma.$transaction(async (tx) => {
      await lockClients(tx, [board.clientId])
      const byItem = new Map<string, { id: string; title: string; columnId: string }>()
      for (const item of template.items) {
        const columnId = columnsByPosition.get(item.columnPosition) ?? board.columns[0].id
        const task = await insertOSTask(tx, {
          organizationId, clientId: board.clientId, boardId: board.id, columnId, model: item.osModel,
          competence: item.osModel.requiresCompetence ? competence : null,
          released: item.dependsOn.length === 0, sourceRequestId: opts.sourceRequestId, actorId: actor.id,
        }, name)
        byItem.set(item.id, { id: task.id, title: task.title, columnId })
      }
      const deps = template.items.flatMap((item) => item.dependsOn.map((d) => ({ taskId: byItem.get(item.id)!.id, dependsOnTaskId: byItem.get(d.dependsOnItemId)!.id })))
      if (deps.length > 0) await tx.taskDependency.createMany({ data: deps })
      return [...byItem.values()]
    })
    for (const t of created) await afterOSCreated(t.id, organizationId, board.clientId, board.id, t.columnId, t.title, { id: actor.id, name })
  }
  }
}
