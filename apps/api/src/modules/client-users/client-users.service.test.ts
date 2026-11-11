import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  getClientUserById, createClientUser, updateClientUser, deleteClientUser,
} from './client-users.service'
import {
  createTestPlan, createTestOrg, createTestClient, createTestDepartment, createTestUser,
  createTestClientUser, grantClientAccess, serveClientDepartment,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const staff = await createTestUser(org.id)
  const client = await createTestClient(org.id, { name: 'ACME' })
  const department = await createTestDepartment(org.id, { name: 'Fiscal' })
  await serveClientDepartment(client.id, department.id, staff.id)
  return { org, staff, client, department }
}

let counter = 0
function email(prefix: string) {
  return `${prefix}-${Date.now()}-${++counter}@test.com`
}

describe('createClientUser', () => {
  it('creates a client user with hashed password and the given accesses', async () => {
    const { org, client, department } = await setup()

    const result = await createClientUser(org.id, {
      name: 'Viviane', email: email('viviane'), password: 'Senha@1234',
      isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    expect(result.accesses).toHaveLength(1)
    const stored = await prisma.clientUser.findUnique({ where: { id: result.id } })
    expect(stored?.passwordHash).not.toBe('Senha@1234')
  })

  it('throws 409 when email is already registered in the same organization', async () => {
    const { org, client, department } = await setup()
    const shared = email('dup')
    await createClientUser(org.id, {
      name: 'A', email: shared, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await expect(
      createClientUser(org.id, {
        name: 'B', email: shared, password: 'Senha@1234', isActive: true,
        accesses: [{ clientId: client.id, departmentId: department.id }],
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 404 when a client in accesses belongs to a different organization', async () => {
    const { org, department } = await setup()
    const plan2 = await createTestPlan()
    const otherOrg = await createTestOrg(plan2.id)
    const foreignClient = await createTestClient(otherOrg.id)

    await expect(
      createClientUser(org.id, {
        name: 'X', email: email('x'), password: 'Senha@1234', isActive: true,
        accesses: [{ clientId: foreignClient.id, departmentId: department.id }],
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('recusa acesso a departamento que não atende o cliente', async () => {
    const { org, client } = await setup()
    const folha = await createTestDepartment(org.id, { name: 'Folha' })

    await expect(
      createClientUser(org.id, {
        name: 'X', email: email('x'), password: 'Senha@1234', isActive: true,
        accesses: [{ clientId: client.id, departmentId: folha.id }],
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'O departamento Folha não atende este cliente.' })
  })
})

describe('updateClientUser', () => {
  it('replaces the accesses list entirely when accesses is provided', async () => {
    const { org, staff, client, department } = await setup()
    const department2 = await createTestDepartment(org.id, { name: 'Outro' })
    await serveClientDepartment(client.id, department2.id, staff.id)
    const { clientUser: backup } = await createTestClientUser(org.id)
    await grantClientAccess(backup.id, client.id, department.id)
    const created = await createClientUser(org.id, {
      name: 'C', email: email('c'), password: 'Senha@1234', isActive: true,
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
      name: 'D', email: email('d'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })
    const before = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })

    await updateClientUser(created.id, org.id, { name: 'D Editado' })

    const after = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })

  it('recusa acesso a departamento que não atende o cliente', async () => {
    const { org, client, department } = await setup()
    const folha = await createTestDepartment(org.id, { name: 'Folha' })
    const created = await createClientUser(org.id, {
      name: 'E', email: email('e'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await expect(
      updateClientUser(created.id, org.id, {
        accesses: [{ clientId: client.id, departmentId: department.id }, { clientId: client.id, departmentId: folha.id }],
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'O departamento Folha não atende este cliente.' })
  })

  it('recusa remover o único acesso de um departamento atendido de cliente ativo', async () => {
    const { org, staff, client, department } = await setup()
    const other = await createTestClient(org.id, { name: 'Outra' })
    await serveClientDepartment(other.id, department.id, staff.id)
    const { clientUser: backupOther } = await createTestClientUser(org.id)
    await grantClientAccess(backupOther.id, other.id, department.id)
    const created = await createClientUser(org.id, {
      name: 'Único', email: email('u'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }, { clientId: other.id, departmentId: department.id }],
    })

    await expect(
      updateClientUser(created.id, org.id, { accesses: [{ clientId: other.id, departmentId: department.id }] }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Único é o único com acesso ao departamento Fiscal do cliente ACME. Adicione outro usuário antes.',
    })
  })

  it('ignora cliente desativado na checagem de último usuário', async () => {
    const { org, staff, department } = await setup()
    const inactive = await createTestClient(org.id, { name: 'Desativada' })
    await serveClientDepartment(inactive.id, department.id, staff.id)
    const created = await createClientUser(org.id, {
      name: 'F', email: email('f'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: inactive.id, departmentId: department.id }],
    })
    await prisma.client.update({ where: { id: inactive.id }, data: { isActive: false } })

    await expect(updateClientUser(created.id, org.id, { isActive: false })).resolves.toMatchObject({ isActive: false })
  })

  it('recusa desativar o último usuário ativo de um departamento atendido', async () => {
    const { org, client, department } = await setup()
    const created = await createClientUser(org.id, {
      name: 'G', email: email('g'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await expect(updateClientUser(created.id, org.id, { isActive: false })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('permite desativar quando outro usuário ativo cobre o departamento', async () => {
    const { org, client, department } = await setup()
    const { clientUser: backup } = await createTestClientUser(org.id)
    await grantClientAccess(backup.id, client.id, department.id)
    const created = await createClientUser(org.id, {
      name: 'H', email: email('h'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await expect(updateClientUser(created.id, org.id, { isActive: false })).resolves.toMatchObject({ isActive: false })
  })
})

describe('deleteClientUser', () => {
  it('soft-deletes (isActive=false) instead of removing the row', async () => {
    const { org, client, department } = await setup()
    const { clientUser: backup } = await createTestClientUser(org.id)
    await grantClientAccess(backup.id, client.id, department.id)
    const created = await createClientUser(org.id, {
      name: 'E', email: email('e'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await deleteClientUser(created.id, org.id)

    const stored = await getClientUserById(created.id, org.id)
    expect(stored.isActive).toBe(false)
  })

  it('recusa desativar o último usuário ativo de um departamento atendido', async () => {
    const { org, client, department } = await setup()
    const created = await createClientUser(org.id, {
      name: 'I', email: email('i'), password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await expect(deleteClientUser(created.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('telefone do usuário do cliente', () => {
  it('normaliza o telefone para o formato do WhatsApp ao criar', async () => {
    const { org, client, department } = await setup()

    const created = await createClientUser(org.id, {
      name: 'Tel', email: email('tel'), password: 'Senha@1234', phone: '(82) 99999-1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    const stored = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })
    expect(stored.phone).toBe('5582999991234')
  })

  it('recusa telefone inválido', async () => {
    const { org, client, department } = await setup()

    await expect(createClientUser(org.id, {
      name: 'Tel', email: email('tel'), password: 'Senha@1234', phone: '1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })).rejects.toMatchObject({ statusCode: 400, message: 'Telefone inválido: 1234' })
  })
})
