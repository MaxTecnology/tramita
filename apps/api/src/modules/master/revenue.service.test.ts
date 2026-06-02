import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getRevenue } from '@/modules/master/revenue.service'

describe('getRevenue', () => {
  it('returns zeros when no orgs exist', async () => {
    const result = await getRevenue()
    expect(result.mrr).toBe(0)
    expect(result.totalOrgsAtivas).toBe(0)
    expect(result.churn).toBe(0)
  })

  it('calculates MRR only from ACTIVE orgs', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Pro', maxClients: 50, priceMonthly: 197, features: {} },
    })
    await prisma.organization.createMany({
      data: [
        { name: 'Org1', slug: 'org1', email: 'o1@t.com', planId: plan.id, subscriptionStatus: 'ACTIVE' },
        { name: 'Org2', slug: 'org2', email: 'o2@t.com', planId: plan.id, subscriptionStatus: 'ACTIVE' },
        { name: 'Org3', slug: 'org3', email: 'o3@t.com', planId: plan.id, subscriptionStatus: 'SUSPENDED' },
      ],
    })
    const result = await getRevenue()
    expect(result.mrr).toBe(394) // 2 × 197
    expect(result.totalOrgsAtivas).toBe(2)
  })

  it('counts CANCELLED orgs as churn', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Starter', maxClients: 15, priceMonthly: 97, features: {} },
    })
    await prisma.organization.createMany({
      data: [
        { name: 'Gone1', slug: 'gone1', email: 'g1@t.com', planId: plan.id, subscriptionStatus: 'CANCELLED' },
        { name: 'Gone2', slug: 'gone2', email: 'g2@t.com', planId: plan.id, subscriptionStatus: 'CANCELLED' },
        { name: 'Active', slug: 'active', email: 'a@t.com', planId: plan.id, subscriptionStatus: 'ACTIVE' },
      ],
    })
    const result = await getRevenue()
    expect(result.churn).toBe(2)
    expect(result.totalOrgsAtivas).toBe(1)
    expect(result.mrr).toBe(97)
  })
})
