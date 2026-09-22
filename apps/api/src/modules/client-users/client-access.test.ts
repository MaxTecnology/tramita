// apps/api/src/modules/client-users/client-access.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getClientAccessScope, canSeeTask } from './client-access'
import {
  createTestPlan, createTestOrg, createTestClient, createTestDepartment, createTestClientUser, grantClientAccess,
} from '@/test/helpers'

describe('getClientAccessScope', () => {
  it('groups departments by client from multiple access rows, across multiple companies', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const deptFiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const deptPessoal = await createTestDepartment(org.id, { name: 'Pessoal' })
    const { clientUser } = await createTestClientUser(org.id)

    await grantClientAccess(clientUser.id, clientA.id, deptFiscal.id)
    await grantClientAccess(clientUser.id, clientA.id, deptPessoal.id)
    await grantClientAccess(clientUser.id, clientB.id, deptFiscal.id)

    const scope = await getClientAccessScope(clientUser.id)

    expect(scope.clientIds.sort()).toEqual([clientA.id, clientB.id].sort())
    expect(scope.departmentIdsByClient.get(clientA.id)).toEqual(new Set([deptFiscal.id, deptPessoal.id]))
    expect(scope.departmentIdsByClient.get(clientB.id)).toEqual(new Set([deptFiscal.id]))
  })

  it('returns empty scope for a ClientUser with no access rows', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const { clientUser } = await createTestClientUser(org.id)

    const scope = await getClientAccessScope(clientUser.id)

    expect(scope.clientIds).toEqual([])
  })

  it('returns empty scope for a deactivated ClientUser even though ClientUserAccess rows exist', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const dept = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, dept.id)

    await prisma.clientUser.update({ where: { id: clientUser.id }, data: { isActive: false } })

    const scope = await getClientAccessScope(clientUser.id)

    expect(scope.clientIds).toEqual([])
    expect(scope.departmentIdsByClient.size).toBe(0)
  })
})

describe('canSeeTask', () => {
  it('returns true only for a client+department combo present in the scope', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const dept = await createTestDepartment(org.id)
    const otherDept = await createTestDepartment(org.id, { name: 'Outro' })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, dept.id)

    const scope = await getClientAccessScope(clientUser.id)

    expect(canSeeTask(scope, clientA.id, dept.id)).toBe(true)
    expect(canSeeTask(scope, clientA.id, otherDept.id)).toBe(false)
    expect(canSeeTask(scope, 'some-other-client-id', dept.id)).toBe(false)
  })
})
