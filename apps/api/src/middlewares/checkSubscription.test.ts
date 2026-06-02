import { describe, it, expect } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { createTestPlan, createTestOrg } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

function mockReq(role: string, organizationId: string | null): FastifyRequest {
  return { user: { sub: 'u1', role, organizationId } } as unknown as FastifyRequest
}
const reply = {} as FastifyReply

describe('checkSubscription', () => {
  it('passes for MASTER (always allowed)', async () => {
    await expect(checkSubscription(mockReq('MASTER', null), reply)).resolves.toBeUndefined()
  })

  it('passes for ACTIVE org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id) // status = ACTIVE by default
    await expect(checkSubscription(mockReq('ORG_ADMIN', org.id), reply)).resolves.toBeUndefined()
  })

  it('throws 403 for SUSPENDED org', async () => {
    const plan = await createTestPlan()
    const org = await prisma.organization.create({
      data: {
        name: 'Suspended', slug: `sus-${Date.now()}`, email: `sus-${Date.now()}@t.com`,
        planId: plan.id, subscriptionStatus: 'SUSPENDED',
      },
    })
    await expect(checkSubscription(mockReq('ORG_ADMIN', org.id), reply)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('passes for GRACE_PERIOD org with future expiry', async () => {
    const plan = await createTestPlan()
    const org = await prisma.organization.create({
      data: {
        name: 'Grace', slug: `grace-${Date.now()}`, email: `grace-${Date.now()}@t.com`,
        planId: plan.id, subscriptionStatus: 'GRACE_PERIOD',
        gracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    })
    await expect(checkSubscription(mockReq('ORG_ADMIN', org.id), reply)).resolves.toBeUndefined()
  })

  it('throws 403 and auto-suspends GRACE_PERIOD org with past expiry', async () => {
    const plan = await createTestPlan()
    const org = await prisma.organization.create({
      data: {
        name: 'Expired', slug: `exp-${Date.now()}`, email: `exp-${Date.now()}@t.com`,
        planId: plan.id, subscriptionStatus: 'GRACE_PERIOD',
        gracePeriodEndsAt: new Date(Date.now() - 1000),
      },
    })

    await expect(checkSubscription(mockReq('ORG_ADMIN', org.id), reply)).rejects.toMatchObject({
      statusCode: 403,
    })

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('SUSPENDED')
  })
})
