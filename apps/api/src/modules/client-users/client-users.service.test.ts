import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  listClientUsers, getClientUserById, createClientUser, updateClientUser, deleteClientUser,
} from './client-users.service'
import { createTestPlan, createTestOrg, createTestClient, createTestDepartment } from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const client = await createTestClient(org.id)
  const department = await createTestDepartment(org.id)
  return { org, client, department }
}

describe('createClientUser', () => {
  it('creates a client user with hashed password and the given accesses', async () => {
    const { org, client, department } = await setup()

    const result = await createClientUser(org.id, {
      name: 'Viviane', email: `viviane-${Date.now()}@test.com`, password: 'Senha@1234',
      isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    expect(result.accesses).toHaveLength(1)
    const stored = await prisma.clientUser.findUnique({ where: { id: result.id } })
    expect(stored?.passwordHash).not.toBe('Senha@1234')
  })

  it('throws 409 when email is already registered in the same organization', async () => {
    const { org, client, department } = await setup()
    const email = `dup-${Date.now()}@test.com`
    await createClientUser(org.id, { name: 'A', email, password: 'Senha@1234', isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }] })

    await expect(
      createClientUser(org.id, { name: 'B', email, password: 'Senha@1234', isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }] }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 404 when a client in accesses belongs to a different organization', async () => {
    const { org, department } = await setup()
    const plan2 = await createTestPlan()
    const otherOrg = await createTestOrg(plan2.id)
    const foreignClient = await createTestClient(otherOrg.id)

    await expect(
      createClientUser(org.id, {
        name: 'X', email: `x-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
        accesses: [{ clientId: foreignClient.id, departmentId: department.id }],
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateClientUser', () => {
  it('replaces the accesses list entirely when accesses is provided', async () => {
    const { org, client, department } = await setup()
    const department2 = await createTestDepartment(org.id, { name: 'Outro' })
    const created = await createClientUser(org.id, {
      name: 'C', email: `c-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    const updated = await updateClientUser(created.id, org.id, {
      accesses: [{ clientId: client.id, departmentId: department2.id }],
    })

    expect(updated.accesses).toHaveLength(1)
    expect(updated.accesses[0].departmentId).toBe(department2.id)
  })

  it('does not change the password when password is omitted', async () => {
    const { org, client, department } = await setup()
    const created = await createClientUser(org.id, {
      name: 'D', email: `d-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })
    const before = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })

    await updateClientUser(created.id, org.id, { name: 'D Editado' })

    const after = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })
})

describe('deleteClientUser', () => {
  it('soft-deletes (isActive=false) instead of removing the row', async () => {
    const { org, client, department } = await setup()
    const created = await createClientUser(org.id, {
      name: 'E', email: `e-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await deleteClientUser(created.id, org.id)

    const stored = await getClientUserById(created.id, org.id)
    expect(stored.isActive).toBe(false)
  })
})
