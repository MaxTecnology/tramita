import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  register, getOrgSubscription, changePlan, getOrganization,
} from '@/modules/organizations/organizations.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

// vi.hoisted ensures the mock refs are available inside the vi.mock factory
const { mockCreateCustomer, mockCreateSubscription, mockCancelSubscription } = vi.hoisted(() => ({
  mockCreateCustomer: vi.fn(),
  mockCreateSubscription: vi.fn(),
  mockCancelSubscription: vi.fn(),
}))

vi.mock('@/lib/asaas', () => ({
  createCustomer: mockCreateCustomer,
  createSubscription: mockCreateSubscription,
  cancelSubscription: mockCancelSubscription,
}))

beforeEach(() => {
  mockCreateCustomer.mockResolvedValue({ id: 'cus_test123', name: 'Test', email: 'test@test.com' })
  mockCreateSubscription.mockResolvedValue({ id: 'sub_test123', status: 'ACTIVE' })
  mockCancelSubscription.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('register', () => {
  it('creates organization, ORG_ADMIN user, and calls Asaas', async () => {
    const plan = await createTestPlan({ name: 'Pro' })

    const result = await register({
      name: 'Contabilidade ABC',
      email: `abc-${Date.now()}@test.com`,
      adminName: 'Admin ABC',
      adminPassword: 'Senha@123',
      planId: plan.id,
    })

    expect(result.organization.name).toBe('Contabilidade ABC')
    expect(result.user.role).toBe('ORG_ADMIN')
    expect(mockCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: result.organization.email }),
    )
    expect(mockCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_test123', cycle: 'MONTHLY' }),
    )

    const org = await prisma.organization.findUnique({ where: { id: result.organization.id } })
    expect(org?.asaasCustomerId).toBe('cus_test123')
    expect(org?.asaasSubscriptionId).toBe('sub_test123')
  })

  it('throws 409 if email already registered', async () => {
    const plan = await createTestPlan()
    const email = `dup-${Date.now()}@test.com`
    await prisma.organization.create({
      data: { name: 'Existing', slug: `existing-${Date.now()}`, email, planId: plan.id },
    })

    await expect(
      register({ name: 'New', email, adminName: 'A', adminPassword: 'Senha@123', planId: plan.id }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 404 for inactive plan', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Old', maxClients: 10, priceMonthly: 50, features: {}, isActive: false },
    })

    await expect(
      register({
        name: 'Org',
        email: `org-${Date.now()}@test.com`,
        adminName: 'A',
        adminPassword: 'Senha@123',
        planId: plan.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('creates org in TRIAL status when planId = "trial"', async () => {
    await createTestPlan({ name: 'Starter' })

    const result = await register({
      name: 'Trial Org',
      email: `trial-${Date.now()}@test.com`,
      adminName: 'Admin',
      adminPassword: 'Senha@123',
      planId: 'trial',
    })

    expect(result.organization.subscriptionStatus).toBe('TRIAL')
    expect(result.organization.trialEndsAt).toBeTruthy()
    expect(mockCreateCustomer).not.toHaveBeenCalled()
  })
})

describe('getOrgSubscription', () => {
  it('returns org subscription status and history', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.subscriptionHistory.create({
      data: { organizationId: org.id, event: 'PAYMENT_CONFIRMED', amount: 197 },
    })

    const result = await getOrgSubscription(org.id)

    expect(result.subscriptionStatus).toBe('ACTIVE')
    expect(result.subscriptionHistory).toHaveLength(1)
    expect(result.subscriptionHistory[0].event).toBe('PAYMENT_CONFIRMED')
  })
})

describe('changePlan', () => {
  it('updates planId in DB', async () => {
    const oldPlan = await createTestPlan({ name: 'Starter' })
    const newPlan = await createTestPlan({ name: 'Pro', maxClients: 100 })
    const org = await createTestOrg(oldPlan.id)

    const updated = await changePlan(org.id, newPlan.id)
    expect(updated.planId).toBe(newPlan.id)
  })

  it('throws 404 for nonexistent plan', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    await expect(changePlan(org.id, 'nonexistent-plan')).rejects.toMatchObject({ statusCode: 404 })
  })
})

import { createOrganizationByMaster } from '@/modules/organizations/organizations.service'

describe('createOrganizationByMaster', () => {
  it('creates organization with ACTIVE status and a generated password, without calling Asaas', async () => {
    const plan = await createTestPlan({ name: 'Pro' })

    const result = await createOrganizationByMaster({
      name: 'Escritório Manual',
      email: `manual-${Date.now()}@test.com`,
      planId: plan.id,
      adminName: 'Admin Manual',
      createAsaasSubscription: false,
    })

    expect(result.organization.subscriptionStatus).toBe('ACTIVE')
    expect(result.organization.asaasCustomerId).toBeNull()
    expect(result.user.role).toBe('ORG_ADMIN')
    expect(result.temporaryPassword).toHaveLength(12)
    expect(mockCreateCustomer).not.toHaveBeenCalled()

    const stored = await prisma.user.findUnique({ where: { id: result.user.id } })
    expect(stored?.passwordHash).not.toBe(result.temporaryPassword)
  })

  it('creates Asaas customer and subscription when createAsaasSubscription is true', async () => {
    const plan = await createTestPlan({ name: 'Pro' })

    const result = await createOrganizationByMaster({
      name: 'Escritório Com Asaas',
      email: `comasaas-${Date.now()}@test.com`,
      cnpj: '12345678000190',
      planId: plan.id,
      adminName: 'Admin Asaas',
      createAsaasSubscription: true,
    })

    expect(mockCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ cpfCnpj: '12345678000190' }),
    )
    expect(mockCreateSubscription).toHaveBeenCalled()
    expect(result.organization.asaasCustomerId).toBe('cus_test123')
  })

  it('rolls back organization and user when Asaas fails', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    mockCreateCustomer.mockRejectedValueOnce(new Error('Asaas down'))

    await expect(
      createOrganizationByMaster({
        name: 'Escritório Falho',
        email: `falho-${Date.now()}@test.com`,
        cnpj: '12345678000190',
        planId: plan.id,
        adminName: 'Admin Falho',
        createAsaasSubscription: true,
      }),
    ).rejects.toThrow('Erro ao integrar com sistema de cobrança')

    const org = await prisma.organization.findFirst({ where: { name: 'Escritório Falho' } })
    expect(org).toBeNull()
  })

  it('throws 409 when email is already registered', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const email = `dup-${Date.now()}@test.com`
    await createOrganizationByMaster({
      name: 'Primeiro', email, planId: plan.id, adminName: 'Admin', createAsaasSubscription: false,
    })

    await expect(
      createOrganizationByMaster({
        name: 'Segundo', email, planId: plan.id, adminName: 'Admin 2', createAsaasSubscription: false,
      }),
    ).rejects.toThrow('E-mail já cadastrado')
  })

  it('throws 404 when plan does not exist', async () => {
    await expect(
      createOrganizationByMaster({
        name: 'Sem Plano',
        email: `semplano-${Date.now()}@test.com`,
        planId: 'plan-inexistente',
        adminName: 'Admin',
        createAsaasSubscription: false,
      }),
    ).rejects.toThrow('Plano não encontrado')
  })
})

describe('getOrganization', () => {
  it('includes the list of active users', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await createTestUser(org.id, { role: 'ORG_ADMIN', email: `admin-${Date.now()}@test.com` })

    const result = await getOrganization(org.id)

    expect(result.users).toHaveLength(1)
    expect(result.users[0]).toMatchObject({ role: 'ORG_ADMIN' })
  })
})
