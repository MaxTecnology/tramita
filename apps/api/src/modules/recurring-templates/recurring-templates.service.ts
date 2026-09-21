import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import { Prisma, type MessageChannel } from '@prisma/client'
import { enqueueNotification } from '@/lib/queue'
import { logger } from '@/lib/logger'
import {
  computeDueDate,
  computeTargetDate,
  computeCurrentPeriodStart,
  type RecurrenceDateRules,
} from './recurrence-dates'
import type {
  CreateTemplateBody,
  UpdateTemplateBody,
  CreateAssignmentBody,
  UpdateAssignmentBody,
} from './recurring-templates.schema'

function assertDayOfPeriodValid(periodicity: string, dueDayOfPeriod: number, generationDayOfPeriod: number) {
  if (periodicity === 'WEEKLY') {
    if (dueDayOfPeriod > 7) {
      throw new AppError(400, 'Periodicidade semanal: dia do vencimento deve ser de 1 (segunda) a 7 (domingo)')
    }
  }
  if (generationDayOfPeriod > 31 || generationDayOfPeriod < 1) {
    throw new AppError(400, 'Dia de geração deve ser de 1 a 31')
  }
}

export async function listTemplates(organizationId: string) {
  return prisma.recurringTaskTemplate.findMany({
    where: { organizationId },
    include: { department: { select: { id: true, name: true } }, documentRequests: true, documentDeliveries: true },
    orderBy: { title: 'asc' },
  })
}

export async function getTemplateById(id: string, organizationId: string) {
  const template = await prisma.recurringTaskTemplate.findFirst({
    where: { id, organizationId },
    include: { department: { select: { id: true, name: true } }, documentRequests: true, documentDeliveries: true },
  })
  if (!template) throw new AppError(404, 'Template não encontrado')
  return template
}

export async function createTemplate(organizationId: string, data: CreateTemplateBody) {
  await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  assertDayOfPeriodValid(data.periodicity, data.dueDayOfPeriod, data.generationDayOfPeriod)

  const { documentRequests, documentDeliveries, ...templateData } = data

  return prisma.recurringTaskTemplate.create({
    data: {
      ...templateData,
      organizationId,
      documentRequests: { create: documentRequests.map((d, i) => ({ name: d.name, position: i })) },
      documentDeliveries: { create: documentDeliveries.map((d, i) => ({ name: d.name, position: i })) },
    },
    include: { documentRequests: true, documentDeliveries: true },
  })
}

export async function updateTemplate(id: string, organizationId: string, data: UpdateTemplateBody) {
  const existing = await getTemplateById(id, organizationId)

  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  assertDayOfPeriodValid(
    data.periodicity ?? existing.periodicity,
    data.dueDayOfPeriod ?? existing.dueDayOfPeriod,
    data.generationDayOfPeriod ?? existing.generationDayOfPeriod,
  )

  const { documentRequests, documentDeliveries, ...templateData } = data

  return prisma.$transaction(async (tx) => {
    if (documentRequests) {
      await tx.recurringTaskTemplateDocument.deleteMany({ where: { requestTemplateId: id } })
      await tx.recurringTaskTemplateDocument.createMany({
        data: documentRequests.map((d, i) => ({ requestTemplateId: id, name: d.name, position: i })),
      })
    }
    if (documentDeliveries) {
      await tx.recurringTaskTemplateDocument.deleteMany({ where: { deliveryTemplateId: id } })
      await tx.recurringTaskTemplateDocument.createMany({
        data: documentDeliveries.map((d, i) => ({ deliveryTemplateId: id, name: d.name, position: i })),
      })
    }
    return tx.recurringTaskTemplate.update({
      where: { id },
      data: templateData,
      include: { documentRequests: true, documentDeliveries: true },
    })
  })
}

export async function deleteTemplate(id: string, organizationId: string) {
  await getTemplateById(id, organizationId)

  const assignmentsCount = await prisma.recurringTaskAssignment.count({ where: { templateId: id } })
  if (assignmentsCount > 0) {
    throw new AppError(409, 'Template em uso — remova os vínculos de cliente antes de excluir')
  }

  await prisma.recurringTaskTemplate.delete({ where: { id } })
  return { ok: true }
}

