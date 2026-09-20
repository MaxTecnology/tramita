import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateDepartmentInput, UpdateDepartmentInput } from './departments.schema'

export async function listDepartments(organizationId: string) {
  return prisma.department.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  })
}

export async function createDepartment(organizationId: string, data: CreateDepartmentInput) {
  const existing = await prisma.department.findFirst({
    where: { organizationId, name: data.name },
  })
  if (existing) throw new AppError(409, 'Já existe um departamento com esse nome')

  return prisma.department.create({ data: { ...data, organizationId } })
}

export async function updateDepartment(
  id: string,
  organizationId: string,
  data: UpdateDepartmentInput,
) {
  const department = await prisma.department.findFirst({ where: { id, organizationId } })
  if (!department) throw new AppError(404, 'Departamento não encontrado')

  if (data.name) {
    const existing = await prisma.department.findFirst({
      where: { organizationId, name: data.name, id: { not: id } },
    })
    if (existing) throw new AppError(409, 'Já existe um departamento com esse nome')
  }

  return prisma.department.update({ where: { id }, data })
}

export async function deleteDepartment(id: string, organizationId: string) {
  const department = await prisma.department.findFirst({ where: { id, organizationId } })
  if (!department) throw new AppError(404, 'Departamento não encontrado')

  const assignmentsCount = await prisma.clientAssignment.count({ where: { departmentId: id } })
  if (assignmentsCount > 0) {
    throw new AppError(409, 'Departamento em uso — remova as atribuições de responsável antes de excluir')
  }

  await prisma.department.delete({ where: { id } })
  return { ok: true }
}
