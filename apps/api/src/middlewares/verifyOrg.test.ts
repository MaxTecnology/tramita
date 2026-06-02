import { describe, it, expect } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyOrg } from '@/middlewares/verifyOrg'

function mockReq(
  role: string,
  organizationId: string,
  params: Record<string, string> = {},
): FastifyRequest {
  return {
    user: { sub: 'u1', role, organizationId },
    params,
  } as unknown as FastifyRequest
}
const reply = {} as FastifyReply

describe('verifyOrg', () => {
  it('passes for MASTER regardless of params', async () => {
    const req = mockReq('MASTER', 'master-org', { organizationId: 'other-org' })
    await expect(verifyOrg(req, reply)).resolves.toBeUndefined()
  })

  it('passes when params.organizationId matches user.organizationId', async () => {
    const req = mockReq('ORG_ADMIN', 'org-123', { organizationId: 'org-123' })
    await expect(verifyOrg(req, reply)).resolves.toBeUndefined()
  })

  it('throws 403 when params.organizationId does not match user.organizationId', async () => {
    const req = mockReq('ORG_ADMIN', 'org-123', { organizationId: 'org-456' })
    await expect(verifyOrg(req, reply)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('passes when there is no organizationId param in the URL', async () => {
    const req = mockReq('ORG_ADMIN', 'org-123', {})
    await expect(verifyOrg(req, reply)).resolves.toBeUndefined()
  })
})
