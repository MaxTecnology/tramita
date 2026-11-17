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

  it('accepts the token in the asaas-access-token header (how Asaas sends it)', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    const res = await app.inject({
      method: 'POST', url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
      payload: webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)
  })

  it('wrong header token of a different length is refused without throwing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/webhooks/asaas', headers: { 'asaas-access-token': 'x' },
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
      url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
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
      url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
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
      url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
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

  it('a deleted charge (a single boleto removed or renegotiated) is recorded but does not suspend the office', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    await prisma.organization.update({ where: { id: org.id }, data: { subscriptionStatus: 'ACTIVE' } })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
      payload: webhookPayload('PAYMENT_DELETED', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('ACTIVE')
    expect(await prisma.subscriptionHistory.count({ where: { organizationId: org.id, event: 'PAYMENT_DELETED' } })).toBe(1)
  })

  it('the subscription deleted in Asaas cancels the office', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    const res = await app.inject({
      method: 'POST', url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
      payload: { event: 'SUBSCRIPTION_DELETED', subscription: { id: org.asaasSubscriptionId } },
    })
    expect(res.statusCode).toBe(200)
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).subscriptionStatus).toBe('CANCELLED')
  })

  it('the token is accepted only in the header (a token in the URL ends up in proxy logs)', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    const res = await app.inject({ method: 'POST', url: `/webhooks/asaas?accessToken=${SECRET}`, payload: webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!) })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 and ignores unknown subscription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET },
      payload: webhookPayload('PAYMENT_CONFIRMED', 'sub_nonexistent'),
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('webhook do Asaas: reentrega, ordem e payload', () => {
  const post = (payload: object) => app.inject({ method: 'POST', url: '/webhooks/asaas', headers: { 'asaas-access-token': SECRET }, payload })

  it('the same event of the same payment, delivered twice, is applied once', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    for (let i = 0; i < 2; i++) expect((await post(webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!))).statusCode).toBe(200)
    expect(await prisma.subscriptionHistory.count({ where: { organizationId: org.id, event: 'PAYMENT_CONFIRMED' } })).toBe(1)
  })

  it('an "overdue" that arrives after the same payment was confirmed does not put the office back in grace period', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    await post(webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!))
    await post(webhookPayload('PAYMENT_OVERDUE', org.asaasSubscriptionId!))
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    expect([after.subscriptionStatus, after.gracePeriodEndsAt]).toEqual(['ACTIVE', null])
  })

  it('a malformed body is refused without touching anything; an event we do not handle is acknowledged', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    expect((await post({ event: 'PAYMENT_CONFIRMED', payment: { id: 42 } })).statusCode).toBe(400)
    expect((await post({ event: 'PAYMENT_CREATED', payment: { id: 'pay_x', subscription: org.asaasSubscriptionId, customer: 'c', value: 1 } })).statusCode).toBe(200)
    expect(await prisma.subscriptionHistory.count({ where: { organizationId: org.id } })).toBe(0)
  })
})
