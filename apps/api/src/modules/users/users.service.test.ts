import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { resetUserPassword } from '@/modules/users/users.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

describe('resetUserPassword', () => {
  it('generates a new password scoped to the given organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const originalHash = user.passwordHash

    const result = await resetUserPassword(user.id, org.id)

    expect(result.temporaryPassword).toHaveLength(12)
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.passwordHash).not.toBe(originalHash)
  })

  it('throws 404 when user belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)

    await expect(resetUserPassword(user.id, orgB.id)).rejects.toThrow(AppError)
  })

  it('resets any user when organizationId is omitted', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)

    const result = await resetUserPassword(user.id)
    expect(result.temporaryPassword).toHaveLength(12)
  })
})
