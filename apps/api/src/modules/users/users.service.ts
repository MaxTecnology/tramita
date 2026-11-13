import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword, generateRandomPassword } from '@/modules/auth/auth.service'
import type { CreateUserBody, UpdateUserBody, UpdateMyProfileBody } from './users.schema'

const SELECT = {
  id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true,
  seesDepartmentWork: true,
  departments: { select: { department: { select: { id: true, name: true } } }, orderBy: { department: { name: 'asc' } } },
} satisfies Prisma.UserSelect

type UserRow = Prisma.UserGetPayload<{ select: typeof SELECT }>

// API shape: departments as a flat { id, name } list
function present(user: UserRow) {
  const { departments, ...rest } = user
  return { ...rest, departments: departments.map((d) => d.department) }
}

async function assertDepartmentsOfOrg(db: Prisma.TransactionClient | typeof prisma, organizationId: string, departmentIds: string[]) {
  const unique = [...new Set(departmentIds)]
  const found = await db.department.count({ where: { id: { in: unique }, organizationId } })
  if (found !== unique.length) throw new AppError(400, 'Departamento inválido')
  return unique
}

export async function listUsers(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: SELECT,
    orderBy: { createdAt: 'asc' },
  })
  return users.map(present)
}

export async function listUserOptions(organizationId: string, departmentId?: string): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: {
      organizationId,
      isActive: true,
      // Responsible pickers: only who belongs to the department (admins are exempt)
      ...(departmentId ? { OR: [{ role: 'ORG_ADMIN' }, { departments: { some: { departmentId } } }] } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export async function createUser(organizationId: string, data: CreateUserBody) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')
  if (!data.departmentIds?.length) throw new AppError(400, 'Selecione pelo menos um departamento')
  const departmentIds = await assertDepartmentsOfOrg(prisma, organizationId, data.departmentIds)

  return present(await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      role: data.role,
      phone: data.phone,
      seesDepartmentWork: data.seesDepartmentWork ?? true,
      organizationId,
      departments: { create: departmentIds.map((departmentId) => ({ departmentId })) },
    },
    select: SELECT,
  }))
}

export async function updateUser(id: string, organizationId: string, data: UpdateUserBody) {
  const user = await prisma.user.findFirst({ where: { id, organizationId, isActive: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')
  const { departmentIds, ...fields } = data

  return present(await prisma.$transaction(async (tx) => {
    if (departmentIds) {
      const next = await assertDepartmentsOfOrg(tx, organizationId, departmentIds)
      // Same exclusive lock as deactivation: nobody makes them responsible in a department being removed
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`
      const removed = await tx.userDepartment.findMany({
        where: { userId: id, departmentId: { notIn: next } },
        select: { departmentId: true, department: { select: { name: true } } },
      })
      for (const r of removed) {
        const responsible = await tx.clientAssignment.count({ where: { userId: id, departmentId: r.departmentId, client: { isActive: true } } })
        if (responsible > 0) {
          throw new AppError(409, `Transfira as responsabilidades antes de tirar ${user.name} do departamento ${r.department.name}`)
        }
      }
      await tx.userDepartment.deleteMany({ where: { userId: id, departmentId: { notIn: next } } })
      await tx.userDepartment.createMany({ data: next.map((departmentId) => ({ userId: id, departmentId })), skipDuplicates: true })
    }
    return tx.user.update({ where: { id }, data: fields, select: SELECT })
  }))
}

export async function deleteUser(id: string, organizationId: string) {
  const user = await prisma.user.findFirst({ where: { id, organizationId, isActive: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  return prisma.$transaction(async (tx) => {
    // Exclusive lock on this user: a client form or transfer making them responsible right now
    // (lockUsersForShare) finishes first and is counted below, or waits and sees them inactive.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`
    // I2: todo departamento que atende um cliente ativo precisa ter responsável ativo.
    const responsibilities = await tx.clientAssignment.count({ where: { userId: id, client: { isActive: true } } })
    if (responsibilities > 0) {
      throw new AppError(
        409,
        `${user.name} é responsável por ${responsibilities} cliente(s)/departamento(s). Defina outro responsável antes de desativar.`,
      )
    }
    return present(await tx.user.update({ where: { id }, data: { isActive: false }, select: SELECT }))
  })
}

export async function getMyProfile(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: SELECT })
  if (!user) throw new AppError(404, 'Usuário não encontrado')
  return present(user)
}

export async function updateMyProfile(id: string, data: UpdateMyProfileBody) {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')
  return present(await prisma.user.update({ where: { id }, data, select: SELECT }))
}

export async function resetUserPassword(id: string, organizationId?: string) {
  const user = await prisma.user.findFirst({
    where: {
      id,
      isActive: true,
      ...(organizationId
        ? { organizationId, role: { in: ['ORG_MANAGER', 'ORG_MEMBER'] } }
        : {}),
    },
  })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  const temporaryPassword = generateRandomPassword()
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(temporaryPassword) },
  })
  return { id: user.id, name: user.name, email: user.email, temporaryPassword }
}
