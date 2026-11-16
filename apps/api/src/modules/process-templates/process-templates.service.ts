import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateProcessTemplateBody, UpdateProcessTemplateBody } from './process-templates.schema'

const INCLUDE = {
  columns: {
    orderBy: { position: 'asc' as const },
    include: { documents: { orderBy: { position: 'asc' as const } } },
  },
  items: {
    orderBy: { position: 'asc' as const },
    include: { osModel: { select: { id: true, name: true } }, dependsOn: { select: { dependsOnItemId: true } } },
  },
} satisfies Prisma.ProcessTemplateInclude

type TemplateRow = Prisma.ProcessTemplateGetPayload<{ include: typeof INCLUDE }>
type ItemInput = { osModelId: string; columnIndex: number; dependsOn: number[] }

// Items go out with their dependencies as indexes in the same list (what the form edits)
function present(template: TemplateRow) {
  const index = new Map(template.items.map((it, i) => [it.id, i]))
  return {
    ...template,
    items: template.items.map((it) => ({
      id: it.id, osModelId: it.osModelId, osModel: it.osModel, columnPosition: it.columnPosition, position: it.position,
      dependsOn: it.dependsOn.map((d) => index.get(d.dependsOnItemId)).filter((v): v is number => v !== undefined).sort((a, b) => a - b),
    })),
  }
}

// Every model must be an active "inside processes" OS of the office, every column index must exist,
// and dependencies cannot loop (A waits B waits A would never start)
async function assertItems(organizationId: string, items: ItemInput[], columnCount: number) {
  const ids = [...new Set(items.map((i) => i.osModelId))]
  const models = await prisma.oSModel.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, usableInProcess: true, isActive: true } })
  if (models.length !== ids.length) throw new AppError(404, 'Modelo de OS não encontrado')
  if (models.some((m) => !m.usableInProcess || !m.isActive)) throw new AppError(422, 'Essa OS não é usada em processos')
  items.forEach((it, i) => {
    if (it.columnIndex >= columnCount) throw new AppError(422, 'Coluna da OS não existe no modelo')
    if (it.dependsOn.some((d) => d >= items.length || d === i)) throw new AppError(422, 'Dependência inválida entre OS')
  })
  const state = new Array<0 | 1 | 2>(items.length).fill(0) // 0 new, 1 visiting, 2 done
  const visit = (i: number): void => {
    if (state[i] === 2) return
    if (state[i] === 1) throw new AppError(422, 'Dependência circular entre OS')
    state[i] = 1
    items[i].dependsOn.forEach(visit)
    state[i] = 2
  }
  items.forEach((_, i) => visit(i))
}

async function replaceItems(tx: Prisma.TransactionClient, templateId: string, items: ItemInput[]) {
  await tx.processTemplateItem.deleteMany({ where: { templateId } })
  const created: { id: string }[] = []
  for (const [i, it] of items.entries()) {
    created.push(await tx.processTemplateItem.create({ data: { templateId, osModelId: it.osModelId, columnPosition: it.columnIndex, position: i } }))
  }
  const deps = items.flatMap((it, i) => it.dependsOn.map((d) => ({ itemId: created[i].id, dependsOnItemId: created[d].id })))
  if (deps.length > 0) await tx.processTemplateItemDependency.createMany({ data: deps })
}

export async function listProcessTemplates(organizationId: string) {
  const rows = await prisma.processTemplate.findMany({ where: { organizationId }, include: INCLUDE, orderBy: { name: 'asc' } })
  return rows.map(present)
}

export async function getProcessTemplateById(id: string, organizationId: string) {
  const template = await prisma.processTemplate.findFirst({ where: { id, organizationId }, include: INCLUDE })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  return present(template)
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
  const items = data.items ?? []
  await assertItems(organizationId, items, data.columns.length)
  const created = await prisma.processTemplate.create({
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
  if (items.length === 0) return present(created)
  await prisma.$transaction((tx) => replaceItems(tx, created.id, items))
  return getProcessTemplateById(created.id, organizationId)
}

export async function updateProcessTemplate(id: string, organizationId: string, data: UpdateProcessTemplateBody) {
  const template = await prisma.processTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  await assertTemplateDepartment(
    organizationId,
    data.departmentId === undefined ? template.departmentId : data.departmentId,
    data.clientCanRequest ?? template.clientCanRequest,
  )
  if (data.items) {
    const columnCount = data.columns?.length ?? await prisma.processTemplateColumn.count({ where: { templateId: id } })
    await assertItems(organizationId, data.items, columnCount)
  }

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
    if (data.items) await replaceItems(tx, id, data.items)

    return present(await tx.processTemplate.findUniqueOrThrow({ where: { id }, include: INCLUDE }))
  })
}

export async function deleteProcessTemplate(id: string, organizationId: string) {
  const template = await prisma.processTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Modelo de processo não encontrado')
  return prisma.processTemplate.update({ where: { id }, data: { isActive: false } })
}
