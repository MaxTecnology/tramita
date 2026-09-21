import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import type { CreateTemplateBody, UpdateTemplateBody } from './recurring-templates.schema'

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
