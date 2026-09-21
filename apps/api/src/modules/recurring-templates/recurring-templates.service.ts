import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
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
