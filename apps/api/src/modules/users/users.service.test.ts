import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  resetUserPassword,
  createUser,
  updateUser,
  deleteUser,
  getMyProfile,
  updateMyProfile,
} from '@/modules/users/users.service'
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

  it('throws 404 when scoped call targets another ORG_ADMIN in the same org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const target = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    await expect(resetUserPassword(target.id, org.id)).rejects.toThrow(AppError)
  })
})

describe('createUser', () => {
  it('creates a user with hashed password, scoped to the organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await createUser(org.id, {
      name: 'Novo Membro',
      email: `novo-${Date.now()}@test.com`,
      password: 'Senha@1234',
      role: 'ORG_MEMBER',
    })

    expect(result.role).toBe('ORG_MEMBER')
    const stored = await prisma.user.findUnique({ where: { id: result.id } })
    expect(stored?.organizationId).toBe(org.id)
    expect(stored?.passwordHash).not.toBe('Senha@1234')
  })

  it('throws 409 when email is already registered', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `dup-${Date.now()}@test.com`
    await createTestUser(org.id, { email })

    await expect(
      createUser(org.id, { name: 'Outro', email, password: 'Senha@1234', role: 'ORG_MEMBER' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('updateUser', () => {
  it('updates name and phone for a user in the same organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const result = await updateUser(user.id, org.id, { name: 'Nome Atualizado' })

    expect(result.name).toBe('Nome Atualizado')
  })

  it('throws 404 when user belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id, { role: 'ORG_MEMBER' })

    await expect(updateUser(user.id, orgB.id, { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 for an already-deactivated user', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    await deleteUser(user.id, org.id)

    await expect(updateUser(user.id, org.id, { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteUser', () => {
  it('soft-deletes by setting isActive to false, does not remove the row', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    await deleteUser(user.id, org.id)

    const stored = await prisma.user.findUnique({ where: { id: user.id } })
    expect(stored).not.toBeNull()
    expect(stored?.isActive).toBe(false)
  })

  it('throws 404 when user belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id, { role: 'ORG_MEMBER' })

    await expect(deleteUser(user.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('getMyProfile', () => {
  it('returns the user profile', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)

    const result = await getMyProfile(user.id)

    expect(result.id).toBe(user.id)
  })

  it('throws 404 when user does not exist', async () => {
    await expect(getMyProfile('nonexistent-id')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateMyProfile', () => {
  it('updates name and phone', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)

    const result = await updateMyProfile(user.id, { name: 'Perfil Atualizado', phone: '5582999990000' })

    expect(result.name).toBe('Perfil Atualizado')
  })

  it('throws 404 when user does not exist', async () => {
    await expect(updateMyProfile('nonexistent-id', { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})
