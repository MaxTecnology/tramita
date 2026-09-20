import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createClient,
  updateClient,
  deleteClient,
  listAssignments,
  setAssignment,
} from '@/modules/clients/clients.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestDepartment,
} from '@/test/helpers'

describe('createClient', () => {
  it('creates a client with hashed password, scoped to the organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await createClient(org.id, {
      name: 'Cliente Novo',
      clientType: 'PJ',
      email: `cliente-${Date.now()}@test.com`,
      password: 'Senha@1234',
    })

    expect(result.clientType).toBe('PJ')
    const stored = await prisma.client.findUnique({ where: { id: result.id } })
    expect(stored?.organizationId).toBe(org.id)
    expect(stored?.passwordHash).not.toBe('Senha@1234')
  })

  it('throws 409 when email is already registered in the same organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `dup-${Date.now()}@test.com`
    await createTestClient(org.id, { email })

    await expect(
      createClient(org.id, { name: 'Outro', clientType: 'PJ', email, password: 'Senha@1234' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('allows the same email across different organizations', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const email = `shared-${Date.now()}@test.com`
    await createTestClient(orgA.id, { email })

    const result = await createClient(orgB.id, {
      name: 'Cliente B', clientType: 'PJ', email, password: 'Senha@1234',
    })

    expect(result.email).toBe(email)
  })
})

describe('updateClient', () => {
  it('updates notes for a client in the same organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    const result = await updateClient(client.id, org.id, { notes: 'Observação atualizada' })

    expect(result.notes).toBe('Observação atualizada')
  })

  it('throws 404 when client belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)

    await expect(updateClient(client.id, orgB.id, { notes: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteClient', () => {
  it('soft-deletes by setting isActive to false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    await deleteClient(client.id, org.id)

    const stored = await prisma.client.findUnique({ where: { id: client.id } })
    expect(stored).not.toBeNull()
    expect(stored?.isActive).toBe(false)
  })

  it('throws 404 when client belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)

    await expect(deleteClient(client.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('setAssignment / listAssignments', () => {
  it('assigns a user to a client department and lists it back', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const user = await createTestUser(org.id)

    const result = await setAssignment(client.id, org.id, department.id, user.id)

    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe(user.id)
    expect(result[0].departmentId).toBe(department.id)

    const listed = await listAssignments(client.id, org.id)
    expect(listed).toHaveLength(1)
  })

  it('replaces the previous assignment for the same department instead of appending', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const userA = await createTestUser(org.id, { email: `a-${Date.now()}@test.com` })
    const userB = await createTestUser(org.id, { email: `b-${Date.now()}@test.com` })

    await setAssignment(client.id, org.id, department.id, userA.id)
    const result = await setAssignment(client.id, org.id, department.id, userB.id)

    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe(userB.id)
  })

  it('keeps assignments across different departments independent', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const departmentA = await createTestDepartment(org.id, { name: `Dept A ${Date.now()}` })
    const departmentB = await createTestDepartment(org.id, { name: `Dept B ${Date.now()}` })
    const userA = await createTestUser(org.id, { email: `a-${Date.now()}@test.com` })
    const userB = await createTestUser(org.id, { email: `b-${Date.now()}@test.com` })

    await setAssignment(client.id, org.id, departmentA.id, userA.id)
    const result = await setAssignment(client.id, org.id, departmentB.id, userB.id)

    expect(result).toHaveLength(2)
  })

  it('clears the assignment for a department when userId is null', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const user = await createTestUser(org.id)
    await setAssignment(client.id, org.id, department.id, user.id)

    const result = await setAssignment(client.id, org.id, department.id, null)

    expect(result).toHaveLength(0)
  })

  it('throws 400 when userId does not belong to the organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)
    const department = await createTestDepartment(orgA.id)
    const foreignUser = await createTestUser(orgB.id)

    await expect(
      setAssignment(client.id, orgA.id, department.id, foreignUser.id),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 404 when departmentId does not belong to the organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)
    const user = await createTestUser(orgA.id)
    const foreignDepartment = await createTestDepartment(orgB.id)

    await expect(
      setAssignment(client.id, orgA.id, foreignDepartment.id, user.id),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when client belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)

    await expect(listAssignments(client.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})
