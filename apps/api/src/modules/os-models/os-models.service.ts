import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { assertDeliveryObligations } from '@/modules/recurring-templates/recurring-templates.service'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import type { CreateOSModelBody, UpdateOSModelBody } from './os-models.schema'

const INCLUDE = {
  documentRequests: { orderBy: { position: 'asc' as const } },
  documentDeliveries: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.OSModelInclude

type Rules = Pick<CreateOSModelBody, 'usableStandalone' | 'usableInProcess' | 'requiresCompetence' | 'documentDeliveries'>

// An OS is used somewhere; the robot matches by client + obligation + competence, so a model with a
// robot delivery must ask for the competence
function assertModelRules(m: Rules) {
  if (!m.usableStandalone && !m.usableInProcess) throw new AppError(422, 'Marque onde essa OS é usada')
  if (m.documentDeliveries.some((d) => d.obligationTypeId) && !m.requiresCompetence) {
    throw new AppError(422, 'OS com robô precisa pedir competência')
  }
}

const documentRows = (items: { name: string; requiresPayment?: boolean; obligationTypeId?: string | null }[]) =>
  items.map((d, i) => ({ name: d.name, position: i, requiresPayment: d.requiresPayment ?? false, obligationTypeId: d.obligationTypeId ?? null }))

export async function listOSModels(organizationId: string, usage?: 'standalone' | 'process') {
  return prisma.oSModel.findMany({
    where: {
      organizationId,
      ...(usage === 'standalone' ? { isActive: true, usableStandalone: true } : {}),
      ...(usage === 'process' ? { isActive: true, usableInProcess: true } : {}),
    },
    include: INCLUDE,
    orderBy: { name: 'asc' },
  })
}

export async function getOSModelForOrg(id: string, organizationId: string) {
  const model = await prisma.oSModel.findFirst({ where: { id, organizationId }, include: INCLUDE })
  if (!model) throw new AppError(404, 'Modelo de OS não encontrado')
  return model
}

export async function createOSModel(organizationId: string, data: CreateOSModelBody) {
  await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  await assertDeliveryObligations(data.documentDeliveries, organizationId)
  assertModelRules(data)
  const { documentRequests, documentDeliveries, ...fields } = data
  return prisma.oSModel.create({
    data: {
      ...fields,
      organizationId,
      documentRequests: { create: documentRows(documentRequests) },
      documentDeliveries: { create: documentRows(documentDeliveries) },
    },
    include: INCLUDE,
  })
}

export async function updateOSModel(id: string, organizationId: string, data: UpdateOSModelBody) {
  const current = await getOSModelForOrg(id, organizationId)
  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  if (data.documentDeliveries) await assertDeliveryObligations(data.documentDeliveries, organizationId)
  assertModelRules({
    usableStandalone: data.usableStandalone ?? current.usableStandalone,
    usableInProcess: data.usableInProcess ?? current.usableInProcess,
    requiresCompetence: data.requiresCompetence ?? current.requiresCompetence,
    documentDeliveries: data.documentDeliveries ?? current.documentDeliveries,
  })
  const { documentRequests, documentDeliveries, ...fields } = data
  // Lists are replaced whole; OS already opened keep their own copy (copied at creation)
  return prisma.$transaction(async (tx) => {
    await tx.oSModel.update({ where: { id }, data: fields })
    if (documentRequests) {
      await tx.oSModelDocument.deleteMany({ where: { requestModelId: id } })
      await tx.oSModelDocument.createMany({ data: documentRows(documentRequests).map((r) => ({ ...r, requestModelId: id })) })
    }
    if (documentDeliveries) {
      await tx.oSModelDocument.deleteMany({ where: { deliveryModelId: id } })
      await tx.oSModelDocument.createMany({ data: documentRows(documentDeliveries).map((r) => ({ ...r, deliveryModelId: id })) })
    }
    return tx.oSModel.findUniqueOrThrow({ where: { id }, include: INCLUDE })
  })
}

export async function deleteOSModel(id: string, organizationId: string) {
  await getOSModelForOrg(id, organizationId)
  await prisma.oSModel.delete({ where: { id } })
  return { id }
}
