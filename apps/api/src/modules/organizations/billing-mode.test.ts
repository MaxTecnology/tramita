import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import * as asaas from '@/lib/asaas'
import { createTestPlan, createTestOrg, createMasterUser, getAuthHeader, generateValidCnpj } from '@/test/helpers'
import { createOrganizationByMaster, listOrganizations } from './organizations.service'
import { getRevenue } from '@/modules/master/revenue.service'

beforeEach(() => {
  vi.spyOn(asaas, 'createCustomer').mockResolvedValue({ id: 'cus_1', name: 'X', email: 'x@x.com' })
  vi.spyOn(asaas, 'createSubscription').mockResolvedValue({ id: 'sub_1', status: 'ACTIVE' })
})
afterEach(() => vi.restoreAllMocks())

const base = (extra: object = {}) => ({ name: 'Escritório', email: `e-${Date.now()}-${Math.random()}@t.com`, adminName: 'Admin', ...extra })

async function masterAuth() {
  const { user, password } = await createMasterUser()
  return getAuthHeader(user.email, password)
}

describe('como o escritório paga a AutoHubs (billingMode)', () => {
  it('created by the Master without Asaas is a direct agreement, with an optional next due date', async () => {
    const plan = await createTestPlan()
    const { organization } = await createOrganizationByMaster({ ...base(), planId: plan.id, createAsaasSubscription: false, manualNextDueDate: '2026-12-10' })
    expect(organization.billingMode).toBe('MANUAL')
    expect(organization.manualNextDueDate?.toISOString()).toBe('2026-12-10T00:00:00.000Z')
  })

  it('created with an Asaas subscription is billed by Asaas and has no manual due date', async () => {
    const plan = await createTestPlan()
    const { organization } = await createOrganizationByMaster({ ...base({ cnpj: generateValidCnpj(4) }), planId: plan.id, createAsaasSubscription: true, manualNextDueDate: '2026-12-10' })
    expect(organization.billingMode).toBe('ASAAS')
    expect(organization.manualNextDueDate).toBeNull()
  })

  it('the Master moves the next due date of a manual office; an Asaas office has none', async () => {
    const auth = await masterAuth()
    const plan = await createTestPlan()
    const manual = (await createOrganizationByMaster({ ...base(), planId: plan.id, createAsaasSubscription: false })).organization
    const viaAsaas = await createTestOrg(plan.id)

    const ok = await app.inject({ method: 'PATCH', url: `/master/organizations/${manual.id}`, headers: { authorization: auth }, payload: { manualNextDueDate: '2027-01-10' } })
    expect(ok.statusCode).toBe(200)
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: manual.id } })).manualNextDueDate?.toISOString()).toBe('2027-01-10T00:00:00.000Z')

    const cleared = await app.inject({ method: 'PATCH', url: `/master/organizations/${manual.id}`, headers: { authorization: auth }, payload: { manualNextDueDate: null } })
    expect(cleared.statusCode).toBe(200)

    const refused = await app.inject({ method: 'PATCH', url: `/master/organizations/${viaAsaas.id}`, headers: { authorization: auth }, payload: { manualNextDueDate: '2027-01-10' } })
    expect(refused.statusCode).toBe(422)
    expect(JSON.parse(refused.body).message).toBe('Escritório cobrado pelo Asaas não tem vencimento manual')

    const invalid = await app.inject({ method: 'PATCH', url: `/master/organizations/${manual.id}`, headers: { authorization: auth }, payload: { manualNextDueDate: '10/01/2027' } })
    expect(invalid.statusCode).toBe(400)
  })

  it('the list shows how each office pays', async () => {
    const plan = await createTestPlan()
    const { organization } = await createOrganizationByMaster({ ...base(), planId: plan.id, createAsaasSubscription: false, manualNextDueDate: '2026-12-10' })
    const listed = (await listOrganizations()).find((o) => o.id === organization.id)
    expect(listed).toMatchObject({ billingMode: 'MANUAL', manualNextDueDate: new Date('2026-12-10T00:00:00.000Z') })
  })

  it('the Asaas webhook never touches a manual office (even with an old subscription id)', async () => {
    process.env.ASAAS_WEBHOOK_SECRET = 'segredo'
    const org = await createTestOrg((await createTestPlan()).id)
    await prisma.organization.update({ where: { id: org.id }, data: { billingMode: 'MANUAL', asaasSubscriptionId: 'sub_antiga', subscriptionStatus: 'ACTIVE' } })
    const res = await app.inject({
      method: 'POST', url: '/webhooks/asaas?accessToken=segredo',
      payload: { event: 'PAYMENT_DELETED', payment: { id: 'pay_1', subscription: 'sub_antiga', customer: 'c', value: 97 } },
    })
    expect(res.statusCode).toBe(200)
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).subscriptionStatus).toBe('ACTIVE')
  })

  it('the MRR is split between Asaas and direct agreements', async () => {
    const plan = await prisma.plan.create({ data: { name: 'Pro', maxClients: 50, priceMonthly: 197, features: {} } })
    await prisma.organization.createMany({
      data: [
        { name: 'A', slug: 'a', email: 'a@t.com', planId: plan.id, subscriptionStatus: 'ACTIVE', billingMode: 'ASAAS' },
        { name: 'M', slug: 'm', email: 'm@t.com', planId: plan.id, subscriptionStatus: 'ACTIVE', billingMode: 'MANUAL' },
        { name: 'M2', slug: 'm2', email: 'm2@t.com', planId: plan.id, subscriptionStatus: 'SUSPENDED', billingMode: 'MANUAL' },
      ],
    })
    const r = await getRevenue()
    expect(r).toMatchObject({ mrr: 394, mrrAsaas: 197, mrrManual: 197, totalOrgsAtivas: 2 })
  })
})
