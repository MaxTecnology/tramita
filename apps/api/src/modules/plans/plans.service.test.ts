import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  listPlans,
  createPlan,
  updatePlan,
  softDeletePlan,
} from '@/modules/plans/plans.service'
import { AppError } from '@/errors/AppError'

describe('listPlans', () => {
  it('returns empty array when no plans exist', async () => {
    const result = await listPlans()
    expect(result).toEqual([])
  })

  it('returns plans ordered by priceMonthly ascending', async () => {
    await prisma.plan.createMany({
      data: [
        { name: 'Enterprise', maxClients: 999, priceMonthly: 497, features: {} },
        { name: 'Starter', maxClients: 15, priceMonthly: 97, features: {} },
        { name: 'Pro', maxClients: 50, priceMonthly: 197, features: {} },
      ],
    })
    const result = await listPlans()
    expect(result.map((p) => p.name)).toEqual(['Starter', 'Pro', 'Enterprise'])
  })

  it('includes inactive plans', async () => {
    await prisma.plan.create({
      data: { name: 'Old Plan', maxClients: 10, priceMonthly: 50, features: {}, isActive: false },
    })
    const result = await listPlans()
    expect(result).toHaveLength(1)
    expect(result[0].isActive).toBe(false)
  })
})

describe('createPlan', () => {
  it('creates and returns the new plan', async () => {
    const plan = await createPlan({
      name: 'Pro',
      maxClients: 50,
      priceMonthly: 197,
      features: { pdf: true, sse: false, attachments: true },
    })
    expect(plan.id).toBeTruthy()
    expect(plan.name).toBe('Pro')
    expect(plan.maxClients).toBe(50)
    expect(plan.isActive).toBe(true)
  })
})

describe('updatePlan', () => {
  it('updates only provided fields', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Old', maxClients: 10, priceMonthly: 50, features: {} },
    })
    const updated = await updatePlan(plan.id, { name: 'New', maxClients: 20 })
    expect(updated.name).toBe('New')
    expect(updated.maxClients).toBe(20)
    expect(Number(updated.priceMonthly)).toBe(50)
  })

  it('throws 404 for nonexistent plan', async () => {
    await expect(updatePlan('nonexistent-id', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('softDeletePlan', () => {
  it('sets isActive to false', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Doomed', maxClients: 10, priceMonthly: 50, features: {} },
    })
    await softDeletePlan(plan.id)
    const found = await prisma.plan.findUnique({ where: { id: plan.id } })
    expect(found?.isActive).toBe(false)
  })

  it('throws 404 for nonexistent plan', async () => {
    await expect(softDeletePlan('nonexistent-id')).rejects.toMatchObject({ statusCode: 404 })
  })
})
