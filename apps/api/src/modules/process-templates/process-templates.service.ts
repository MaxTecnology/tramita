import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateProcessTemplateBody, UpdateProcessTemplateBody } from './process-templates.schema'

const INCLUDE = {
  columns: {
    orderBy: { position: 'asc' as const },
    include: { documents: { orderBy: { position: 'asc' as const } } },
  },
}

export async function listProcessTemplates(organizationId: string) {
  return prisma.processTemplate.findMany({ where: { organizationId }, include: INCLUDE, orderBy: { name: 'asc' } })
}

export async function getProcessTemplateById(id: string, organizationId: string) {
  const template = await prisma.processTemplate.findFirst({ where: { id, organizationId }, include: INCLUDE })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  return template
}

// The department evaluates client requests for the process: it must be of the office, and a
// requestable process must have one
async function assertTemplateDepartment(organizationId: string, departmentId: string | null | undefined, clientCanRequest: boolean) {
  if (departmentId) {
    const found = await prisma.department.count({ where: { id: departmentId, organizationId } })
    if (!found) throw new AppError(404, 'Departamento não encontrado')
  }
  if (clientCanRequest && !departmentId) {
    throw new AppError(422, 'Escolha o departamento que avalia os pedidos deste processo')
  }
}

export async function createProcessTemplate(organizationId: string, data: CreateProcessTemplateBody) {
  await assertTemplateDepartment(organizationId, data.departmentId, data.clientCanRequest ?? false)
  return prisma.processTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive,
      departmentId: data.departmentId ?? null,
      deadlineBusinessDays: data.deadlineBusinessDays ?? null,
      clientCanRequest: data.clientCanRequest ?? false,
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

export async function updateProcessTemplate(id: string, organizationId: string, data: UpdateProcessTemplateBody) {
  const template = await prisma.processTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  await assertTemplateDepartment(
    organizationId,
    data.departmentId === undefined ? template.departmentId : data.departmentId,
    data.clientCanRequest ?? template.clientCanRequest,
  )

  return prisma.$transaction(async (tx) => {
    await tx.processTemplate.update({
      where: { id },
      data: {
        name: data.name, description: data.description, isActive: data.isActive,
        departmentId: data.departmentId, deadlineBusinessDays: data.deadlineBusinessDays, clientCanRequest: data.clientCanRequest,
      },
    })

    if (data.columns) {
      // Substitui a lista inteira de colunas — mesmo padrão já usado em ClientUserAccess/accesses:
      // mais simples que diff incremental, e um Template de OS já existente (com boards criados a
      // partir dele) não é afetado retroativamente, porque a cópia pros boards reais acontece só
      // no momento da criação (Task 3), nunca por referência.
      await tx.processTemplateColumn.deleteMany({ where: { templateId: id } })
      for (const [i, col] of data.columns.entries()) {
        await tx.processTemplateColumn.create({
          data: {
            templateId: id, title: col.title, position: i, statusEffect: col.statusEffect, notifyClient: col.notifyClient,
            documents: { create: col.documents.map((d, j) => ({ name: d.name, position: j })) },
          },
        })
      }
    }

    return tx.processTemplate.findUniqueOrThrow({ where: { id }, include: INCLUDE })
  })
}

export async function deleteProcessTemplate(id: string, organizationId: string) {
  const template = await prisma.processTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  return prisma.processTemplate.update({ where: { id }, data: { isActive: false } })
}
