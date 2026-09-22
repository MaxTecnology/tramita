import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateOSTemplateBody, UpdateOSTemplateBody } from './os-templates.schema'

const INCLUDE = {
  columns: {
    orderBy: { position: 'asc' as const },
    include: { documents: { orderBy: { position: 'asc' as const } } },
  },
}

export async function listOSTemplates(organizationId: string) {
  return prisma.oSTemplate.findMany({ where: { organizationId }, include: INCLUDE, orderBy: { name: 'asc' } })
}

export async function getOSTemplateById(id: string, organizationId: string) {
  const template = await prisma.oSTemplate.findFirst({ where: { id, organizationId }, include: INCLUDE })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')
  return template
}

export async function createOSTemplate(organizationId: string, data: CreateOSTemplateBody) {
  return prisma.oSTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive,
      organizationId,
      columns: {
        create: data.columns.map((col, i) => ({
          title: col.title,
          position: i,
          statusEffect: col.statusEffect,
          notifyClient: col.notifyClient,
          documents: { create: col.documents.map((d, j) => ({ name: d.name, position: j })) },
        })),
      },
    },
    include: INCLUDE,
  })
}

export async function updateOSTemplate(id: string, organizationId: string, data: UpdateOSTemplateBody) {
  const template = await prisma.oSTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')

  return prisma.$transaction(async (tx) => {
    await tx.oSTemplate.update({
      where: { id },
      data: { name: data.name, description: data.description, isActive: data.isActive },
    })

    if (data.columns) {
      // Substitui a lista inteira de colunas — mesmo padrão já usado em ClientUserAccess/accesses:
      // mais simples que diff incremental, e um Template de OS já existente (com boards criados a
      // partir dele) não é afetado retroativamente, porque a cópia pros boards reais acontece só
      // no momento da criação (Task 3), nunca por referência.
      await tx.oSTemplateColumn.deleteMany({ where: { templateId: id } })
      for (const [i, col] of data.columns.entries()) {
        await tx.oSTemplateColumn.create({
          data: {
            templateId: id, title: col.title, position: i, statusEffect: col.statusEffect, notifyClient: col.notifyClient,
            documents: { create: col.documents.map((d, j) => ({ name: d.name, position: j })) },
          },
        })
      }
    }

    return tx.oSTemplate.findUniqueOrThrow({ where: { id }, include: INCLUDE })
  })
}

export async function deleteOSTemplate(id: string, organizationId: string) {
  const template = await prisma.oSTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')
  return prisma.oSTemplate.update({ where: { id }, data: { isActive: false } })
}
