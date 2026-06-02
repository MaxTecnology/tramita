import { describe, it, expect } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { checkPlanLimit } from '@/middlewares/checkPlanLimit'
import { createTestPlan, createTestOrg, createTestClient } from '@/test/helpers'

function mockReq(organizationId: string | null): FastifyRequest {
  return { user: { sub: 'u1', role: 'ORG_ADMIN', organizationId } } as unknown as FastifyRequest
}
const reply = {} as FastifyReply

describe('checkPlanLimit', () => {
  it('passes when organizationId is null (MASTER)', async () => {
    await expect(checkPlanLimit(mockReq(null), reply)).resolves.toBeUndefined()
  })

  it('passes when clientsCount < plan.maxClients', async () => {
    const plan = await createTestPlan({ maxClients: 5 })
    const org = await createTestOrg(plan.id)
    await expect(checkPlanLimit(mockReq(org.id), reply)).resolves.toBeUndefined()
  })

  it('passes when clientsCount is maxClients - 1', async () => {
    const plan = await createTestPlan({ maxClients: 2 })
    const org = await createTestOrg(plan.id)
    await createTestClient(org.id)
    await expect(checkPlanLimit(mockReq(org.id), reply)).resolves.toBeUndefined()
  })

  it('throws 422 when clientsCount >= plan.maxClients', async () => {
    const plan = await createTestPlan({ maxClients: 1 })
    const org = await createTestOrg(plan.id)
    await createTestClient(org.id)
    await expect(checkPlanLimit(mockReq(org.id), reply)).rejects.toMatchObject({
      statusCode: 422,
    })
  })
})