async function assertClientBoardColumnBelongToOrg(
  organizationId: string,
  clientId: string,
  boardId: string,
  columnId: string,
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId, clientId } })
  if (!board) throw new AppError(404, 'Processo não encontrado para este cliente')

  const column = await prisma.column.findFirst({ where: { id: columnId, boardId } })
  if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
}

export async function listAssignments(templateId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringTaskAssignment.findMany({
    where: { templateId },
    include: { client: { select: { id: true, name: true } }, board: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createAssignment(templateId: string, organizationId: string, data: CreateAssignmentBody) {
  await getTemplateById(templateId, organizationId)
  await assertClientBoardColumnBelongToOrg(organizationId, data.clientId, data.boardId, data.columnId)

  const existing = await prisma.recurringTaskAssignment.findFirst({
    where: { templateId, clientId: data.clientId },
  })
  if (existing) throw new AppError(409, 'Este cliente já está vinculado a este template')

  return prisma.recurringTaskAssignment.create({ data: { templateId, ...data } })
}

async function getAssignmentOrThrow(templateId: string, assignmentId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  const assignment = await prisma.recurringTaskAssignment.findFirst({
    where: { id: assignmentId, templateId },
  })
  if (!assignment) throw new AppError(404, 'Vínculo não encontrado')
  return assignment
}

export async function updateAssignment(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  data: UpdateAssignmentBody,
) {
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  if (data.boardId || data.columnId) {
    await assertClientBoardColumnBelongToOrg(
      organizationId,
      assignment.clientId,
      data.boardId ?? assignment.boardId,
      data.columnId ?? assignment.columnId,
    )
  }

  return prisma.recurringTaskAssignment.update({ where: { id: assignmentId }, data })
}

export async function deleteAssignment(templateId: string, assignmentId: string, organizationId: string) {
  await getAssignmentOrThrow(templateId, assignmentId, organizationId)
  await prisma.recurringTaskAssignment.delete({ where: { id: assignmentId } })
  return { ok: true }
}

export type GenerationOutcome =
  | { status: 'SUCCESS'; taskId: string }
  | { status: 'ALREADY_EXISTS' }
  | { status: 'FAILED'; errorMessage: string }

function isDuplicateGenerationLogError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes('templateId')
  )
}

export async function generateTaskForAssignment(
  templateId: string,
  assignmentId: string,
  competence: Date,
): Promise<GenerationOutcome> {
  const template = await prisma.recurringTaskTemplate.findUnique({
    where: { id: templateId },
    include: { documentRequests: true, documentDeliveries: true },
  })
  if (!template) return { status: 'FAILED', errorMessage: 'Template não encontrado' }

  const assignment = await prisma.recurringTaskAssignment.findUnique({ where: { id: assignmentId } })
  if (!assignment || assignment.templateId !== templateId) {
    return { status: 'FAILED', errorMessage: 'Vínculo não encontrado' }
  }

  const logKey = {
    templateId_clientId_competence: { templateId, clientId: assignment.clientId, competence },
  }
  const existingLog = await prisma.recurringGenerationLog.findUnique({ where: logKey })
  if (existingLog?.status === 'SUCCESS') return { status: 'ALREADY_EXISTS' }

  try {
    const column = await prisma.column.findUnique({ where: { id: assignment.columnId } })
    if (!column) throw new Error('Coluna do vínculo não existe mais')

    const rules: RecurrenceDateRules = template
    const dueDate = computeDueDate(competence, rules)
    const targetDate = computeTargetDate(dueDate, rules)
    const initialStatus = template.documentRequests.length > 0 ? 'BLOCKED' : 'OPEN'

    const taskId = await prisma.$transaction(async (tx) => {
      const position = await tx.task.count({ where: { columnId: assignment.columnId } })

      const task = await tx.task.create({
        data: {
          title: template.title,
          description: template.description,
          priority: 'MEDIUM',
          status: initialStatus,
          columnId: assignment.columnId,
          departmentId: template.departmentId,
          competence,
          dueDate,
          targetDate,
          recurringTemplateId: template.id,
          visibleToClient: template.visibleToClient,
          position,
          tags: [],
        },
      })

      if (template.documentRequests.length > 0) {
        await tx.taskDocumentRequirement.createMany({
          data: template.documentRequests.map((d, i) => ({ taskId: task.id, name: d.name, position: i })),
        })
      }
      if (template.documentDeliveries.length > 0) {
        await tx.taskDeliverable.createMany({
          data: template.documentDeliveries.map((d, i) => ({ taskId: task.id, name: d.name, position: i })),
        })
      }

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'created',
          toValue: task.title,
          actorType: 'system',
          actorId: 'system',
          actorName: 'Sistema (recorrência)',
        },
      })

      // Reserva a chave de idempotência por último, dentro da mesma transação: se outra
      // execução concorrente já reservou essa combinação (templateId, clientId, competence)
      // entre a checagem acima e aqui, o unique constraint derruba a transação inteira —
      // a Task recém-criada é revertida junto, nada fica duplicado no banco.
      if (existingLog) {
        await tx.recurringGenerationLog.update({
          where: logKey,
          data: { status: 'SUCCESS', taskId: task.id, errorMessage: null },
        })
      } else {
        await tx.recurringGenerationLog.create({
          data: { templateId, clientId: assignment.clientId, competence, status: 'SUCCESS', taskId: task.id },
        })
      }

      return task.id
    })

    if (template.notifyViaWhatsapp || template.notifyViaEmail) {
      const channels: MessageChannel[] = []
      if (template.notifyViaWhatsapp) channels.push('WHATSAPP')
      if (template.notifyViaEmail) channels.push('EMAIL')
      // Best-effort: a Task e o log SUCCESS já foram commitados na transação acima. Uma falha
      // aqui (ex.: blip de conectividade com o Redis) é só um problema de notificação — nunca
      // pode ser tratada pelo catch genérico abaixo, que reescreveria o log pra FAILED e reabriria
      // a chave de idempotência, permitindo uma segunda Task pra mesma competência na próxima
      // tentativa. Isolada no seu próprio try/catch: loga e segue, geração continua SUCCESS.
      try {
        await enqueueNotification({
          event: 'TASK_CREATED',
          organizationId: template.organizationId,
          clientId: assignment.clientId,
          taskId,
          channels,
          metadata: { taskTitle: template.title },
        })
      } catch (notifyErr) {
        logger.error(
          { err: notifyErr, taskId, templateId, clientId: assignment.clientId },
          'Falha ao enfileirar notificação TASK_CREATED — geração da tarefa já foi concluída com sucesso',
        )
      }
    }

    return { status: 'SUCCESS', taskId }
  } catch (err) {
    if (isDuplicateGenerationLogError(err)) {
      // Perdeu a corrida pra outra execução concorrente que gerou essa competência primeiro
      // — não é uma falha real, é o próprio mecanismo de idempotência funcionando.
      return { status: 'ALREADY_EXISTS' }
    }

    const errorMessage = err instanceof Error ? err.message : String(err)

    await prisma.recurringGenerationLog.upsert({
      where: logKey,
      create: { templateId, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage },
      update: { status: 'FAILED', errorMessage, taskId: null },
    })

    const admins = await prisma.user.findMany({
      where: { organizationId: template.organizationId, role: 'ORG_ADMIN', isActive: true },
      select: { id: true },
    })
    await Promise.all(
      admins.map((admin) =>
        enqueueNotification({
          event: 'RECURRING_GENERATION_FAILED',
          organizationId: template.organizationId,
          recipientType: 'USER',
          userId: admin.id,
          metadata: { templateTitle: template.title, errorMessage },
        }),
      ),
    )

    return { status: 'FAILED', errorMessage }
  }
}

export async function generateManually(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  competenceOverride?: string,
) {
  const template = await getTemplateById(templateId, organizationId)
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  const competence = competenceOverride
    ? new Date(competenceOverride)
    : computeCurrentPeriodStart(new Date(), template.periodicity)

  const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

  if (outcome.status === 'ALREADY_EXISTS') {
    throw new AppError(409, 'Já existe tarefa gerada pra essa competência e esse cliente')
  }
  if (outcome.status === 'FAILED') {
    throw new AppError(422, `Falha ao gerar: ${outcome.errorMessage}`)
  }
  return { taskId: outcome.taskId }
}

export async function listGenerationLog(templateId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringGenerationLog.findMany({
    where: { templateId },
    include: { template: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  })
}
