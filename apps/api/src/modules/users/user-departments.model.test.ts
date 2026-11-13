import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment } from '@/test/helpers'

describe('UserDepartment', () => {
  it('createTestUser with departmentIds creates the memberships and sees colleagues by default', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })

    expect(await prisma.userDepartment.count({ where: { userId: user.id } })).toBe(1)
    expect(user.seesDepartmentWork).toBe(true)
  })

  it('the same membership twice is refused (unique pair)', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })

    await expect(prisma.userDepartment.create({ data: { userId: user.id, departmentId: fiscal.id } })).rejects.toMatchObject({ code: 'P2002' })
  })

  it('deleting the department removes its memberships', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })

    await prisma.department.delete({ where: { id: fiscal.id } })

    expect(await prisma.userDepartment.count({ where: { userId: user.id } })).toBe(0)
  })

  it('serving a client makes a non-admin responsible a member of the department', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const a = await createTestClient(org.id)
    const b = await createTestClient(org.id)

    await serveClientDepartment(a.id, fiscal.id, member.id)
    await serveClientDepartment(b.id, fiscal.id, admin.id)

    expect(await prisma.userDepartment.count({ where: { userId: member.id, departmentId: fiscal.id } })).toBe(1)
    expect(await prisma.userDepartment.count({ where: { userId: admin.id } })).toBe(0)
  })
})
