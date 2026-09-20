import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '@/modules/departments/departments.service'
import {
  createTestPlan,
  createTestOrg,
  createTestClient,
  createTestUser,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'

describe('createDepartment', () => {
  it('creates a department for the organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await createDepartment(org.id, { name: 'Fiscal' })

    expect(result.name).toBe('Fiscal')
    expect(result.organizationId).toBe(org.id)
  })

  it('throws 409 when name is already used in the same organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })

    await expect(createDepartment(org.id, { name: 'Fiscal' })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it('allows the same name across different organizations', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    await prisma.department.create({ data: { name: 'Fiscal', organizationId: orgA.id } })

    const result = await createDepartment(orgB.id, { name: 'Fiscal' })

    expect(result.name).toBe('Fiscal')
    expect(result.organizationId).toBe(orgB.id)
  })
})

describe('updateDepartment', () => {
  it('renames the department', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })

    const result = await updateDepartment(department.id, org.id, { name: 'Folha de Pagamento' })

    expect(result.name).toBe('Folha de Pagamento')
  })

  it('throws 404 when department belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: orgA.id } })

    await expect(
      updateDepartment(department.id, orgB.id, { name: 'Outro Nome' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 409 when renaming to a name already used in the same organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })
    const department = await prisma.department.create({ data: { name: 'Folha', organizationId: org.id } })

    await expect(updateDepartment(department.id, org.id, { name: 'Fiscal' })).rejects.toMatchObject({
      statusCode: 409,
    })
  })
})

describe('deleteDepartment', () => {
  it('removes a department without assignments', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })

    const result = await deleteDepartment(department.id, org.id)

    expect(result.ok).toBe(true)
    const stored = await prisma.department.findUnique({ where: { id: department.id } })
    expect(stored).toBeNull()
  })

  it('throws 409 when the department has a client assignment', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })
    const client = await createTestClient(org.id)
    const user = await createTestUser(org.id)
    await prisma.clientAssignment.create({
      data: { clientId: client.id, departmentId: department.id, userId: user.id },
    })

    await expect(deleteDepartment(department.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 404 when department belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: orgA.id } })

    await expect(deleteDepartment(department.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 409 when the department is referenced by a task', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    await createTestTask(column.id, user.id)
    await prisma.task.updateMany({ where: { columnId: column.id }, data: { departmentId: department.id } })

    await expect(deleteDepartment(department.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 409 when the department is referenced by a request', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await prisma.department.create({ data: { name: 'Fiscal', organizationId: org.id } })
    const client = await createTestClient(org.id)
    await prisma.request.create({
      data: { organizationId: org.id, clientId: client.id, title: 'Pedido', departmentId: department.id },
    })

    await expect(deleteDepartment(department.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })
})
