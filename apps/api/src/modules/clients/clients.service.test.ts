import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as cnpjws from '@/lib/cnpjws'
import {
  createClient,
  updateClient,
  deleteClient,
  listAssignments,
  setAssignment,
  lookupClientByCnpj,
  listClientUserLinks,
} from '@/modules/clients/clients.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestClientUser,
  createTestDepartment,
  grantClientAccess,
} from '@/test/helpers'

describe('createClient', () => {
  it('creates a client scoped to the organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await createTestDepartment(org.id)

    const result = await createClient(org.id, {
      name: 'Cliente Novo',
      clientType: 'PJ',
      clientUsers: [{ name: 'Portal User', email: `portal-${Date.now()}@test.com`, password: 'Test@1234', departmentIds: [department.id] }],
    })

    expect(result.clientType).toBe('PJ')
    const stored = await prisma.client.findUnique({ where: { id: result.id } })
    expect(stored?.organizationId).toBe(org.id)
  })

  it('links an existing ClientUser via existingId without creating a duplicate', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)

    const result = await createClient(org.id, {
      name: 'Cliente Novo',
      clientType: 'PJ',
      clientUsers: [{ existingId: clientUser.id, departmentIds: [department.id] }],
    })

    const count = await prisma.clientUser.count({ where: { organizationId: org.id } })
    expect(count).toBe(1)
    const access = await prisma.clientUserAccess.findFirst({
      where: { clientUserId: clientUser.id, clientId: result.id, departmentId: department.id },
    })
    expect(access).not.toBeNull()
  })

  it('throws 404 when existingId belongs to a ClientUser from another organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const department = await createTestDepartment(orgA.id)
    const { clientUser: foreignClientUser } = await createTestClientUser(orgB.id)

    await expect(
      createClient(orgA.id, {
        name: 'Cliente Novo',
        clientType: 'PJ',
        clientUsers: [{ existingId: foreignClientUser.id, departmentIds: [department.id] }],
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
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

  it('removes ClientUserAccess for a portal user omitted from the submitted clientUsers list', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const { clientUser: keptUser } = await createTestClientUser(org.id)
    const { clientUser: removedUser } = await createTestClientUser(org.id)
    await grantClientAccess(keptUser.id, client.id, department.id)
    await grantClientAccess(removedUser.id, client.id, department.id)

    await updateClient(client.id, org.id, {
      clientUsers: [{ existingId: keptUser.id, departmentIds: [department.id] }],
    })

    const keptAccess = await prisma.clientUserAccess.findFirst({
      where: { clientUserId: keptUser.id, clientId: client.id },
    })
    expect(keptAccess).not.toBeNull()

    const removedAccess = await prisma.clientUserAccess.findFirst({
      where: { clientUserId: removedUser.id, clientId: client.id },
    })
    expect(removedAccess).toBeNull()
  })

  it('does not touch existing ClientUserAccess when clientUsers is omitted from the update payload', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const department = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)

    await updateClient(client.id, org.id, { notes: 'Sem alterar vínculos' })

    const access = await prisma.clientUserAccess.findFirst({
      where: { clientUserId: clientUser.id, clientId: client.id },
    })
    expect(access).not.toBeNull()
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

describe('listClientUserLinks', () => {
  it('returns one entry per ClientUser with all department ids for that client grouped together', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const deptA = await createTestDepartment(org.id)
    const deptB = await createTestDepartment(org.id)

    const { clientUser: singleDeptUser } = await createTestClientUser(org.id, { name: 'Single Dept', email: `single-${Date.now()}@test.com` })
    await grantClientAccess(singleDeptUser.id, client.id, deptA.id)

    const { clientUser: multiDeptUser } = await createTestClientUser(org.id, { name: 'Multi Dept', email: `multi-${Date.now()}@test.com` })
    await grantClientAccess(multiDeptUser.id, client.id, deptA.id)
    await grantClientAccess(multiDeptUser.id, client.id, deptB.id)

    const result = await listClientUserLinks(client.id, org.id)

    expect(result).toHaveLength(2)
    const single = result.find((r) => r.existingId === singleDeptUser.id)
    const multi = result.find((r) => r.existingId === multiDeptUser.id)
    expect(single).toMatchObject({ name: 'Single Dept', departmentIds: [deptA.id] })
    expect(multi?.name).toBe('Multi Dept')
    expect(multi?.departmentIds.sort()).toEqual([deptA.id, deptB.id].sort())
  })

  it('returns an empty array when the client has no linked users', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    const result = await listClientUserLinks(client.id, org.id)

    expect(result).toEqual([])
  })

  it('throws 404 when client belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)

    await expect(listClientUserLinks(client.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('lookupClientByCnpj', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the mapped address when the CNPJ is valid', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockResolvedValue({
      razaoSocial: 'Cliente Teste LTDA',
      nomeFantasia: null,
      cep: '57000-000',
      estado: 'AL',
      cidade: 'Maceió',
      bairro: 'Centro',
      logradouro: 'RUA das Flores',
      numero: '123',
      complemento: null,
    })

    const result = await lookupClientByCnpj('11.222.333/0001-81')

    expect(cnpjws.lookupCnpj).toHaveBeenCalledWith('11222333000181')
    expect(result.razaoSocial).toBe('Cliente Teste LTDA')
    expect(result.cidade).toBe('Maceió')
  })

  it('throws 400 when the CNPJ does not have 14 digits', async () => {
    await expect(lookupClientByCnpj('123')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 404 when the external API responds with 404', async () => {
    const err = Object.assign(new Error('Not Found'), {
      isAxiosError: true,
      response: { status: 404 },
    })
    vi.spyOn(cnpjws, 'lookupCnpj').mockRejectedValue(err)

    await expect(lookupClientByCnpj('11222333000181')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 429 when the external API responds with 429 (rate limit)', async () => {
    const err = Object.assign(new Error('Too Many Requests'), {
      isAxiosError: true,
      response: { status: 429 },
    })
    vi.spyOn(cnpjws, 'lookupCnpj').mockRejectedValue(err)

    await expect(lookupClientByCnpj('11222333000181')).rejects.toMatchObject({ statusCode: 429 })
  })
})
