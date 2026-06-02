import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg } from '@/test/helpers'

const SECRET = 'test-webhook-secret'

beforeEach(() => {
  process.env.ASAAS_WEBHOOK_SECRET = SECRET
})

async function orgWithSubscription(planId: string) {
  const org = await createTestOrg(planId)
  return prisma.organization.update({
    where: { id: org.id },
    data: { asaasSubscriptionId: `sub_${org.id}`, asaasCustomerId: `cus_${org.id}` },
  })
}

function webhookPayload(event: string, subscriptionId: string, value = 197) {
  return {
    event,
    payment: { id: 'pay_test', subscription: subscriptionId, customer: 'cus_test', value },
  }
}

describe('POST /webhooks/asaas', () => {
  it('returns 401 for wrong accessToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas?accessToken=wrong',
      payload: { event: 'PAYMENT_CONFIRMED', payment: {} },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 with no accessToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: { event: 'PAYMENT_CONFIRMED', payment: {} },
    })
    expect(res.statusCode).toBe(401)
  })

  it('PAYMENT_CONFIRMED sets subscriptionStatus to ACTIVE', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    await prisma.organization.update({
      where: { id: org.id },
      data: { subscriptionStatus: 'GRACE_PERIOD' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('ACTIVE')
    expect(updated?.gracePeriodEndsAt).toBeNull()
  })

  it('PAYMENT_CONFIRMED saves SubscriptionHistory entry', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)

    await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!, 197),
    })

    const history = await prisma.subscriptionHistory.findFirst({ where: { organizationId: org.id } })
    expect(history?.event).toBe('PAYMENT_CONFIRMED')
    expect(Number(history?.amount)).toBe(197)
  })

  it('PAYMENT_OVERDUE sets GRACE_PERIOD with gracePeriodEndsAt ~7 days from now', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_OVERDUE', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('GRACE_PERIOD')
    expect(updated?.gracePeriodEndsAt).toBeTruthy()

    const daysUntil =
      (updated!.gracePeriodEndsAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    expect(daysUntil).toBeGreaterThan(6)
    expect(daysUntil).toBeLessThan(8)
  })

  it('PAYMENT_DELETED suspends org', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_DELETED', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('SUSPENDED')
  })

  it('returns 200 and ignores unknown subscription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_CONFIRMED', 'sub_nonexistent'),
    })
    expect(res.statusCode).toBe(200)
  })
})
